import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfirmProvider } from './ConfirmDialog';
import { ShopProductDetailScreen, ShopQuantityControl, ShopScreen } from './ShopScreen';
import { ShopCartScreen, ShopCheckoutScreen } from './ShopCartCheckout';
import { ShopOrderScreen, ShopOrdersScreen } from './ShopOrders';
import { addToCart, clearShopStorage, findOrder, placeOrder, readCart, readOrders, setOrderSyncState } from '../lib/shopOrders';
import { resetShopSettingsCache } from '../lib/shopSettings';

const { shopProductList, shopSettingsGet, shopOrderCreate } = vi.hoisted(() => ({
  shopProductList: vi.fn(),
  shopSettingsGet: vi.fn(),
  shopOrderCreate: vi.fn(),
}));

// The order is only real once `POST /api/shop-orders/create` accepts it, so the
// checkout tests drive that call. It is mocked at the sync layer (a real
// registration is covered in shopServerSync.test.js).
vi.mock('../lib/shopServerSync', async () => {
  const actual = await vi.importActual('../lib/shopServerSync');
  return { ...actual, registerServerOrder: shopOrderCreate };
});

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual('../lib/api');
  // The shop now browses the company catalog (shop_products) — the mock
  // answers the new endpoint; the old marketplace one is left as-is.
  // shopSettingsGet answers the admin-managed shop rules (tests that need
  // custom rules re-mock it; the default is the historic 499/49 bill).
  return { ...actual, api: { ...actual.api, shopProductList, shopSettingsGet } };
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
  // Unavailable on purpose (grid stays at 6) but reachable by direct link —
  // it carries two photos so the details gallery has something to switch.
  { productId: 'sp8', productName: 'Twin Image Shampoo 100ml', price: 299, rating: 4.0, isAvailable: false, productImage: 'img-a.jpg, img-b.jpg' },
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

// The same shop, opened by a signed-in customer instead of a salon partner.
const CUSTOMER_SESSION = {
  role: 'USER',
  userId: 'user-9',
  user: { fullName: 'Sneha Waghmare', phoneNumber: '9876543210', city: 'Nagpur', state: 'Maharashtra', pincode: '440010' },
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
  resetShopSettingsCache(); // each test re-fetches its own rules
  shopProductList.mockReset();
  shopProductList.mockResolvedValue({ status: 'SUCCESS', data: { products: PRODUCT_FIXTURES } });
  // Shop rules default to the historic bill (₹49 free delivery, above ₹499,
  // no discount, no COD limit) — tests that need other rules re-mock this.
  shopSettingsGet.mockReset();
  shopSettingsGet.mockResolvedValue({
    status: 'SUCCESS',
    data: { freeDeliveryAbove: 499, deliveryFee: 49, discountPercent: 0, codThreshold: 0, codCharges: 0 },
  });
  // The backend accepts orders by default; a rejection test overrides this.
  shopOrderCreate.mockReset();
  shopOrderCreate.mockResolvedValue({ ok: true, code: 'OK', order: null });
  document.body.innerHTML = '';
});

