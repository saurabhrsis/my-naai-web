import { describe, expect, it, vi, beforeEach } from 'vitest';

const { shopCartGet, shopCartAdd, shopCartSetQty, shopCartRemove, shopCartClear, shopOrderCreate, shopOrderList, shopOrderGetById, shopOrderCancel } = vi.hoisted(() => ({
  shopCartGet: vi.fn(),
  shopCartAdd: vi.fn(),
  shopCartSetQty: vi.fn(),
  shopCartRemove: vi.fn(),
  shopCartClear: vi.fn(),
  shopOrderCreate: vi.fn(),
  shopOrderList: vi.fn(),
  shopOrderGetById: vi.fn(),
  shopOrderCancel: vi.fn(),
}));

const { readLocalSession } = vi.hoisted(() => ({ readLocalSession: vi.fn(() => null) }));

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual('../lib/api');
  return {
    ...actual,
    api: {
      ...actual.api,
      shopCartGet, shopCartAdd, shopCartSetQty, shopCartRemove, shopCartClear,
      shopOrderCreate, shopOrderList, shopOrderGetById, shopOrderCancel,
    },
  };
});
vi.mock('../lib/session', async () => {
  const actual = await vi.importActual('../lib/session');
  return { ...actual, readLocalSession };
});

import {
  CANCELLABLE_SERVER_STATUSES,
  buildOrderPayload,
  clearServerCart,
  cancelServerOrder,
  customerStatusToTrackerKey,
  fetchAllServerOrders,
  fetchServerCart,
  fetchServerOrderById,
  fetchServerOrders,
  mapServerCart,
  mapServerCartLine,
  mapServerOrder,
  pushCartAdd,
  pushCartRemove,
  pushCartSetQty,
  readPendingOrders,
  registerServerOrder,
} from './shopServerSync';

// The API's line schema wants a real catalog id.
const PRODUCT_ID = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

beforeEach(() => {
  Object.values({ shopCartGet, shopCartAdd, shopCartSetQty, shopCartRemove, shopCartClear, shopOrderCreate, shopOrderList, shopOrderGetById, shopOrderCancel }).forEach(fn => fn.mockReset());
  readLocalSession.mockReset();
  readLocalSession.mockReturnValue(null); // signed OUT by default
});

const signedIn = () => readLocalSession.mockReturnValue({ token: 'tok', role: 'SALON', userId: 'salon-1', user: {} });

describe('pure mappers', () => {
  it('maps a server cart line onto the local line shape', () => {
    const line = mapServerCartLine({
      productId: 'abc', name: 'Beard Oil', price: '199.00', mrp: '249.00',
      image: 'x.jpg', category: 'beard-care', gender: 'MALE', qty: 2,
    });
    expect(line).toEqual({
      productId: 'abc', name: 'Beard Oil', price: 199, mrp: 249, image: 'x.jpg',
      category: 'beard-care', gender: 'MALE', salonName: '', qty: 2,
    });
  });

  it('maps the whole server cart payload (DECIMAL strings and all)', () => {
    const cart = mapServerCart({
      lines: [{ productId: 'p1', name: 'A', price: '10.00', mrp: null, qty: 1 }],
      totals: { itemTotal: 10 },
    });
    expect(cart).toHaveLength(1);
    expect(cart[0]).toMatchObject({ productId: 'p1', price: 10, mrp: 0, qty: 1 });
  });

  it('maps a server order: bill, address, payment and the salon status track', () => {
    const order = mapServerOrder({
      orderId: 'MN123',
      salonId: 'salon-1',
      salon: { salonName: 'Golden Scissors' },
      items: [{ productId: 'p1', name: 'A', price: '199.00', mrp: '249.00', image: 'a.jpg', category: 'beard-care', gender: 'MALE', salonName: '', qty: 2 }],
      address: { name: 'R', phone: '9876543210', line1: '12 Main', city: 'Nagpur', state: 'MH', pincode: '440010' },
      payment: { method: 'COD', status: 'PENDING', paymentId: '', amount: '447.00' },
      amounts: { itemTotal: '398.00', savings: '100.00', deliveryFee: '49.00', total: '447.00' },
      status: 'CONFIRMED',
      customerStatus: 'CONFIRMED',
      createdAt: '2026-10-15T10:00:00.000Z',
      cancelledAt: null,
      cancelReason: '',
    });
    expect(order.id).toBe('MN123');
    expect(order.serverStatus).toBe('CONFIRMED');
    expect(order.placedAt).toBe('2026-10-15T10:00:00.000Z');
    expect(order.items).toEqual([
      { productId: 'p1', name: 'A', price: 199, mrp: 249, image: 'a.jpg', category: 'beard-care', gender: 'MALE', salonName: 'Golden Scissors', qty: 2 },
    ]);
    expect(order.amounts).toEqual({ itemTotal: 398, savings: 100, deliveryFee: 49, total: 447 });
    expect(order.payment).toEqual({ method: 'COD', status: 'PENDING', paymentId: '', amount: 447 });
    expect(order.address).toEqual({ name: 'R', phone: '9876543210', line1: '12 Main', city: 'Nagpur', state: 'MH', pincode: '440010' });
    expect(order.cancelledAt).toBeNull();
  });

  it('maps a cancelled server order with its refund flag', () => {
    const order = mapServerOrder({
      orderId: 'MN456',
      items: [{ productId: 'p1', name: 'A', price: 100, qty: 1 }],
      address: { name: 'R', phone: '9876543210', line1: 'x', city: 'N', pincode: '440010' },
      payment: { method: 'ONLINE', status: 'REFUND_REQUESTED', paymentId: 'pay_1', amount: 149 },
      amounts: { itemTotal: 100, savings: 0, deliveryFee: 49, total: 149 },
      status: 'CANCELLED',
      createdAt: '2026-10-15T10:00:00.000Z',
      cancelledAt: '2026-10-15T10:20:00.000Z',
      cancelReason: 'changed mind',
    });
    expect(order.serverStatus).toBe('CANCELLED');
    expect(order.cancelledAt).toBe('2026-10-15T10:20:00.000Z');
    expect(order.payment.status).toBe('REFUND_REQUESTED');
  });
});

