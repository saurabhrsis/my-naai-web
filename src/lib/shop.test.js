import { describe, it, expect, vi, beforeEach } from 'vitest';

const { shopProductList, createOrder, orderList, cancelOrder } = vi.hoisted(() => ({
  shopProductList: vi.fn(),
  createOrder: vi.fn(),
  orderList: vi.fn(),
  cancelOrder: vi.fn(),
}));

vi.mock('./api', async () => {
  const actual = await vi.importActual('./api');
  return { ...actual, api: { ...actual.api, shopProductList, createOrder, orderList, cancelOrder } };
});

const {
  cancelShopOrder,
  canCancelOrder,
  cartLineFromProduct,
  cartTotals,
  filterShopProducts,
  isLowStock,
  loadOrders,
  loadShopProducts,
  maxOrderQuantity,
  normalizeOrder,
  normalizeShopProduct,
  readCart,
  readSaved,
  reconcileCart,
  reconcileSaved,
  relatedShopProducts,
  salonAddressFromProfile,
  saveCart,
  saveSaved,
  sortShopProducts,
  submitOrder,
  validateAddress,
} = await import('./shop');

const PRODUCT = {
  productId: 'p1',
  productName: 'Hair Colour — Natural Brown',
  brand: 'Keune',
  category: 'Hair colour',
  price: 520,
  mrp: 590,
  stock: 12,
  unit: '1 tube',
  productImage: '',
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('normalizeShopProduct', () => {
  it('reads the field names the products API already uses', () => {
    const product = normalizeShopProduct(PRODUCT);
    expect(product.id).toBe('p1');
    expect(product.name).toBe('Hair Colour — Natural Brown');
    expect(product.price).toBe(520);
    expect(product.available).toBe(true);
  });

  it('accepts the shorter aliases other surfaces send', () => {
    const product = normalizeShopProduct({ id: 'x1', name: 'Scissors', sellingPrice: 900, image: '/a.png', inStock: false });
    expect(product.id).toBe('x1');
    expect(product.price).toBe(900);
    expect(product.available).toBe(false);
    expect(product.image).toBe('/a.png');
  });

  it('only shows a strikethrough price when it is really higher', () => {
    expect(normalizeShopProduct({ ...PRODUCT, mrp: 520 }).mrp).toBe(0);
    expect(normalizeShopProduct({ ...PRODUCT, mrp: 700 }).mrp).toBe(700);
  });

  it('treats zero stock as sold out even without an availability flag', () => {
    expect(normalizeShopProduct({ ...PRODUCT, stock: 0 }).available).toBe(false);
  });
});

describe('cartTotals', () => {
  // Delivery is free: the salon pays exactly what the items cost, with no fee
  // line and no threshold to reach.
  it('charges nothing beyond the items', () => {
    const totals = cartTotals([{ price: 200, quantity: 2 }]);
    expect(totals.subtotal).toBe(400);
    expect(totals.total).toBe(400);
    expect(totals.deliveryFee).toBeUndefined();
    expect(totals.amountToFreeDelivery).toBeUndefined();
  });

  it('adds up savings against the MRP', () => {
    const totals = cartTotals([{ price: 1000, mrp: 1200, quantity: 1 }]);
    expect(totals.savings).toBe(200);
    expect(totals.total).toBe(1000);
  });

  it('is empty-safe', () => {
    expect(cartTotals([])).toMatchObject({ itemCount: 0, subtotal: 0, total: 0 });
  });
});

describe('delivery address', () => {
  it('defaults to the salon profile, including a profile nested under `salon`', () => {
    const address = salonAddressFromProfile({
      salon: {
        salonName: 'Glamour Studio',
        ownerName: 'Ravi',
        phoneNumber: '9876543210',
        addressLine1: '12 Sitabuldi Main Road',
        city: 'Nagpur',
        state: 'Maharashtra',
        pincode: '440012',
      },
    });
    expect(address).toEqual({
      name: 'Ravi',
      phone: '9876543210',
      line1: '12 Sitabuldi Main Road',
      line2: '',
      city: 'Nagpur',
      state: 'Maharashtra',
      pincode: '440012',
    });
  });

  it('names the field that is missing instead of failing at the API', () => {
    const errors = validateAddress({ name: 'Ravi', line1: 'Road', city: 'Nagpur', pincode: '44001', phone: '98765' });
    expect(errors.pincode).toBeTruthy();
    expect(errors.phone).toBeTruthy();
    expect(validateAddress(salonAddressFromProfile({ ownerName: 'Ravi', phoneNumber: '9876543210', addressLine1: '12', city: 'Nagpur', pincode: '440012' }))).toEqual({});
  });
});

describe('normalizeOrder', () => {
  it('reads seconds, milliseconds and ISO timestamps alike', () => {
    const seconds = 1730000000;
    expect(normalizeOrder({ orderId: 'o1', createdAt: seconds }).createdAt).toBe(seconds * 1000);
    expect(normalizeOrder({ orderId: 'o1', createdAt: seconds * 1000 }).createdAt).toBe(seconds * 1000);
    expect(normalizeOrder({ orderId: 'o1', orderDate: '2026-10-07T10:00:00Z' }).createdAt).toBe(new Date('2026-10-07T10:00:00Z').getTime());
  });

  it('totals an order from its lines when the API omits the money fields', () => {
    const order = normalizeOrder({
      orderId: 'o1',
      status: 'PLACED',
      items: [{ productId: 'p1', productName: 'Scrub', quantity: 2, price: 400 }],
    });
    expect(order.subtotal).toBe(800);
    // Delivery is free, so the total is the items — no fee is added anywhere.
    expect(order.totalAmount).toBe(800);
    expect(order.itemCount).toBe(2);
    expect(order.statusMeta.label).toBe('Order placed');
  });
});

describe('canCancelOrder', () => {
  it('lets a partner cancel anything that has not been delivered yet', () => {
    ['PLACED', 'CONFIRMED', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY'].forEach(status => {
      expect(canCancelOrder({ status })).toBe(true);
    });
  });

  it('locks the two final states', () => {
    expect(canCancelOrder({ status: 'DELIVERED' })).toBe(false);
    expect(canCancelOrder({ status: 'CANCELLED' })).toBe(false);
  });
});