describe('ShopScreen', () => {
  it('loads every catalog page, not just the first 20 products', async () => {
    const pageOne = [{ productId: 'p1', productName: 'Page One Oil', price: 100, isAvailable: true }];
    const pageTwo = [{ productId: 'p2', productName: 'Page Two Wax', price: 200, isAvailable: true }];
    shopProductList.mockImplementation(({ page }) =>
      Promise.resolve({
        status: 'SUCCESS',
        data: {
          products: page === 1 ? pageOne : pageTwo,
          pagination: { page, limit: 1, totalProducts: 2, totalPages: 2 },
        },
      })
    );
    const { container } = await render(<ShopScreen session={SESSION} navigate={vi.fn()} notify={vi.fn()} />);
    expect(shopProductList).toHaveBeenCalledTimes(2);
    expect(shopProductList).toHaveBeenLastCalledWith({ page: 2, searchString: '' });
    // Both pages are in the grid — the second product is visible, not lost.
    expect(container.querySelectorAll('.shop-card')).toHaveLength(2);
    expect(container.textContent).toContain('Page One Oil');
    expect(container.textContent).toContain('Page Two Wax');
  });

  it('renders the catalog, hides out-of-stock items and adds to the cart', async () => {
    const navigate = vi.fn();
    const { container } = await render(<ShopScreen session={SESSION} navigate={navigate} notify={vi.fn()} />);
    expect(container.querySelectorAll('.shop-card')).toHaveLength(6);
    expect(container.textContent).not.toContain('Out of stock wax');
    // Header carries both the cart shortcut (beside My orders) and the
    // labelled filter row — no delivery banner, no sort control.
    expect(buttonsContaining('My cart', container).length).toBe(1);
    expect(buttonsContaining('My orders', container).length).toBe(1);
    expect(container.textContent).toContain('Category');
    expect(container.textContent).toContain('For');
    expect(container.textContent).toContain('Price');
    expect(container.querySelector('.shop-hero-strip')).toBeNull();
    expect(container.querySelector('.shop-sort')).toBeNull();
    // Discount is shown on the card (badge + inline next to the price).
    expect(container.textContent).toContain('17% off');

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

  it('filters with the category, gender and price selects', async () => {
    const { container } = await render(<ShopScreen session={SESSION} navigate={vi.fn()} notify={vi.fn()} />);
    const setFilter = async (label, value) => {
      const select = Array.from(container.querySelectorAll('select')).find(item => item.getAttribute('aria-label') === label);
      select.value = value;
      await act(async () => { select.dispatchEvent(new Event('change', { bubbles: true })); });
    };

    await setFilter('Category', 'beard-grooming');
    expect(Array.from(container.querySelectorAll('.shop-card h3')).map(node => node.textContent)).toEqual(['Beard Oil 30ml']);

    await setFilter('Category', 'all');
    expect(container.querySelectorAll('.shop-card')).toHaveLength(6);

    await setFilter('Gender', 'men');
    expect(Array.from(container.querySelectorAll('.shop-card h3')).map(node => node.textContent)).toEqual(['Beard Oil 30ml']);

    // The price range stacks on the other filters (₹499 counts as under ₹500;
    // default popular order = rating, high to low).
    await setFilter('Gender', 'all');
    await setFilter('Price', 'under500');
    expect(Array.from(container.querySelectorAll('.shop-card h3')).map(node => node.textContent)).toEqual(['Keratin Shampoo 200ml', 'Beard Oil 30ml', 'Argan Hair Serum 100ml', 'Repair Hair Mask 250ml', 'Face Scrub']);
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

  it('shows the delivery terms AFTER the description, with the exact lines', async () => {
    const { container } = await render(
      <ShopProductDetailScreen session={SESSION} params={{ productId: 'sp2' }} navigate={vi.fn()} notify={vi.fn()} />
    );
    const cards = Array.from(container.querySelectorAll('.shop-detail-card'));
    const aboutIndex = cards.findIndex(card => card.textContent.includes('About this product'));
    const deliveryIndex = cards.findIndex(card => card.textContent.includes('Delivery'));
    expect(aboutIndex).toBeGreaterThan(-1);
    expect(deliveryIndex).toBeGreaterThan(aboutIndex); // terms are read with the description

    // sp2 is ₹499 — exactly on the free-delivery threshold, so FREE; COD is
    // unrestricted, so it is offered. (Session city Nagpur is named.)
    const deliveryCard = cards[deliveryIndex];
    expect(deliveryCard.textContent).toContain('Next-day delivery to Nagpur · FREE on this item');
    expect(deliveryCard.textContent).toContain('Cash on delivery available · online payment via UPI, cards & netbanking');
    expect(deliveryCard.textContent).toContain('Free cancellation until the order goes out for delivery');
  });

  it('follows the admin shop settings on the delivery card', async () => {
    // Free delivery only above ₹1,000 (so ₹499 is not FREE), COD only up to
    // ₹400 (so ₹499 is online-only) — the card must say so, not the default.
    shopSettingsGet.mockResolvedValue({
      status: 'SUCCESS',
      data: { freeDeliveryAbove: 1000, deliveryFee: 40, discountPercent: 0, codThreshold: 400, codCharges: 20 },
    });
    const { container } = await render(
      <ShopProductDetailScreen session={SESSION} params={{ productId: 'sp2' }} navigate={vi.fn()} notify={vi.fn()} />
    );
    const deliveryCard = Array.from(container.querySelectorAll('.shop-detail-card'))
      .find(card => card.textContent.includes('Delivery'));
    expect(deliveryCard.textContent).toContain('· free above ₹ 1,000');
    expect(deliveryCard.textContent).not.toContain('FREE on this item');
    expect(deliveryCard.textContent).not.toContain('Cash on delivery available');
    expect(deliveryCard.textContent).toContain('Online payment via UPI, cards & netbanking');
    expect(deliveryCard.textContent).toContain('Free cancellation until the order goes out for delivery');
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

  it('switches the hero between multiple product photos', async () => {
    const { container } = await render(
      <ShopProductDetailScreen session={SESSION} params={{ productId: 'sp8' }} navigate={vi.fn()} notify={vi.fn()} />
    );
    const hero = container.querySelector('.shop-detail-hero-image');
    expect(hero.src).toContain('img-a.jpg'); // cover first
    const thumbs = container.querySelectorAll('.shop-detail-thumb');
    expect(thumbs).toHaveLength(2);
    await act(async () => { thumbs[1].click(); });
    expect(container.querySelector('.shop-detail-hero-image').src).toContain('img-b.jpg');
    expect(container.querySelectorAll('.shop-detail-thumb')[1].className).toContain('active');
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
    // Blinkit-style footer: ITEM total + count + proceed CTA. Delivery is a
    // checkout charge and must not be baked into this figure.
    const footer = container.querySelector('.shop-cart-footer');
    expect(footer).toBeTruthy();
    expect(footer.textContent).toContain('Items total');
    expect(footer.textContent).toContain('₹ 698');
    expect(footer.textContent).toContain('2 items');
    expect(footer.textContent).toContain('delivery at checkout');
    const proceed = buttonsContaining('Proceed to checkout', container)[0];
    await act(async () => { proceed.click(); });
    expect(navigate).toHaveBeenCalledWith('shopCheckout');
  });

  it('steppers adjust quantities, line totals update, and lines can be removed', async () => {
    addToCart('salon-1', { id: 'sp1', name: 'Beard Oil 30ml', price: 199, mrp: 0, image: '', category: 'beard-grooming', gender: 'men' });
    addToCart('salon-1', { id: 'sp2', name: 'Keratin Shampoo 200ml', price: 499, mrp: 600, image: '', category: 'hair-care', gender: 'unisex' });
    const { container } = await render(<ShopCartScreen session={SESSION} navigate={vi.fn()} notify={vi.fn()} />);

    // Every line shows its running total beside the stepper.
    let items = container.querySelectorAll('.shop-cart-item');
    expect(items).toHaveLength(2);
    expect(items[0].querySelector('.shop-cart-line-total').textContent).toBe('₹ 199');

    // + on the first line → line total ₹ 398; the cart total is the product
    // value only (398 + 499), with delivery billed at checkout.
    const [, plus] = items[0].querySelectorAll('.shop-stepper button');
    await act(async () => { plus.click(); });
    expect(container.querySelector('.shop-cart-item .shop-cart-line-total').textContent).toBe('₹ 398');
    expect(container.querySelector('.shop-cart-footer').textContent).toContain('₹ 897'); // 398 + 499 products

    // The free-delivery note switches to the "unlocked" state (₹1,197 > ₹499).
    expect(container.querySelector('.shop-delivery-note.unlocked')).toBeTruthy();

    // − on a qty-1 line removes it (Blinkit behaviour at zero).
    items = container.querySelectorAll('.shop-cart-item');
    const [minus] = items[1].querySelectorAll('.shop-stepper button');
    await act(async () => { minus.click(); });
    expect(container.querySelectorAll('.shop-cart-item')).toHaveLength(1);
    // Still the product value — the ₹49 fee belongs to the checkout step.
    expect(container.querySelector('.shop-cart-footer').textContent).toContain('₹ 398');
    expect(container.querySelector('.shop-delivery-note.unlocked')).toBeNull();

    // The explicit Remove button deletes the remaining line → empty state.
    const remove = container.querySelector('.shop-cart-item .shop-cart-remove');
    expect(remove).toBeTruthy();
    await act(async () => { remove.click(); });
    expect(container.textContent).toContain('Your cart is empty');
  });

  it('shows the empty state when the cart is empty', async () => {
    const { container } = await render(<ShopCartScreen session={SESSION} navigate={vi.fn()} notify={vi.fn()} />);
    expect(container.textContent).toContain('Your cart is empty');
  });

  // The reported bug: one ₹99 product, and the cart strip showed ₹199 because
  // a delivery charge was added before checkout had even started. The strip now
  // quotes the product value; the fee appears on the checkout bill.
  it('never adds delivery to the cart or the cart bar — the fee appears at checkout', async () => {
    addToCart('salon-1', { id: 'sp9', name: 'Shaving Foam 100g', price: 99, mrp: 0, image: '', category: 'shaving', gender: 'men' });
    const cart = await render(<ShopCartScreen session={SESSION} navigate={vi.fn()} notify={vi.fn()} />);
    const footer = cart.container.querySelector('.shop-cart-footer');
    expect(footer.textContent).toContain('₹ 99');
    expect(footer.textContent).not.toContain('₹ 148');
    const bill = cart.container.querySelector('.shop-bill-card');
    expect(bill.textContent).toContain('₹ 99');
    expect(bill.textContent).not.toContain('₹ 148');
    expect(bill.textContent).toContain('At checkout');

    // The shop's floating bar quotes the same product value.
    const shop = await render(<ShopScreen session={SESSION} navigate={vi.fn()} notify={vi.fn()} />);
    const bar = shop.container.querySelector('.shop-cart-bar');
    expect(bar.textContent).toContain('₹ 99');
    expect(bar.textContent).toContain('delivery at checkout');

    // …and the checkout bill is where the fee finally lands.
    const checkout = await render(<ShopCheckoutScreen session={SESSION} navigate={vi.fn()} notify={vi.fn()} />);
    const summary = checkout.container.querySelector('.shop-checkout-summary');
    expect(summary.textContent).toContain('₹ 49');
    expect(summary.textContent).toContain('₹ 148');
    expect(summary.textContent).toContain('To pay');
  });

  it('bills the cart from the admin shop settings (discount, fee, threshold)', async () => {
    shopSettingsGet.mockResolvedValue({
      status: 'SUCCESS',
      data: { freeDeliveryAbove: 500, deliveryFee: 40, discountPercent: 10, codThreshold: 0, codCharges: 25 },
    });
    addToCart('salon-1', { id: 'sp1', name: 'Beard Oil 30ml', price: 199, mrp: 0, image: '', category: 'beard-grooming', gender: 'men' });
    const { container } = await render(<ShopCartScreen session={SESSION} navigate={vi.fn()} notify={vi.fn()} />);

    // ₹199 − 10% (₹20) = ₹179 of products. The cart does NOT add the ₹40 fee:
    // it shows the item total and says the fee is calculated at checkout.
    const bill = container.querySelector('.shop-bill-card');
    expect(bill.textContent).toContain('Order discount (10%)');
    expect(bill.textContent).toContain('− ₹ 20');
    expect(bill.textContent).toContain('Delivery fee');
    expect(bill.textContent).toContain('At checkout');
    expect(bill.textContent).not.toContain('₹ 40');
    expect(bill.textContent).toContain('₹ 179');
    expect(container.querySelector('.shop-cart-footer').textContent).toContain('₹ 179');
    // The free-delivery progress runs on the after-discount subtotal: 500 − 179.
    expect(container.querySelector('.shop-delivery-note').textContent).toContain('₹ 321');
    // COD is not chosen at cart level yet, so no COD charges line.
    expect(bill.textContent).not.toContain('COD charges');
  });
});

describe('ShopCheckoutScreen', () => {
  const seedCart = () => {
    addToCart('salon-1', { id: 'sp1', name: 'Beard Oil 30ml', price: 199, mrp: 0, image: '', category: 'beard-grooming', gender: 'men' });
    addToCart('salon-1', { id: 'sp2', name: 'Keratin Shampoo 200ml', price: 499, mrp: 600, image: '', category: 'hair-care', gender: 'unisex' });
  };

  it('asks for a confirmation box before placing a COD order', async () => {
    seedCart();
    const { container } = await render(<ShopCheckoutScreen session={SESSION} navigate={vi.fn()} notify={vi.fn()} />);

    await act(async () => { container.querySelector('input[value="cod"]').click(); });
    const place = buttonsContaining('Place order', container)[0];
    await act(async () => { place.click(); });
    await flush();

    // The confirmation box is up and NOTHING has been written yet.
    const sheet = document.querySelector('.confirm-sheet');
    expect(sheet).toBeTruthy();
    expect(sheet.textContent).toContain('Place this order with cash on delivery?');
    // 199 + 499 = ₹698, free delivery — the amount the partner will hand over.
    expect(sheet.textContent).toContain('₹ 698');
    expect(readOrders('salon-1')).toHaveLength(0);
    expect(readCart('salon-1')).toHaveLength(2);

    // "Go back" leaves the cart untouched and creates no order.
    await act(async () => { buttonByText('Go back', sheet).click(); });
    await flush();
    expect(document.querySelector('.confirm-sheet')).toBeNull();
    expect(readOrders('salon-1')).toHaveLength(0);
    expect(readCart('salon-1')).toHaveLength(2);
    expect(container.textContent).not.toContain('Order placed');
  });

  it('places a COD order after the confirmation box and shows the success card', async () => {
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

    // Confirming in the sheet is what actually creates the order.
    const sheet = document.querySelector('.confirm-sheet');
    expect(sheet).toBeTruthy();
    await act(async () => { buttonByText('Place order', sheet).click(); });
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

  it('hands the whole order to the backend call and marks it confirmed on success', async () => {
    seedCart();
    const { container } = await render(<ShopCheckoutScreen session={SESSION} navigate={vi.fn()} notify={vi.fn()} />);
    await act(async () => { container.querySelector('input[value="cod"]').click(); });
    await act(async () => { buttonsContaining('Place order', container)[0].click(); });
    await flush();
    await act(async () => { buttonByText('Place order', document.querySelector('.confirm-sheet')).click(); });
    await flush();

    expect(shopOrderCreate).toHaveBeenCalledTimes(1);
    const sent = shopOrderCreate.mock.calls[0][0];
    const orderId = readOrders('salon-1')[0].id;
    expect(sent.id).toBe(orderId);
    expect(sent.items).toHaveLength(2);
    expect(sent.items[0]).toMatchObject({ productId: 'sp1', price: 199, qty: 1 });
    expect(sent.address).toMatchObject({ name: 'Ramesh Kumar', phone: '9876543210', city: 'Nagpur', state: 'Maharashtra', pincode: '440010' });
    expect(sent.payment).toMatchObject({ method: 'COD', status: 'PENDING' });
    expect(sent.amounts.total).toBe(698);

    // The local copy now knows the backend has it (the wire body itself is
    // asserted in shopServerSync.test.js).
    expect(readOrders('salon-1')[0].syncState).toBe('synced');
    expect(container.textContent).toContain('Order placed');
  });

  it('shows the backend\u2019s refusal and leaves the cart intact', async () => {
    seedCart();
    shopOrderCreate.mockResolvedValue({ ok: false, code: 'VALIDATION', retryable: false, message: 'items.0.productId must be a valid GUID' });
    const notify = vi.fn();
    const { container } = await render(<ShopCheckoutScreen session={SESSION} navigate={vi.fn()} notify={notify} />);
    await act(async () => { container.querySelector('input[value="cod"]').click(); });
    await act(async () => { buttonsContaining('Place order', container)[0].click(); });
    await flush();
    await act(async () => { buttonByText('Place order', document.querySelector('.confirm-sheet')).click(); });
    await flush();

    // No success card, an explicit error, and NOTHING left behind as an order.
    expect(container.textContent).not.toContain('Order placed');
    expect(container.querySelector('.shop-order-error')).toBeTruthy();
    expect(container.querySelector('.shop-order-error').textContent).toContain('items.0.productId must be a valid GUID');
    expect(readOrders('salon-1')).toHaveLength(0);
    expect(readCart('salon-1')).toHaveLength(2);
    expect(notify).toHaveBeenCalledWith('error', expect.stringContaining('valid GUID'));

    // "Try again" re-sends the same placeable order.
    shopOrderCreate.mockResolvedValue({ ok: true, code: 'OK', order: null });
    await act(async () => { buttonByText('Try again', container).click(); });
    await flush();
    expect(shopOrderCreate).toHaveBeenCalledTimes(2);
    expect(readOrders('salon-1')).toHaveLength(1);
    expect(container.textContent).toContain('Order placed');
  });

  it('offers the state as a dropdown and prefills the salon\u2019s state', async () => {
    seedCart();
    const { container } = await render(<ShopCheckoutScreen session={SESSION} navigate={vi.fn()} notify={vi.fn()} />);

    // City · State · Pincode share one row; the state is a <select>, not a
    // free-text input, and it shows the salon's saved state.
    const stateField = container.querySelector('.form-three-even select');
    expect(stateField).toBeTruthy();
    expect(stateField.value).toBe('Maharashtra');
    expect(stateField.textContent).toContain('Select state');
    expect(stateField.textContent).toContain('Maharashtra');
    expect(stateField.textContent).toContain('Karnataka');
    // No free-text state input is left behind.
    const stateInputs = Array.from(container.querySelectorAll('.form-three-even input'))
      .filter(input => input.getAttribute('autocomplete') === 'address-level1');
    expect(stateInputs).toHaveLength(0);

    // Choosing another state flows straight into the placed order.
    await act(async () => {
      stateField.value = 'Karnataka';
      stateField.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => { container.querySelector('input[value="cod"]').click(); });
    await act(async () => { buttonsContaining('Place order', container)[0].click(); });
    await flush();
    const sheet = document.querySelector('.confirm-sheet');
    await act(async () => { buttonByText('Place order', sheet).click(); });
    await flush();
    expect(readOrders('salon-1')[0].address.state).toBe('Karnataka');
  });

  it('keeps a legacy state value selectable instead of showing it as unset', async () => {
    seedCart();
    // A profile saved before the dropdown existed carries the two-letter code.
    const legacy = { ...SESSION, user: { salon: { ...SESSION.user.salon, state: 'MH' } } };
    const { container } = await render(<ShopCheckoutScreen session={legacy} navigate={vi.fn()} notify={vi.fn()} />);
    const stateField = container.querySelector('.form-three-even select');
    expect(stateField.value).toBe('Maharashtra');
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

  it('adds the admin-set COD charges only while COD is selected', async () => {
    shopSettingsGet.mockResolvedValue({
      status: 'SUCCESS',
      data: { freeDeliveryAbove: 499, deliveryFee: 49, discountPercent: 0, codThreshold: 0, codCharges: 25 },
    });
    addToCart('salon-1', { id: 'sp1', name: 'Beard Oil 30ml', price: 199, mrp: 0, image: '', category: 'beard-grooming', gender: 'men' });
    const { container } = await render(<ShopCheckoutScreen session={SESSION} navigate={vi.fn()} notify={vi.fn()} />);

    // Online by default: 199 + 49 = 248, no COD line.
    let summary = container.querySelector('.shop-checkout-summary');
    expect(summary.textContent).toContain('₹ 248');
    expect(summary.textContent).not.toContain('COD charges');

    // Choosing COD adds the ₹25 surcharge → 273, and the bill card says so.
    await act(async () => { container.querySelector('input[value="cod"]').click(); });
    summary = container.querySelector('.shop-checkout-summary');
    expect(summary.textContent).toContain('COD charges');
    expect(summary.textContent).toContain('₹ 25');
    expect(summary.textContent).toContain('₹ 273');
    expect(container.querySelector('.shop-pay-option.active .shop-pay-copy').textContent).toContain('Cash on delivery');
  });

  it('locks COD out when the order is above the admin COD threshold', async () => {
    shopSettingsGet.mockResolvedValue({
      status: 'SUCCESS',
      data: { freeDeliveryAbove: 499, deliveryFee: 49, discountPercent: 0, codThreshold: 100, codCharges: 25 },
    });
    addToCart('salon-1', { id: 'sp1', name: 'Beard Oil 30ml', price: 199, mrp: 0, image: '', category: 'beard-grooming', gender: 'men' });
    const { container } = await render(<ShopCheckoutScreen session={SESSION} navigate={vi.fn()} notify={vi.fn()} />);

    // ₹199 > ₹100 limit → COD is disabled with the reason, and the bill stays online.
    const cod = container.querySelector('input[value="cod"]');
    expect(cod.disabled).toBe(true);
    expect(container.querySelector('input[value="online"]').checked).toBe(true);
    expect(container.textContent).toContain('Only for orders up to ₹ 100');
    expect(container.querySelector('.shop-checkout-summary').textContent).not.toContain('COD charges');
    expect(buttonsContaining('Pay', container)[0].textContent).toContain('₹ 248'); // online total, not 273
  });
});

describe('orders + tracker', () => {
  const seedOrder = () => {
    const placed = placeOrder('salon-1', {
      items: [{ productId: 'sp1', name: 'Beard Oil 30ml', price: 199, mrp: 0, image: '', category: 'beard-grooming', gender: 'men', qty: 1 }],
      address: { name: 'Ramesh Kumar', phone: '9876543210', line1: '12 Main Road', city: 'Nagpur', state: 'Maharashtra', pincode: '440010' },
      payment: { method: 'COD', status: 'PENDING', amount: 248 },
      amounts: { itemTotal: 199, savings: 0, deliveryFee: 49, total: 248 },
      salonName: 'Golden Scissors',
    });
    // The backend accepted it — that is what makes it a real order. The live
    // status arrives from the server, so the seed only carries the flag.
    return setOrderSyncState('salon-1', placed.id, 'synced') || placed;
  };

  it('lists orders in My orders with the live status', async () => {
    const order = seedOrder();
    const navigate = vi.fn();
    const { container } = await render(<ShopOrdersScreen session={SESSION} navigate={navigate} notify={vi.fn()} />);
    expect(container.textContent).toContain(order.id);
    expect(container.textContent).toContain('Order placed');
    await act(async () => { container.querySelector('.shop-order-card-main').click(); });
    expect(navigate).toHaveBeenCalledWith('shopOrder', { orderId: order.id });
  });

  it('shows the tracker on the order screen and honours the cancel confirmation', async () => {
    const order = seedOrder();
    const navigate = vi.fn();
    const notify = vi.fn();
    const { container } = await render(<ShopOrderScreen session={SESSION} params={{ orderId: order.id }} navigate={navigate} notify={notify} />);

    // No auto-generated arrival time: the tracker shows the status only.
    expect(container.textContent).not.toContain('Arriving by');
    expect(container.textContent).not.toMatch(/\bTomorrow,\s/);
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

describe('the shop for customers and website visitors', () => {
  it('speaks to a customer, not to a salon', async () => {
    const { container } = await render(<ShopScreen session={CUSTOMER_SESSION} navigate={vi.fn()} notify={vi.fn()} />);
    expect(container.textContent).toContain('delivered to your door');
    expect(container.textContent).not.toContain('for your salon');
    // The catalog is the same admin catalog the partners buy from.
    expect(container.textContent).toContain('Beard Oil 30ml');
  });

  it('keeps a customer cart in its own store, away from a salon cart', async () => {
    const { container } = await render(<ShopScreen session={CUSTOMER_SESSION} navigate={vi.fn()} notify={vi.fn()} />);
    await act(async () => { buttonByText('Add', container).click(); });
    await flush();

    expect(readCart('user:user-9')).toHaveLength(1);
    expect(readCart('user-9')).toHaveLength(0); // not the salon namespace
    expect(readCart('guest')).toHaveLength(0);
  });

  it('lets a website visitor browse, and asks for a sign-in on the first ADD', async () => {
    const navigate = vi.fn();
    const notify = vi.fn();
    const { container } = await render(<ShopScreen session={null} navigate={navigate} notify={notify} />);

    // The whole catalog is public.
    expect(container.textContent).toContain('Beard Oil 30ml');
    expect(container.textContent).toContain('delivered to your door');

    await act(async () => { buttonByText('Add', container).click(); });
    await flush();
    expect(notify).toHaveBeenCalledWith('info', expect.stringMatching(/sign in/i));
    expect(navigate).toHaveBeenCalledWith('login', { returnTo: '/shop' });
    // Nothing was written: a guest cart would follow the browser, not a person.
    expect(readCart('guest')).toHaveLength(0);
  });

  it('sends a visitor to sign in from the cart and orders shortcuts', async () => {
    const navigate = vi.fn();
    const { container } = await render(<ShopScreen session={null} navigate={navigate} notify={vi.fn()} />);
    await act(async () => { container.querySelector('.shop-header-action').click(); });
    expect(navigate).toHaveBeenCalledWith('login', { returnTo: '/shop' });
    const orders = Array.from(container.querySelectorAll('.shop-header-action'))[1];
    await act(async () => { orders.click(); });
    expect(navigate).toHaveBeenCalledTimes(2);
  });

  it('prefills a customer checkout from the customer profile, and keeps the salon one for partners', async () => {
    addToCart('user:user-9', { id: 'sp1', name: 'Beard Oil 30ml', price: 199, mrp: 0, image: '', category: 'beard-grooming', gender: 'men' });
    const { container } = await render(<ShopCheckoutScreen session={CUSTOMER_SESSION} navigate={vi.fn()} notify={vi.fn()} />);

    const name = container.querySelector('input[autocomplete="name"]');
    const phone = container.querySelector('input[autocomplete="tel"]');
    expect(name.value).toBe('Sneha Waghmare');
    expect(phone.value).toBe('9876543210');
    expect(container.textContent).toContain('Delivery to your address');
    expect(container.textContent).toContain('Delivery address');
    expect(container.textContent).not.toContain('Shop / salon address');
  });
});
