import React, { useState } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SalonShopScreen } from './SalonShopScreen';
import { ConfirmProvider } from './ConfirmDialog';

const { shopProductList, salonProfile, createOrder, orderList, cancelOrder } = vi.hoisted(() => ({
  shopProductList: vi.fn(),
  salonProfile: vi.fn(),
  createOrder: vi.fn(),
  orderList: vi.fn(),
  cancelOrder: vi.fn(),
}));

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual('../lib/api');
  return { ...actual, api: { ...actual.api, shopProductList, salonProfile, createOrder, orderList, cancelOrder } };
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CATALOG = [
  { productId: 'p1', productName: 'Hair Colour — Natural Brown', brand: 'Keune', category: 'Hair colour', price: 520, mrp: 590, stock: 12, unit: '1 tube', productImage: '' },
  { productId: 'p2', productName: 'Scalp Scrub — Charcoal', brand: 'Pure Roots', category: 'Hair care', price: 480, mrp: 549, stock: 4, unit: '200 ml', productImage: '' },
  // Out of stock: it must appear on the shelf but refuse to be ordered.
  { productId: 'p3', productName: 'Professional Scissors', brand: 'Naai Pro', category: 'Tools', price: 1150, mrp: 1499, stock: 0, unit: '1 piece', productImage: '' },
];

const SALON = {
  salonId: 'salon-1',
  salonName: 'Glamour Studio',
  ownerName: 'Ravi',
  phoneNumber: '9876543210',
  addressLine1: '12 Sitabuldi Main Road',
  addressLine2: 'Near VCA',
  city: 'Nagpur',
  state: 'Maharashtra',
  pincode: '440012',
};

const session = { role: 'SALON', userId: 'salon-1', user: { ...SALON } };

const placedOrder = (overrides = {}) => ({
  orderId: 'o1',
  orderNumber: 'MN1001',
  status: 'PLACED',
  createdAt: Date.now(),
  items: [{ productId: 'p1', productName: 'Hair Colour — Natural Brown', quantity: 2, price: 520 }],
  subtotal: 1040,
  totalAmount: 1040,
  paymentMethod: 'COD',
  address: { name: 'Ravi', phone: '9876543210', line1: '12 Sitabuldi Main Road', city: 'Nagpur', state: 'Maharashtra', pincode: '440012' },
  ...overrides,
});

let container = null;
let root = null;
let notify = null;
let go = null;

// The screen navigates through route params (`/shop?view=cart`), so the harness
// plays the router: `navigate('shop', params)` re-renders with the new params,
// exactly as AppRoot's history push does.
function Harness({ initialParams = {} }) {
  const [params, setParams] = useState(initialParams);
  go = (view, extra = {}) => setParams(view === 'browse' ? extra : { view, ...extra });
  return <ConfirmProvider>
    <SalonShopScreen
      session={session}
      params={params}
      navigate={(screen, nextParams = {}) => setParams({ ...nextParams, screen })}
      notify={notify}
    />
  </ConfirmProvider>;
}

async function mount(initialParams = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<Harness initialParams={initialParams} />); });
  await settle();
}

async function settle(ms = 15) {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); });
}

const click = async element => { await act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
// React installs its own value tracker on every input, so assigning `.value`
// directly leaves the tracker stale and onChange never fires. Going through the
// prototype's native setter is what a real keystroke does.
const type = async (input, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const flush = async () => { await act(async () => { await Promise.resolve(); }); };
const text = () => container.textContent;
const findByText = (selector, needle) => Array.from(container.querySelectorAll(selector))
  .find(node => node.textContent.toLowerCase().includes(String(needle).toLowerCase()));
const addButtons = () => Array.from(container.querySelectorAll('.shop-card-actions button'));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  notify = vi.fn();
  shopProductList.mockResolvedValue({ status: 'SUCCESS', data: { products: CATALOG } });
  salonProfile.mockResolvedValue({ status: 'SUCCESS', data: { salon: SALON } });
  createOrder.mockResolvedValue({ status: 'SUCCESS', data: { order: placedOrder() } });
  orderList.mockResolvedValue({ status: 'SUCCESS', data: { orders: [] } });
  cancelOrder.mockResolvedValue({ status: 'SUCCESS', data: { order: placedOrder({ status: 'CANCELLED' }) } });
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container?.remove();
  container = null;
  document.body.innerHTML = '';
});

describe('SalonShopScreen — browse', () => {
  it('shows the catalog admin published, with prices and stock', async () => {
    await mount();
    expect(text()).toContain('Salon shop');
    expect(text()).toContain('Hair Colour — Natural Brown');
    expect(text()).toContain('Scalp Scrub — Charcoal');
    expect(addButtons()).toHaveLength(3);
    // The out-of-stock product is on the shelf but cannot be added.
    expect(addButtons()[2].textContent).toContain('Sold out');
    expect(addButtons()[2].disabled).toBe(true);
  });

  it('searches and filters the shelf', async () => {
    await mount();
    await type(container.querySelector('.shop-search input'), 'scrub');
    await settle(350);
    expect(text()).toContain('Scalp Scrub — Charcoal');
    expect(text()).not.toContain('Hair Colour — Natural Brown');
  });

  it('shows an empty state when admin has published nothing, with no fake products', async () => {
    shopProductList.mockResolvedValue({ status: 'SUCCESS', data: { products: [] } });
    await mount();
    expect(text()).toContain('No products found');
    expect(text()).toContain('Admin has not published the catalog yet');
  });
});

