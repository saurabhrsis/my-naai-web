import { describe, expect, it, beforeEach } from 'vitest';
import {
  DELIVERY_AT_MINUTES,
  DELIVERY_FEE,
  FREE_DELIVERY_ABOVE,
  ACTIVE_ORDER_STATUSES,
  addToCart,
  canCancelOrder,
  cancelOrder,
  cartCount,
  cartTotals,
  clearCart,
  clearShopStorage,
  findOrder,
  freeDeliveryGap,
  getOrderStatus,
  placeOrder,
  readCart,
  readOrders,
  removeCartLine,
  setCartQty,
  upsertLocalOrder,
} from './shopOrders';

const NOW = Date.parse('2026-10-15T10:00:00Z');

beforeEach(() => {
  localStorage.clear();
});

const product = (id, price, mrp = 0) => ({ id, name: `Product ${id}`, price, mrp, image: '', category: 'hair-care', gender: 'unisex' });

describe('cart', () => {
  it('adds, bumps, sets and removes lines per salon account', () => {
    expect(readCart('salon-1')).toEqual([]);
    addToCart('salon-1', product('p1', 199));
    addToCart('salon-1', product('p1', 199));
    addToCart('salon-1', product('p2', 499, 600));
    const cart = readCart('salon-1');
    expect(cart).toHaveLength(2);
    expect(cart[0]).toMatchObject({ productId: 'p1', qty: 2, price: 199 });
    expect(cartCount(cart)).toBe(3);

    expect(setCartQty('salon-1', 'p1', 1)[0].qty).toBe(1);
    expect(setCartQty('salon-1', 'p2', 0)).toHaveLength(1); // zero removes
    expect(removeCartLine('salon-1', 'p1')).toHaveLength(0);
    expect(clearCart('salon-1')).toHaveLength(0);
  });

  it('keeps one cart per salon account', () => {
    addToCart('salon-1', product('p1', 100));
    addToCart('salon-2', product('p2', 200));
    expect(readCart('salon-1')).toHaveLength(1);
    expect(readCart('salon-2')).toHaveLength(1);
    expect(readCart('salon-1')[0].productId).toBe('p1');
  });

  it('caps quantities at a sane maximum', () => {
    for (let i = 0; i < 200; i += 1) addToCart('salon-1', product('p1', 100));
    expect(readCart('salon-1')[0].qty).toBe(99);
  });
});

describe('cartTotals', () => {
  it('charges the delivery fee below the free threshold and waives it above', () => {
    const small = cartTotals([product('p1', 199)]);
    expect(small.deliveryFee).toBe(DELIVERY_FEE);
    expect(small.total).toBe(199 + DELIVERY_FEE);
    expect(freeDeliveryGap([product('p1', 199)])).toBe(FREE_DELIVERY_ABOVE - 199);

    const big = cartTotals([product('p1', 199), { ...product('p2', 499), qty: 1 }]);
    expect(big.deliveryFee).toBe(0);
    expect(freeDeliveryGap([product('p1', 199), product('p2', 499)])).toBe(0);
  });

  it('counts MRP savings per unit and never goes negative', () => {
    const lines = [{ ...product('p1', 160, 200), qty: 2 }];
    const totals = cartTotals(lines);
    expect(totals.savings).toBe(80);
    expect(totals.itemTotal).toBe(320);
  });

  it('is zero on an empty cart', () => {
    expect(cartTotals([])).toMatchObject({ itemCount: 0, itemTotal: 0, deliveryFee: 0, total: 0 });
  });

  // Admin-managed rules (the shop_settings row). The numbers mirror the
  // backend's computeTotals — the two implementations must stay in lock-step.
  const RULES = { freeDeliveryAbove: 500, deliveryFee: 40, discountPercent: 10, codThreshold: 1000, codCharges: 25 };

  it('applies the discount, the free threshold on the after-discount subtotal, and COD charges', () => {
    const totals = cartTotals([product('p1', 550)], RULES, { method: 'COD' });
    expect(totals.itemTotal).toBe(550);
    expect(totals.discount).toBe(55); // 10% of 550
    expect(totals.subtotal).toBe(495);
    expect(totals.deliveryFee).toBe(40); // 495 < 500 → charged
    expect(totals.codFee).toBe(25);
    expect(totals.total).toBe(560); // 495 + 40 + 25
    expect(freeDeliveryGap([product('p1', 550)], RULES)).toBe(5);
  });

  it('waives delivery once the after-discount subtotal clears the threshold, and adds no COD fee for online', () => {
    const totals = cartTotals([product('p1', 1500)], RULES, { method: 'ONLINE' });
    expect(totals.discount).toBe(150);
    expect(totals.subtotal).toBe(1350);
    expect(totals.deliveryFee).toBe(0); // 1350 ≥ 500
    expect(totals.codFee).toBe(0);
    expect(totals.total).toBe(1350);
  });

  it('clamps a bogus discount to 0–100 instead of emitting NaN', () => {
    expect(cartTotals([product('p1', 200)], { ...RULES, discountPercent: 150 })).toMatchObject({ discount: 200, subtotal: 0, total: 40 });
    expect(cartTotals([product('p1', 200)], { ...RULES, discountPercent: -10 }).deliveryFee).toBe(40);
  });

  it('keeps the historic bill when no settings are passed', () => {
    expect(cartTotals([product('p1', 199)])).toMatchObject({ discount: 0, codFee: 0, deliveryFee: 49, total: 248, freeDeliveryAbove: 499 });
  });
});