describe('cart storage and reconciliation', () => {
  it('keeps one cart per salon', () => {
    saveCart('salon-1', [cartLineFromProduct(normalizeShopProduct(PRODUCT), 2)]);
    saveCart('salon-2', [cartLineFromProduct(normalizeShopProduct({ ...PRODUCT, productId: 'p9' }), 1)]);
    expect(readCart('salon-1')).toHaveLength(1);
    expect(readCart('salon-2')[0].productId).toBe('p9');
    expect(readCart('salon-3')).toEqual([]);
  });

  it('drops what admin removed or ran out of, and caps what is left', () => {
    const cart = [
      cartLineFromProduct(normalizeShopProduct(PRODUCT), 20),
      cartLineFromProduct(normalizeShopProduct({ ...PRODUCT, productId: 'gone' }), 1),
      cartLineFromProduct(normalizeShopProduct({ ...PRODUCT, productId: 'p3', stock: 0 }), 1),
    ];
    const products = [normalizeShopProduct(PRODUCT), normalizeShopProduct({ ...PRODUCT, productId: 'p3', stock: 0 })];
    const next = reconcileCart(cart, products);
    expect(next).toHaveLength(1);
    // Stock is 12, so a cart of 20 is capped — never ordered blind.
    expect(next[0].quantity).toBe(12);
  });

  it('never allows ordering more than the shelf has', () => {
    expect(maxOrderQuantity(normalizeShopProduct(PRODUCT))).toBe(12);
    expect(maxOrderQuantity(normalizeShopProduct({ ...PRODUCT, stock: 0 }))).toBe(0);
  });
});

describe('filterShopProducts', () => {
  const products = [
    normalizeShopProduct(PRODUCT),
    normalizeShopProduct({ ...PRODUCT, productId: 'p2', productName: 'Scalp Scrub', category: 'Hair care', brand: 'Pure Roots' }),
  ];

  it('matches name, brand and category', () => {
    expect(filterShopProducts(products, { search: 'scrub' }).map(item => item.id)).toEqual(['p2']);
    expect(filterShopProducts(products, { search: 'keune' }).map(item => item.id)).toEqual(['p1']);
  });

  it('filters by category, and "All" filters nothing', () => {
    expect(filterShopProducts(products, { category: 'Hair care' }).map(item => item.id)).toEqual(['p2']);
    expect(filterShopProducts(products, { category: 'All' })).toHaveLength(2);
    expect(filterShopProducts(products, {})).toHaveLength(2);
  });
});

describe('product photos', () => {
  it('flattens every shape admin can send into one list', () => {
    expect(normalizeShopProduct({ ...PRODUCT, imagesArray: ['a.png', 'b.png'] }).images.slice(0, 2)).toEqual(['a.png', 'b.png']);
    expect(normalizeShopProduct({ ...PRODUCT, images: ['a.png'] }).images).toEqual(['a.png']);
    expect(normalizeShopProduct(PRODUCT).images).toEqual([]);
  });

  it('keeps the single product image as the first photo', () => {
    const product = normalizeShopProduct({ ...PRODUCT, productImage: 'main.png', images: ['extra.png'] });
    expect(product.images).toEqual(['main.png', 'extra.png']);
    expect(product.image).toBe('main.png');
  });
});