describe('SalonShopScreen — product → cart', () => {
  it('opens a product and adds the chosen quantity', async () => {
    await mount();
    await click(addButtons()[0]);
    await settle();
    // The cart bar is the shop's running total, always one tap away.
    expect(container.querySelector('.shop-cart-bar').textContent).toContain('1 item in cart');
    expect(container.querySelector('.shop-cart-bar').textContent).toContain('520');
  });

  it('adds several units from the product page and keeps them in the cart', async () => {
    await mount();
    await click(container.querySelector('.shop-product-open'));
    await settle();
    expect(text()).toContain('Add to cart');
    await click(container.querySelector('.shop-detail-buy .shop-qty button[aria-label="Increase quantity"]'));
    await settle();
    await click(findByText('button', 'Add to cart'));
    await settle();
    expect(container.querySelector('.shop-cart-bar').textContent).toContain('2 items in cart');
    expect(container.querySelector('.shop-cart-bar').textContent).toContain('1,040');
  });

  it('remembers the cart after a reload', async () => {
    await mount();
    await click(addButtons()[0]);
    await settle();
    await act(async () => { root.unmount(); });
    await mount();
    expect(container.querySelector('.shop-cart-bar').textContent).toContain('1 item in cart');
  });

  it('caps a cart line at the stock admin has left', async () => {
    await mount();
    // p2 has 4 in stock.
    await click(addButtons()[1]);
    await settle();
    const cart = JSON.parse(localStorage.getItem('mynaai:shop-cart'));
    expect(cart['salon-1'][0].quantity).toBe(1);
    await click(container.querySelector('.shop-cart-bar button'));
    await settle();
    const increase = container.querySelector('.shop-cart-row .shop-qty button[aria-label="Increase quantity"]');
    await click(increase);
    await click(container.querySelector('.shop-cart-row .shop-qty button[aria-label="Increase quantity"]'));
    await click(container.querySelector('.shop-cart-row .shop-qty button[aria-label="Increase quantity"]'));
    await settle();
    expect(container.querySelector('.shop-cart-row .shop-qty span').textContent).toBe('4');
    expect(container.querySelector('.shop-cart-row .shop-qty button[aria-label="Increase quantity"]').disabled).toBe(true);
  });
});

describe('SalonShopScreen — checkout', () => {
  it('delivers to the salon address by default and places the order', async () => {
    await mount();
    await click(addButtons()[0]);
    await settle();
    await click(container.querySelector('.shop-cart-bar button'));
    await settle();
    expect(text()).toContain('Your cart');
    await click(findByText('button', 'Place order'));
    await settle();

    // Checkout: the salon's own address is already filled in.
    expect(text()).toContain('Checkout');
    const inputs = Array.from(container.querySelectorAll('.shop-form-grid input'));
    expect(inputs[0].value).toBe('Ravi');
    expect(inputs[1].value).toBe('9876543210');
    expect(inputs[2].value).toBe('12 Sitabuldi Main Road');
    expect(inputs[6].value).toBe('440012');

    await click(findByText('button', 'Place order'));
    await settle(30);

    expect(createOrder).toHaveBeenCalledTimes(1);
    const payload = createOrder.mock.calls[0][0];
    expect(payload.items).toEqual([{ productId: 'p1', name: 'Hair Colour — Natural Brown', quantity: 1, price: 520 }]);
    expect(payload.address).toMatchObject({ name: 'Ravi', line1: '12 Sitabuldi Main Road', city: 'Nagpur', pincode: '440012' });
    expect(payload.paymentMethod).toBe('COD');

    // The order is placed: the cart is emptied and the order opens.
    expect(text()).toContain('MN1001');
    expect(text()).toContain('Delivering to');
    expect(localStorage.getItem('mynaai:shop-cart')).toBe('{}');
    expect(notify).toHaveBeenCalledWith('success', 'Order MN1001 placed.');
  });

  it('charges no delivery — the total is what the items cost', async () => {
    await mount();
    await click(addButtons()[1]); // ₹480 scrub
    await settle();
    await click(container.querySelector('.shop-cart-bar button'));
    await settle();
    const summary = container.querySelector('.shop-summary-card').textContent;
    expect(summary).toContain('480');
    expect(summary).not.toContain('529');
    // Delivery is called out as free, never as a charge.
    expect(summary).toContain('Free');
    // Cart → checkout (the button is named the same on both screens), then place.
    await click(findByText('button', 'Place order'));
    await settle();
    await click(findByText('button', 'Place order'));
    await settle(30);
    expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({ subtotal: 480, totalAmount: 480 }));
  });

  it('refuses to place an order with an incomplete address', async () => {
    await mount();
    await click(addButtons()[0]);
    await settle();
    await click(container.querySelector('.shop-cart-bar button'));
    await settle();
    await click(findByText('button', 'Place order'));
    await settle();

    const city = Array.from(container.querySelectorAll('.shop-form-grid input'))[4];
    await type(city, '');
    await settle();
    await click(findByText('button', 'Place order'));
    await settle();

    expect(createOrder).not.toHaveBeenCalled();
    expect(text()).toContain('Add the city.');
    expect(notify).toHaveBeenCalledWith('error', 'Complete the delivery address to place your order.');
  });

  it('can be switched to a one-off address and back to the salon address', async () => {
    await mount();
    await click(addButtons()[0]);
    await settle();
    await click(container.querySelector('.shop-cart-bar button'));
    await settle();
    await click(findByText('button', 'Place order'));
    await settle();

    const line1 = Array.from(container.querySelectorAll('.shop-form-grid input'))[2];
    await type(line1, 'Godown no. 4, Hingna Road');
    await settle();
    expect(text()).toContain('Use salon address');
    await click(findByText('button', 'Use salon address'));
    await settle();
    expect(Array.from(container.querySelectorAll('.shop-form-grid input'))[2].value).toBe('12 Sitabuldi Main Road');
  });
});

