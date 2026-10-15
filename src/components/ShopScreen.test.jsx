import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfirmProvider } from './ConfirmDialog';
import { ShopProductDetailScreen, ShopQuantityControl, ShopScreen } from './ShopScreen';
import { ShopCartScreen, ShopCheckoutScreen } from './ShopCartCheckout';
import { ShopOrderScreen, ShopOrdersScreen } from './ShopOrders';
import { addToCart, clearShopStorage, findOrder, placeOrder, readCart, readOrders } from '../lib/shopOrders';

const { userProductList } = vi.hoisted(() => ({ userProductList: vi.fn() }));

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual('../lib/api');
  return { ...actual, api: { ...actual.api, userProductList } };
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PRODUCT_FIXTURES = [
  { productId: 'sp1', productName: 'Beard Oil 30ml', price: 199, rating: 4.5, isAvailable: true },
  { productId: 'sp2', productName: 'Keratin Shampoo 200ml', price: 499, mrp: 600, rating: 4.8, isAvailable: true },
  { productId: 'sp3', productName: 'Hair Clipper Pro', price: 1499, rating: 4.2, isAvailable: true },
  { productId: 'sp4', productName: 'Face Scrub', price: 399, rating: 4.0, isAvailable: true },
  { productId: 'sp5', productName: 'Out of stock wax', price: 99, isAvailable: false },
  // Two more hair-care items so the details page has same-category suggestions.
  { productId: 'sp6', productName: 'Argan Hair Serum 100ml', price: 449, mrp: 549, rating: 4.3, isAvailable: true },
  { productId: 'sp7', productName: 'Repair Hair Mask 250ml', price: 399, rating: 4.1, isAvailable: true },
];

const SESSION = {
  role: 'SALON',
  userId: 'salon-1',
  user: {
    salon: {
      salonName: 'Golden Scissors',
      ownerName: 'Ramesh Kumar',
      phoneNumber: '9876543210',
      addressLine1: '12 Main Road',
      city: 'Nagpur',
      state: 'Maharashtra',
      pincode: '440010',
    },
  },
};

const flush = async () => { await act(async () => { await Promise.resolve(); }); };

async function render(element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<ConfirmProvider>{element}</ConfirmProvider>);
  });
  await flush();
  return { container, root };
}

function buttonByText(label, root = document.body) {
  return Array.from(root.querySelectorAll('button')).find(node => node.textContent.trim().replace(/\s+/g, ' ') === label);
}

function buttonsContaining(text, root = document.body) {
  return Array.from(root.querySelectorAll('button')).filter(node => node.textContent.includes(text));
}

beforeEach(() => {
  localStorage.clear();
  userProductList.mockReset();
  userProductList.mockResolvedValue({ status: 'SUCCESS', data: { products: PRODUCT_FIXTURES } });
  document.body.innerHTML = '';
});