describe('shelf sorting and filtering', () => {
  const shelf = [
    normalizeShopProduct({ ...PRODUCT, productId: 'a', productName: 'Argan Serum', price: 560, rating: 4.1, category: 'Hair care' }),
    normalizeShopProduct({ ...PRODUCT, productId: 'b', productName: 'Colour Tube', price: 520, rating: 4.8, category: 'Hair colour' }),
    normalizeShopProduct({ ...PRODUCT, productId: 'c', productName: 'Scissors', price: 1150, rating: 4.6, stock: 0, category: 'Tools' }),
  ];

  it('sorts by price both ways, by name and by rating', () => {
    expect(sortShopProducts(shelf, 'price-asc').map(item => item.id)).toEqual(['b', 'a', 'c']);
    expect(sortShopProducts(shelf, 'price-desc').map(item => item.id)).toEqual(['c', 'a', 'b']);
    expect(sortShopProducts(shelf, 'name').map(item => item.id)).toEqual(['a', 'b', 'c']);
    expect(sortShopProducts(shelf, 'rating').map(item => item.id)).toEqual(['b', 'c', 'a']);
    // Relevance is the API's own order — never reshuffled.
    expect(sortShopProducts(shelf, 'relevance').map(item => item.id)).toEqual(['a', 'b', 'c']);
    expect(sortShopProducts(shelf).map(item => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the shelf it was given', () => {
    const original = shelf.map(item => item.id);
    sortShopProducts(shelf, 'price-desc');
    expect(shelf.map(item => item.id)).toEqual(original);
  });

  it('hides what cannot be ordered when in-stock only is on', () => {
    expect(filterShopProducts(shelf, { inStockOnly: true }).map(item => item.id)).toEqual(['a', 'b']);
    expect(filterShopProducts(shelf, {}).map(item => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('flags low stock without alarming about a well-stocked shelf', () => {
    expect(isLowStock(normalizeShopProduct({ ...PRODUCT, stock: 4 }))).toBe(true);
    expect(isLowStock(normalizeShopProduct({ ...PRODUCT, stock: 60 }))).toBe(false);
    // Sold out is not "low stock" — it has its own chip.
    expect(isLowStock(normalizeShopProduct({ ...PRODUCT, stock: 0 }))).toBe(false);
  });

  it('suggests the same category first, then the rest of the shelf', () => {
    const related = relatedShopProducts(shelf, shelf[1], 6);
    expect(related.map(item => item.id)).toEqual(['a', 'c']);
    expect(relatedShopProducts(shelf, null, 2).map(item => item.id)).toEqual(['a', 'b']);
  });
});

describe('saved for later', () => {
  it('is stored per salon, next to the cart', () => {
    saveSaved('salon-1', [cartLineFromProduct(normalizeShopProduct(PRODUCT), 1)]);
    saveSaved('salon-2', [cartLineFromProduct(normalizeShopProduct({ ...PRODUCT, productId: 'p9' }), 1)]);
    expect(readSaved('salon-1')).toHaveLength(1);
    expect(readSaved('salon-2')[0].productId).toBe('p9');
    expect(readSaved('salon-3')).toEqual([]);
  });

  it('keeps a saved item that went out of stock, and drops one that was removed', () => {
    const saved = [
      cartLineFromProduct(normalizeShopProduct(PRODUCT), 1),
      cartLineFromProduct(normalizeShopProduct({ ...PRODUCT, productId: 'gone' }), 1),
    ];
    const products = [normalizeShopProduct({ ...PRODUCT, stock: 0 })];
    const next = reconcileSaved(saved, products);
    expect(next).toHaveLength(1);
    expect(next[0].productId).toBe('p1');
    // Out of stock is survivable for a saved item — it may be back next week.
    expect(next[0].available).toBe(false);
  });
});

describe('shop API', () => {
  it('loads the catalog the API publishes', async () => {
    shopProductList.mockResolvedValue({ status: 'SUCCESS', data: { products: [PRODUCT] } });
    const result = await loadShopProducts({ search: '', category: 'All' });
    expect(result.source).toBe('api');
    expect(result.products[0].name).toBe('Hair Colour — Natural Brown');
    expect(shopProductList).toHaveBeenCalledWith({ search: '', category: 'All' });
  });

  it('reads a bare array as well as { data: { products } }', async () => {
    shopProductList.mockResolvedValue({ products: [PRODUCT] });
    const result = await loadShopProducts({});
    expect(result.products).toHaveLength(1);
  });

  it('honours an empty catalog instead of inventing products', async () => {
    shopProductList.mockResolvedValue({ status: 'SUCCESS', data: { products: [] } });
    const result = await loadShopProducts({});
    expect(result.products).toEqual([]);
    expect(result.source).toBe('api');
  });

  // The endpoints are new, so a review build must still show a shop: a FAILED
  // or unreachable catalog degrades to the sample one and SAYS it did — it must
  // never be mistaken for the products admin actually published.
  it('falls back to the sample catalog, and flags it, when the service says FAILED', async () => {
    shopProductList.mockResolvedValue({ status: 'FAILED', message: 'Catalog unavailable' });
    const result = await loadShopProducts({});
    expect(result.source).toBe('sample');
    expect(result.error?.message).toBe('Catalog unavailable');
    expect(result.products.length).toBeGreaterThan(0);
  });

  it('falls back to the sample catalog when the request itself fails', async () => {
    shopProductList.mockRejectedValue(new Error('network down'));
    const result = await loadShopProducts({});
    expect(result.source).toBe('sample');
    expect(result.products.length).toBeGreaterThan(0);
  });

  it('filters the sample catalog by the same search and category the API gets', async () => {
    shopProductList.mockRejectedValue(new Error('network down'));
    const result = await loadShopProducts({ search: 'scissors', category: 'Tools' });
    expect(result.products.length).toBeGreaterThan(0);
    expect(result.products.every(product => /scissors/i.test(product.name))).toBe(true);
    expect(result.products.every(product => product.category === 'Tools')).toBe(true);
  });

  it('places the order with the lines, the address and the money', async () => {
    createOrder.mockResolvedValue({ status: 'SUCCESS', data: { order: { orderId: 'o1', orderNumber: 'MN1001', status: 'PLACED', createdAt: Date.now() } } });
    const items = [cartLineFromProduct(normalizeShopProduct(PRODUCT), 2)];
    const address = { name: 'Ravi', phone: '9876543210', line1: '12 Sitabuldi', city: 'Nagpur', state: 'Maharashtra', pincode: '440012' };
    const result = await submitOrder({ items, address, note: 'Ring the bell' }, { salonId: 'salon-1' });

    expect(result.source).toBe('api');
    expect(result.order.orderNumber).toBe('MN1001');
    expect(result.order.canCancel).toBe(true);
    const payload = createOrder.mock.calls[0][0];
    expect(payload.items).toEqual([{ productId: 'p1', name: 'Hair Colour — Natural Brown', quantity: 2, price: 520 }]);
    expect(payload.address.pincode).toBe('440012');
    expect(payload.paymentMethod).toBe('COD');
    expect(payload.note).toBe('Ring the bell');
    expect(payload.subtotal).toBe(1040);
    expect(payload.deliveryFee).toBeUndefined();
    expect(payload.totalAmount).toBe(1040);
  });

  it('lists orders newest first', async () => {
    orderList.mockResolvedValue({
      status: 'SUCCESS',
      data: { orders: [{ orderId: 'old', createdAt: 1700000000 }, { orderId: 'new', createdAt: 1800000000 }] },
    });
    const result = await loadOrders({ salonId: 'salon-1' });
    expect(result.orders.map(order => order.id)).toEqual(['new', 'old']);
  });

  it('cancels through the API and marks the order cancelled', async () => {
    cancelOrder.mockResolvedValue({ status: 'SUCCESS', data: { order: { orderId: 'o1', status: 'CANCELLED' } } });
    const result = await cancelShopOrder('o1', 'not needed', { salonId: 'salon-1' });
    expect(cancelOrder).toHaveBeenCalledWith({ orderId: 'o1', reason: 'not needed' });
    expect(result.order.status).toBe('CANCELLED');
    expect(result.order.canCancel).toBe(false);
  });

  it('stores the order on the device when the order service cannot be reached', async () => {
    createOrder.mockRejectedValue(new Error('network down'));
    orderList.mockRejectedValue(new Error('network down'));
    const items = [cartLineFromProduct(normalizeShopProduct(PRODUCT), 1)];
    const address = { name: 'Ravi', phone: '9876543210', line1: '12 Sitabuldi', city: 'Nagpur', pincode: '440012' };
    const result = await submitOrder({ items, address }, { salonId: 'salon-1' });
    expect(result.source).toBe('local');
    const stored = await loadOrders({ salonId: 'salon-1' });
    expect(stored.source).toBe('local');
    expect(stored.orders).toHaveLength(1);
    expect(stored.orders[0].items[0].name).toBe('Hair Colour — Natural Brown');

    // ...and a cancel while offline still settles the order on the device.
    cancelOrder.mockRejectedValue(new Error('network down'));
    const cancelled = await cancelShopOrder(stored.orders[0].id, '', { salonId: 'salon-1' });
    expect(cancelled.source).toBe('local');
    expect(cancelled.order.status).toBe('CANCELLED');
    expect((await loadOrders({ salonId: 'salon-1' })).orders[0].status).toBe('CANCELLED');
  });
});