describe('SalonShopScreen — orders', () => {
  it('lists the salon’s orders newest first', async () => {
    orderList.mockResolvedValue({
      status: 'SUCCESS',
      data: { orders: [placedOrder({ orderId: 'o1', orderNumber: 'MN1001', createdAt: 1700000000 }), placedOrder({ orderId: 'o2', orderNumber: 'MN1002', createdAt: 1800000000, status: 'DELIVERED' })] },
    });
    await mount({ view: 'orders' });
    const cards = Array.from(container.querySelectorAll('.shop-order-card'));
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain('MN1002');
    expect(cards[0].textContent).toContain('Delivered');
  });

  it('offers cancel only on orders that have not been delivered', async () => {
    orderList.mockResolvedValue({
      status: 'SUCCESS',
      data: { orders: [placedOrder({ orderId: 'o1', orderNumber: 'MN1001', status: 'PLACED' }), placedOrder({ orderId: 'o2', orderNumber: 'MN1002', status: 'DELIVERED' })] },
    });
    await mount({ view: 'orders' });
    const cards = Array.from(container.querySelectorAll('.shop-order-card'));
    expect(cards[0].querySelector('.shop-order-cancel')).not.toBeNull();
    expect(cards[1].querySelector('.shop-order-cancel')).toBeNull();
  });

  it('cancels an undelivered order through the app’s own confirm sheet', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    orderList.mockResolvedValue({ status: 'SUCCESS', data: { orders: [placedOrder({ orderId: 'o1', status: 'PLACED' })] } });
    await mount({ view: 'orders' });

    await click(container.querySelector('.shop-order-cancel'));
    await flush();

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(document.querySelector('.confirm-sheet')).not.toBeNull();
    expect(document.querySelector('.confirm-sheet').textContent).toContain('Cancel this order?');

    await click(document.querySelector('.confirm-ok'));
    await settle(30);

    expect(cancelOrder).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'o1' }));
    expect(container.querySelector('.shop-order-card').textContent).toContain('Cancelled');
    expect(notify).toHaveBeenCalledWith('success', 'Order MN1001 cancelled.');
  });

  it('keeps the order when the sheet is dismissed', async () => {
    orderList.mockResolvedValue({ status: 'SUCCESS', data: { orders: [placedOrder({ orderId: 'o1', status: 'PLACED' })] } });
    await mount({ view: 'orders' });
    await click(container.querySelector('.shop-order-cancel'));
    await flush();
    await click(document.querySelector('.confirm-cancel'));
    await settle(20);
    expect(cancelOrder).not.toHaveBeenCalled();
  });

  it('opens one order with its items, address and tracker', async () => {
    orderList.mockResolvedValue({ status: 'SUCCESS', data: { orders: [placedOrder({ orderId: 'o1', status: 'SHIPPED' })] } });
    await mount({ view: 'orders' });
    await click(container.querySelector('.shop-order-open'));
    await settle();
    expect(text()).toContain('Order #MN1001');
    expect(text()).toContain('Hair Colour — Natural Brown');
    expect(text()).toContain('12 Sitabuldi Main Road');
    expect(container.querySelectorAll('.shop-tracker-step.done').length).toBe(4); // placed…shipped
    expect(text()).toContain('Cash on delivery');
  });

  it('reorders a past order back into the cart', async () => {
    orderList.mockResolvedValue({ status: 'SUCCESS', data: { orders: [placedOrder({ orderId: 'o1', status: 'DELIVERED' })] } });
    await mount({ view: 'orders' });
    await click(container.querySelector('.shop-order-open'));
    await settle();
    await click(findByText('button', 'Reorder'));
    await settle();
    expect(text()).toContain('Your cart');
    expect(container.querySelector('.shop-cart-row').textContent).toContain('Hair Colour — Natural Brown');
  });
});