describe('ShopScreen', () => {
  it('renders the catalog, hides out-of-stock items and adds to the cart', async () => {
    const navigate = vi.fn();
    const { container } = await render(<ShopScreen session={SESSION} navigate={navigate} notify={vi.fn()} />);
    expect(container.querySelectorAll('.shop-card')).toHaveLength(6);
    expect(container.textContent).not.toContain('Out of stock wax');

    // First card after "Popular" sorting is the Keratin Shampoo (highest rating,
    // ₹499 — exactly on the free-delivery threshold, so no delivery fee).
    const addButtons = buttonsContaining('Add', container);
    expect(addButtons.length).toBe(6);
    await act(async () => { addButtons[0].click(); });
    const bar = container.querySelector('.shop-cart-bar');
    expect(bar).toBeTruthy();
    expect(bar.textContent).toContain('1 item');
    expect(bar.textContent).toContain('₹ 499');

    // The ADD morphed into a stepper; + bumps to 2, − back to 1.
    const stepper = container.querySelector('.shop-stepper');
    expect(stepper).toBeTruthy();
    const [minus, plus] = stepper.querySelectorAll('button');
    await act(async () => { plus.click(); });
    expect(container.querySelector('.shop-cart-bar').textContent).toContain('2 items');
    await act(async () => { minus.click(); });
    expect(container.querySelector('.shop-cart-bar').textContent).toContain('1 item');
    expect(readCart('salon-1')).toHaveLength(1);

    // View cart navigates to the cart screen.
    await act(async () => { bar.click(); });
    expect(navigate).toHaveBeenCalledWith('shopCart');
  });

  it('filters by category chip and price range', async () => {
    const { container } = await render(<ShopScreen session={SESSION} navigate={vi.fn()} notify={vi.fn()} />);
    await act(async () => { buttonByText('Beard & grooming', container).click(); });
    const names = Array.from(container.querySelectorAll('.shop-card h3')).map(node => node.textContent);
    expect(names).toEqual(['Beard Oil 30ml']);

    await act(async () => { buttonByText('All', container).click(); });
    expect(container.querySelectorAll('.shop-card')).toHaveLength(6);

    // Sorting by price desc puts the clipper first.
    await act(async () => {
      container.querySelector('.shop-sort select').value = 'price-desc';
      container.querySelector('.shop-sort select').dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container.querySelector('.shop-card h3').textContent).toBe('Hair Clipper Pro');

    // The price range stacks on top of the active sort (₹499 counts as under ₹500).
    await act(async () => { buttonByText('Under ₹500', container).click(); });
    expect(Array.from(container.querySelectorAll('.shop-card h3')).map(node => node.textContent)).toEqual(['Keratin Shampoo 200ml', 'Argan Hair Serum 100ml', 'Face Scrub', 'Repair Hair Mask 250ml', 'Beard Oil 30ml']);
  });

  it('opens the product details page when a card is tapped', async () => {
    const navigate = vi.fn();
    const { container } = await render(<ShopScreen session={SESSION} navigate={navigate} notify={vi.fn()} />);
    const media = container.querySelector('.shop-card-media');
    await act(async () => { media.click(); });
    expect(navigate).toHaveBeenCalledWith('shopProduct', { productId: 'sp2' });
  });
});

describe('ShopProductDetailScreen', () => {
  it('shows the full details and adds to the cart from the page', async () => {
    const navigate = vi.fn();
    const { container } = await render(
      <ShopProductDetailScreen session={SESSION} params={{ productId: 'sp2' }} navigate={navigate} notify={vi.fn()} />
    );
    expect(container.querySelector('.shop-detail-name').textContent).toBe('Keratin Shampoo 200ml');
    expect(container.textContent).toContain('Supplied by My Naai');
    expect(container.textContent).toContain('In stock');
    expect(container.textContent).toContain('₹ 600'); // struck-through MRP
    expect(container.textContent).toContain('Next-day delivery');
    expect(container.textContent).toContain('Cash on delivery');
    // Same-category suggestions.
    expect(container.textContent).toContain('You may also like');
    expect(container.textContent).toContain('Argan Hair Serum 100ml');
    expect(container.textContent).toContain('Repair Hair Mask 250ml');

    // The in-page control is the large one.
    const add = container.querySelector('.shop-add-button.large');
    expect(add).toBeTruthy();
    await act(async () => { add.click(); });
    const bar = container.querySelector('.shop-cart-bar');
    expect(bar).toBeTruthy();
    expect(bar.textContent).toContain('1 item');
    expect(bar.textContent).toContain('₹ 499');

    const stepper = container.querySelector('.shop-stepper.large');
    expect(stepper).toBeTruthy();
    const [, plus] = stepper.querySelectorAll('button');
    await act(async () => { plus.click(); });
    expect(container.querySelector('.shop-cart-bar').textContent).toContain('2 items');
    expect(readCart('salon-1')).toHaveLength(1);

    await act(async () => { bar.click(); });
    expect(navigate).toHaveBeenCalledWith('shopCart');
  });

  it('jumps to another product from the suggestions', async () => {
    const navigate = vi.fn();
    const { container } = await render(
      <ShopProductDetailScreen session={SESSION} params={{ productId: 'sp2' }} navigate={navigate} notify={vi.fn()} />
    );
    const media = container.querySelector('.shop-card-media');
    await act(async () => { media.click(); });
    expect(navigate).toHaveBeenCalledWith('shopProduct', { productId: 'sp6' });
  });

  it('shows an unavailable state for an unknown product id', async () => {
    const navigate = vi.fn();
    const { container } = await render(
      <ShopProductDetailScreen session={SESSION} params={{ productId: 'nope' }} navigate={navigate} notify={vi.fn()} />
    );
    expect(container.textContent).toContain('Product not available');
    expect(container.querySelectorAll('.shop-card').length).toBe(0);
    expect(container.querySelector('.shop-detail-name')).toBeNull();
  });

  it('shows out-of-stock products with the control disabled', async () => {
    const { container } = await render(
      <ShopProductDetailScreen session={SESSION} params={{ productId: 'sp5' }} navigate={vi.fn()} notify={vi.fn()} />
    );
    expect(container.querySelector('.shop-detail-name').textContent).toBe('Out of stock wax');
    expect(container.textContent).toContain('Out of stock');
    expect(container.querySelector('.shop-add-button.large')).toBeNull();
    expect(container.querySelector('.shop-stock-chip')).toBeTruthy();
  });
});

describe('ShopQuantityControl', () => {
  it('shows ADD at zero and a stepper above zero', async () => {
    const onAdd = vi.fn();
    const onSet = vi.fn();
    const { container } = await render(<ShopQuantityControl qty={0} onAdd={onAdd} onSet={onSet} />);
    await act(async () => { buttonByText('Add', container).click(); });
    expect(onAdd).toHaveBeenCalledTimes(1);

    document.body.innerHTML = '';
    const second = await render(<ShopQuantityControl qty={2} onAdd={onAdd} onSet={onSet} />);
    const [minus, plus] = second.container.querySelectorAll('.shop-stepper button');
    await act(async () => { minus.click(); });
    await act(async () => { plus.click(); });
    expect(onSet).toHaveBeenNthCalledWith(1, 1);
    expect(onSet).toHaveBeenNthCalledWith(2, 3);
  });
});

describe('ShopCartScreen', () => {
  it('lists lines with steppers and proceeds to checkout', async () => {
    addToCart('salon-1', { id: 'sp1', name: 'Beard Oil 30ml', price: 199, mrp: 0, image: '', category: 'beard-grooming', gender: 'men' });
    addToCart('salon-1', { id: 'sp2', name: 'Keratin Shampoo 200ml', price: 499, mrp: 600, image: '', category: 'hair-care', gender: 'unisex' });
    const navigate = vi.fn();
    const { container } = await render(<ShopCartScreen session={SESSION} navigate={navigate} notify={vi.fn()} />);
    expect(container.querySelectorAll('.shop-cart-item')).toHaveLength(2);
    expect(container.textContent).toContain('MRP savings');
    expect(container.textContent).toContain('FREE'); // 698 is above the threshold
    const proceed = buttonsContaining('Proceed to checkout', container)[0];
    await act(async () => { proceed.click(); });
    expect(navigate).toHaveBeenCalledWith('shopCheckout');
  });

  it('shows the empty state when the cart is empty', async () => {
    const { container } = await render(<ShopCartScreen session={SESSION} navigate={vi.fn()} notify={vi.fn()} />);
    expect(container.textContent).toContain('Your cart is empty');
  });
});

describe('ShopCheckoutScreen', () => {
  const seedCart = () => {
    addToCart('salon-1', { id: 'sp1', name: 'Beard Oil 30ml', price: 199, mrp: 0, image: '', category: 'beard-grooming', gender: 'men' });
    addToCart('salon-1', { id: 'sp2', name: 'Keratin Shampoo 200ml', price: 499, mrp: 600, image: '', category: 'hair-care', gender: 'unisex' });
  };

  it('places a COD order and shows the success card', async () => {
    seedCart();
    const navigate = vi.fn();
    const notify = vi.fn();
    const { container } = await render(<ShopCheckoutScreen session={SESSION} navigate={navigate} notify={notify} />);

    // Address prefills from the salon profile; select COD.
    expect(container.querySelector('input[value="online"]')?.checked).toBe(true);
    await act(async () => { container.querySelector('input[value="cod"]').click(); });
    const place = buttonsContaining('Place order', container)[0];
    await act(async () => { place.click(); });
    await flush();

    expect(container.textContent).toContain('Order placed');
    const orderId = readOrders('salon-1')[0].id;
    expect(orderId).toMatch(/^MN[A-Z0-9]+$/);
    expect(container.textContent).toContain(orderId);
    expect(readOrders('salon-1')[0].payment).toMatchObject({ method: 'COD', status: 'PENDING' });
    expect(readCart('salon-1')).toEqual([]);

    // Track order deep-links into the order screen.
    await act(async () => { buttonByText('Track order', container).click(); });
    expect(navigate).toHaveBeenCalledWith('shopOrder', { orderId });
  });

  it('refuses to place an order with an incomplete address', async () => {
    seedCart();
    const notify = vi.fn();
    const broken = { ...SESSION, user: { salon: { salonName: 'Golden Scissors', ownerName: '', phoneNumber: '123', addressLine1: '', city: '', state: '', pincode: '' } } };
    const { container } = await render(<ShopCheckoutScreen session={broken} navigate={vi.fn()} notify={notify} />);
    await act(async () => { buttonsContaining('Pay', container)[0].click(); });
    await flush();
    expect(readOrders('salon-1')).toHaveLength(0);
    expect(notify).toHaveBeenCalledWith('error', expect.stringContaining('name'));
  });
});

describe('orders + tracker', () => {
  const seedOrder = () => placeOrder('salon-1', {
    items: [{ productId: 'sp1', name: 'Beard Oil 30ml', price: 199, mrp: 0, image: '', category: 'beard-grooming', gender: 'men', qty: 1 }],
    address: { name: 'Ramesh Kumar', phone: '9876543210', line1: '12 Main Road', city: 'Nagpur', state: 'Maharashtra', pincode: '440010' },
    payment: { method: 'COD', status: 'PENDING', amount: 248 },
    amounts: { itemTotal: 199, savings: 0, deliveryFee: 49, total: 248 },
    salonName: 'Golden Scissors',
  });

  it('lists orders in My orders with the live status', async () => {
    const order = seedOrder();
    const navigate = vi.fn();
    const { container } = await render(<ShopOrdersScreen session={SESSION} navigate={navigate} notify={vi.fn()} />);
    expect(container.textContent).toContain(order.id);
    expect(container.textContent).toContain('Order placed');
    await act(async () => { container.querySelector('.shop-order-card').click(); });
    expect(navigate).toHaveBeenCalledWith('shopOrder', { orderId: order.id });
  });

  it('shows the tracker on the order screen and honours the cancel confirmation', async () => {
    const order = seedOrder();
    const navigate = vi.fn();
    const notify = vi.fn();
    const { container } = await render(<ShopOrderScreen session={SESSION} params={{ orderId: order.id }} navigate={navigate} notify={notify} />);

    expect(container.textContent).toContain('Arriving by');
    expect(container.querySelectorAll('.shop-tracker-step')).toHaveLength(4);
    expect(container.querySelectorAll('.shop-tracker-step.done')).toHaveLength(1);

    // Opening the confirm does not cancel yet.
    await act(async () => { buttonByText('Cancel order', container).click(); });
    await flush();
    expect(findOrder('salon-1', order.id).cancelledAt).toBeNull();
    expect(document.querySelector('.confirm-sheet')).toBeTruthy();

    // Answering "Cancel order" in the sheet cancels the order.
    await act(async () => { buttonByText('Cancel order', document.querySelector('.confirm-sheet')).click(); });
    await flush();
    expect(findOrder('salon-1', order.id).cancelledAt).toBeTruthy();
    expect(container.textContent).toContain('Order cancelled');
    expect(container.textContent).toContain('No amount was collected');
  });

  it('reports a missing order gracefully', async () => {
    const { container } = await render(<ShopOrderScreen session={SESSION} params={{ orderId: 'MN-MISSING' }} navigate={vi.fn()} notify={vi.fn()} />);
    expect(container.textContent).toContain('Order not found');
    clearShopStorage('salon-1');
  });
});