describe('customer status mapping', () => {
  it('maps the salon track onto the 4-step tracker', () => {
    expect(customerStatusToTrackerKey('PENDING')).toBe('placed');
    expect(customerStatusToTrackerKey('CONFIRMED')).toBe('packed');
    expect(customerStatusToTrackerKey('PROCESSING')).toBe('shipped');
    expect(customerStatusToTrackerKey('SHIPPED')).toBe('shipped');
    expect(customerStatusToTrackerKey('DELIVERED')).toBe('delivered');
    expect(customerStatusToTrackerKey('CANCELLED')).toBe('cancelled');
    expect(customerStatusToTrackerKey('nope')).toBeNull();
    expect(customerStatusToTrackerKey('')).toBeNull();
  });

  it('lists exactly the cancellable server statuses', () => {
    expect([...CANCELLABLE_SERVER_STATUSES].sort()).toEqual(['CONFIRMED', 'PENDING', 'PROCESSING']);
  });
});

describe('session guard', () => {
  it('never touches the network for a guest', async () => {
    expect(await fetchServerCart()).toBeNull();
    expect(await fetchServerOrders()).toBeNull();
    expect(await fetchAllServerOrders()).toBeNull();
    expect(await fetchServerOrderById('MN1')).toBeNull();
    // A guest cannot place a real order, and the result says so instead of
    // pretending (that silence was the original bug).
    await expect(registerServerOrder({ id: 'MN1' })).resolves.toMatchObject({ ok: false, code: 'NO_SESSION' });
    expect(await pushCartAdd('p1')).toBe(false);
    expect(await pushCartSetQty('p1', 2)).toBe(false);
    expect(await pushCartRemove('p1')).toBe(false);
    expect(await clearServerCart()).toBe(false);
    expect(await cancelServerOrder('MN1')).toBe(false);
    expect(shopCartGet).not.toHaveBeenCalled();
    expect(shopOrderList).not.toHaveBeenCalled();
  });
});

describe('cart sync (signed in)', () => {
  it('pulls the server cart and pushes add/set/remove/clear', async () => {
    signedIn();
    shopCartGet.mockResolvedValue({ data: { lines: [{ productId: 'p1', name: 'A', price: 100, qty: 2 }] } });
    expect(await fetchServerCart()).toEqual([{ productId: 'p1', name: 'A', price: 100, mrp: 0, image: '', category: '', gender: '', salonName: '', qty: 2 }]);

    shopCartAdd.mockResolvedValue({ status: 'SUCCESS' });
    await expect(pushCartAdd('p1', 2)).resolves.toBe(true);
    expect(shopCartAdd).toHaveBeenCalledWith({ productId: 'p1', qty: 2 });

    shopCartSetQty.mockResolvedValue({ status: 'SUCCESS' });
    await expect(pushCartSetQty('p1', 5)).resolves.toBe(true);
    expect(shopCartSetQty).toHaveBeenCalledWith({ productId: 'p1', qty: 5 });

    shopCartRemove.mockResolvedValue({ status: 'SUCCESS' });
    await expect(pushCartRemove('p1')).resolves.toBe(true);
    expect(shopCartRemove).toHaveBeenCalledWith({ productId: 'p1' });

    shopCartClear.mockResolvedValue({ status: 'SUCCESS' });
    await expect(clearServerCart()).resolves.toBe(true);
    expect(shopCartClear).toHaveBeenCalled();
  });

  it('swallows failures (the local copy keeps the session alive)', async () => {
    signedIn();
    shopCartGet.mockRejectedValue(new Error('offline'));
    expect(await fetchServerCart()).toBeNull();
    shopCartAdd.mockRejectedValue(new Error('offline'));
    await expect(pushCartAdd('p1')).resolves.toBe(false);
  });
});