describe('order lifecycle', () => {
  // Orders are placed at the fixed NOW so the timeline math is exact.
  const place = (overrides = {}) => placeOrder('salon-1', {
    items: [product('p1', 199), product('p2', 499, 600)],
    address: { name: 'Ramesh', phone: '9876543210', line1: '12 Main Road', city: 'Nagpur', state: 'MH', pincode: '440010' },
    payment: { method: 'ONLINE', status: 'PAID', paymentId: 'pay_1', amount: 747 },
    amounts: { itemTotal: 698, savings: 101, deliveryFee: 0, total: 698 },
    salonName: 'Golden Scissors',
    ...overrides,
  }, { now: NOW });

  it('places orders with a readable id and newest-first listing', () => {
    const first = place();
    const second = place();
    expect(first.id).toMatch(/^MN[A-Z0-9]+$/);
    expect(first.id).not.toBe(second.id);
    expect(readOrders('salon-1')).toHaveLength(2);
    expect(readOrders('salon-1')[0].id).toBe(second.id);
    // placedAt is the injected placement time, stored as an ISO timestamp.
    expect(readOrders('salon-1')[0].placedAt).toBe(new Date(NOW).toISOString());
    expect(findOrder('salon-1', first.id).id).toBe(first.id);
    expect(findOrder('salon-1', 'nope')).toBeNull();
  });

  it('walks placed → packed → shipped → delivered on the timeline', () => {
    const order = place();
    const at = (minutes) => getOrderStatus(order, new Date(NOW + minutes * 60000).getTime()).key;
    expect(at(1)).toBe('placed');
    expect(at(31)).toBe('packed');
    expect(at(200)).toBe('shipped');
    expect(at(DELIVERY_AT_MINUTES)).toBe('delivered');
    const delivered = getOrderStatus(order, new Date(NOW + DELIVERY_AT_MINUTES * 60000).getTime());
    expect(delivered.progress).toBe(100);
    expect(delivered.eta instanceof Date).toBe(true);
    expect(ACTIVE_ORDER_STATUSES).toContain('shipped');
  });

  it('allows cancellation while placed/packed, blocks it once shipped', () => {
    const order = place();
    const packedAt = new Date(NOW + 45 * 60000).getTime();
    expect(canCancelOrder(order, packedAt)).toBe(true);
    const cancelled = cancelOrder('salon-1', order.id, { now: packedAt, reason: 'Changed my mind' });
    expect(cancelled.cancelledAt).toBeTruthy();
    expect(cancelled.cancelReason).toBe('Changed my mind');
    expect(cancelled.payment.status).toBe('REFUND_REQUESTED');
    expect(getOrderStatus(cancelled, packedAt).key).toBe('cancelled');

    const late = place();
    const shippedAt = new Date(NOW + 200 * 60000).getTime();
    expect(canCancelOrder(late, shippedAt)).toBe(false);
    const unchanged = cancelOrder('salon-1', late.id, { now: shippedAt });
    expect(unchanged.cancelledAt).toBeNull();
    expect(unchanged.payment.status).toBe('PAID');
  });

  it('keeps COD cancellations clean (nothing paid, nothing refunded)', () => {
    const order = place({ payment: { method: 'COD', status: 'PENDING', amount: 698 } });
    const cancelled = cancelOrder('salon-1', order.id, { now: NOW });
    expect(cancelled.payment.status).toBe('PENDING');
    expect(getOrderStatus(cancelled, NOW).key).toBe('cancelled');
  });

  it('lets the server status track override the clock on the tracker', () => {
    // 200 minutes old: the clock alone would already say "shipped".
    const late = NOW + 200 * 60000;
    const base = place();

    expect(getOrderStatus({ ...base, serverStatus: 'PENDING' }, late).key).toBe('placed');
    expect(getOrderStatus({ ...base, serverStatus: 'CONFIRMED' }, late).key).toBe('packed');
    expect(getOrderStatus({ ...base, serverStatus: 'PROCESSING' }, late).key).toBe('shipped');
    expect(getOrderStatus({ ...base, serverStatus: 'SHIPPED' }, late).key).toBe('shipped');
    expect(getOrderStatus({ ...base, serverStatus: 'DELIVERED' }, late).key).toBe('delivered');
    expect(getOrderStatus({ ...base, serverStatus: 'DELIVERED' }, late).stepIndex).toBe(3);
    expect(getOrderStatus({ ...base, serverStatus: 'CANCELLED' }, late).key).toBe('cancelled');
    // Unknown / missing server status falls back to the timeline.
    expect(getOrderStatus({ ...base, serverStatus: 'SOMETHING' }, late).key).toBe('shipped');
    expect(getOrderStatus(base, late).key).toBe('shipped');
  });

  it('gates cancellation on the server track for server-tracked orders', () => {
    const late = NOW + 200 * 60000; // clock says "shipped" (not cancellable)
    const base = place();

    // Purely local record: the clock rules (shipped → not cancellable).
    expect(canCancelOrder(base, late)).toBe(false);
    expect(cancelOrder('salon-1', base.id, { now: late }).cancelledAt).toBeNull();

    // Server track still "processing" — the parcel has not left the depot,
    // so it stays cancellable despite the clock.
    expect(canCancelOrder({ ...base, serverStatus: 'PROCESSING' }, late)).toBe(true);
    upsertLocalOrder('salon-1', { ...base, serverStatus: 'PROCESSING' });
    const serverCancelled = cancelOrder('salon-1', base.id, { now: late, reason: 'x' });
    expect(serverCancelled.cancelledAt).toBeTruthy();

    // Out for delivery on the server track — no more cancellations.
    upsertLocalOrder('salon-1', { ...base, serverStatus: 'SHIPPED', cancelledAt: null });
    expect(canCancelOrder({ ...base, serverStatus: 'SHIPPED' }, late)).toBe(false);
    expect(cancelOrder('salon-1', base.id, { now: late }).cancelledAt).toBeNull();

    // Cancellable server statuses.
    expect(canCancelOrder({ ...base, serverStatus: 'PENDING' }, late)).toBe(true);
    expect(canCancelOrder({ ...base, serverStatus: 'CONFIRMED' }, late)).toBe(true);
    expect(canCancelOrder({ ...base, serverStatus: 'CANCELLED' }, late)).toBe(false);
  });

  it('upserts server-fetched orders into the local history (server wins)', () => {
    const local = place();
    const serverCopy = { ...local, serverStatus: 'SHIPPED' };
    expect(upsertLocalOrder('salon-1', serverCopy).id).toBe(local.id);
    expect(readOrders('salon-1')).toHaveLength(1);
    expect(readOrders('salon-1')[0].serverStatus).toBe('SHIPPED');

    // A different order is added, not duplicated.
    upsertLocalOrder('salon-1', { ...local, id: 'MNOFFLINE1', serverStatus: 'PENDING' });
    expect(readOrders('salon-1')).toHaveLength(2);
  });

  it('is isolated per salon account', () => {
    place();
    expect(readOrders('salon-1')).toHaveLength(1);
    expect(readOrders('salon-2')).toHaveLength(0);
    clearShopStorage('salon-1');
    expect(readOrders('salon-1')).toHaveLength(0);
    expect(readCart('salon-1')).toEqual([]);
  });
});