describe('order sync (signed in)', () => {
  const serverOrder = () => ({
    orderId: 'MN123',
    items: [{ productId: 'p1', name: 'A', price: 100, qty: 1 }],
    address: { name: 'R', phone: '9876543210', line1: 'x', city: 'N', pincode: '440010' },
    payment: { method: 'COD', status: 'PENDING', paymentId: '', amount: 149 },
    amounts: { itemTotal: 100, savings: 0, deliveryFee: 49, total: 149 },
    status: 'PENDING',
    createdAt: '2026-10-15T10:00:00.000Z',
  });

  it('registers a client order under its own id', async () => {
    signedIn();
    shopOrderCreate.mockResolvedValue({ status: 'SUCCESS' });
    const order = {
      id: 'MNLOCAL1',
      items: [{ productId: PRODUCT_ID, name: 'A', price: 100, qty: 1 }],
      address: { name: 'R', phone: '9876543210', line1: 'x', city: 'N', state: 'MH', pincode: '440010' },
      payment: { method: 'ONLINE', status: 'PAID', paymentId: 'pay_1', amount: 149 },
      amounts: { itemTotal: 100, savings: 0, deliveryFee: 49, total: 149 },
    };
    await expect(registerServerOrder(order)).resolves.toMatchObject({ ok: true, code: 'OK' });
    expect(shopOrderCreate).toHaveBeenCalledWith({
      orderId: 'MNLOCAL1',
      items: [{ productId: PRODUCT_ID, name: 'A', price: 100, qty: 1 }],
      address: { name: 'R', phone: '9876543210', line1: 'x', city: 'N', state: 'MH', pincode: '440010' },
      payment: { method: 'ONLINE', status: 'PAID', paymentId: 'pay_1', amount: 149 },
    });
  });

  it('builds the create body from the contract, never the local order', () => {
    const order = {
      id: 'MNLOCAL2',
      items: [{ productId: PRODUCT_ID, name: 'A', price: 100, qty: 2, image: '/a.png', mrp: 150, bogus: 'x' }],
      address: {
        name: ' R ', phone: '98765-43210', line1: 'x', city: 'N', state: 'MH', pincode: '440010',
        latitude: 21.1458, longitude: 79.0882,
        // Neither of these may reach the API: the address schema is strict.
        landmark: 'Near temple', note: '',
      },
      payment: { method: 'COD', status: 'PENDING', amount: 249 },
      amounts: { total: 249 },
    };
    const withPin = buildOrderPayload(order);
    expect(Object.keys(withPin.address).sort()).toEqual(['city', 'latitude', 'line1', 'longitude', 'name', 'phone', 'pincode', 'state']);
    expect(withPin.address).toMatchObject({ name: 'R', phone: '9876543210', pincode: '440010', latitude: 21.1458, longitude: 79.0882 });
    expect(withPin.address).not.toHaveProperty('landmark');
    expect(withPin.items[0]).not.toHaveProperty('bogus');
    expect(withPin.payment).toEqual({ method: 'COD', status: 'PENDING', paymentId: '', amount: 249 });

    // The fallback the deployed API needs: the same body without the pin.
    const withoutPin = buildOrderPayload(order, { withCoordinates: false });
    expect(withoutPin.address).not.toHaveProperty('latitude');
    expect(withoutPin.address).not.toHaveProperty('longitude');
  });

  it('retries without the pin when the server rejects the coordinates, and stops sending them', async () => {
    signedIn();
    const rejection = Object.assign(new Error('"address.latitude" is not allowed'), { status: 400 });
    shopOrderCreate.mockRejectedValueOnce(rejection).mockResolvedValue({ status: 'SUCCESS', data: { orderId: 'MN1' } });
    const order = {
      id: 'MN1',
      items: [{ productId: PRODUCT_ID, name: 'A', price: 100, qty: 1 }],
      address: { name: 'R', phone: '9876543210', line1: 'x', city: 'N', state: 'MH', pincode: '440010', latitude: 21.1, longitude: 79.1 },
      payment: { method: 'COD', status: 'PENDING', amount: 149 },
      amounts: { total: 149 },
    };
    await expect(registerServerOrder(order)).resolves.toMatchObject({ ok: true });
    expect(shopOrderCreate).toHaveBeenCalledTimes(2);
    expect(shopOrderCreate.mock.calls[0][0].address).toHaveProperty('latitude', 21.1);
    expect(shopOrderCreate.mock.calls[1][0].address).not.toHaveProperty('latitude');
  });

  it('reports a rejection instead of swallowing it', async () => {
    signedIn();
    shopOrderCreate.mockRejectedValue(Object.assign(new Error('items.0.productId must be a valid GUID'), { status: 400 }));
    const order = {
      id: 'MN2',
      items: [{ productId: PRODUCT_ID, name: 'A', price: 100, qty: 1 }],
      address: { name: 'R', phone: '9876543210', line1: 'x', city: 'N', state: 'MH', pincode: '440010' },
      payment: { method: 'COD', status: 'PENDING', amount: 149 },
      amounts: { total: 149 },
    };
    const result = await registerServerOrder(order);
    expect(result).toMatchObject({ ok: false, code: 'VALIDATION', retryable: false });
    expect(result.message).toContain('valid GUID');
  });

  it('refuses a line that is not a catalog product, before calling the API', async () => {
    signedIn();
    const result = await registerServerOrder({
      id: 'MN3',
      items: [{ productId: 'p1', name: 'Demo soap', price: 100, qty: 1 }],
      address: { name: 'R', phone: '9876543210', line1: 'x', city: 'N', state: 'MH', pincode: '440010' },
      payment: { method: 'COD', status: 'PENDING', amount: 100 },
      amounts: { total: 100 },
    });
    expect(result).toMatchObject({ ok: false, code: 'INVALID_ITEM' });
    expect(result.message).toContain('Demo soap');
    expect(shopOrderCreate).not.toHaveBeenCalled();
  });

  it('queues a paid order that could not be registered and drains it later', async () => {
    signedIn();
    const order = {
      id: 'MNQ1',
      items: [{ productId: PRODUCT_ID, name: 'A', price: 100, qty: 1 }],
      address: { name: 'R', phone: '9876543210', line1: 'x', city: 'N', state: 'MH', pincode: '440010' },
      payment: { method: 'ONLINE', status: 'PAID', paymentId: 'pay_9', amount: 149 },
      amounts: { total: 149 },
    };
    shopOrderCreate.mockRejectedValueOnce(Object.assign(new Error('socket hang up'), { status: 0 }));
    await expect(registerServerOrder(order)).resolves.toMatchObject({ ok: false, code: 'NETWORK', retryable: true });

    expect(readPendingOrders()).toHaveLength(0);
    const { queuePendingOrder } = await import('./shopServerSync');
    queuePendingOrder(order);
    expect(readPendingOrders().map(entry => entry.orderId)).toEqual(['MNQ1']);

    shopOrderCreate.mockResolvedValue({ status: 'SUCCESS', data: { orderId: 'MNQ1' } });
    const { flushPendingOrders } = await import('./shopServerSync');
    const flushed = await flushPendingOrders();
    expect(flushed.synced.map(entry => entry.orderId)).toEqual(['MNQ1']);
    expect(readPendingOrders()).toHaveLength(0);
  });

  it('fetches the paged history until a short page ends it', async () => {
    signedIn();
    shopOrderList
      .mockResolvedValueOnce({ data: { orders: Array.from({ length: 20 }, (_, i) => serverOrder()) } })
      .mockResolvedValueOnce({ data: { orders: [serverOrder()] } });
    const all = await fetchAllServerOrders();
    expect(all).toHaveLength(21);
    expect(all.every(order => order.serverStatus === 'PENDING')).toBe(true);
  });

  it('returns null on a first-page failure (fall back to local) but keeps a partial later failure', async () => {
    signedIn();
    shopOrderList.mockRejectedValueOnce(new Error('down'));
    expect(await fetchAllServerOrders()).toBeNull();

    shopOrderList
      .mockResolvedValueOnce({ data: { orders: [serverOrder()] } })
      .mockRejectedValueOnce(new Error('down'));
    expect(await fetchAllServerOrders()).toHaveLength(1);
  });

  it('fetches a single order by id', async () => {
    signedIn();
    shopOrderGetById.mockResolvedValue({ data: serverOrder() });
    const order = await fetchServerOrderById('MN123');
    expect(order.id).toBe('MN123');
    expect(order.serverStatus).toBe('PENDING');
  });

  it('cancels through the server and reports refusals', async () => {
    signedIn();
    shopOrderCancel.mockResolvedValue({ status: 'SUCCESS' });
    await expect(cancelServerOrder('MN123', 'no need')).resolves.toBe(true);
    expect(shopOrderCancel).toHaveBeenCalledWith({ orderId: 'MN123', reason: 'no need' });

    shopOrderCancel.mockRejectedValue(new Error('already shipped'));
    await expect(cancelServerOrder('MN123')).resolves.toBe(false);
  });
});
