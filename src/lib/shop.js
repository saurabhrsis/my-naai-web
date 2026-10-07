// Salon supply shop — the partner-facing e-commerce flow.
//
// My Naai admin publishes the catalog (scrubs, scissors, hair colours,
// consumables…); a salon partner browses it, fills a cart, orders to the
// salon's own address and follows the order until it is delivered. There is
// NO payment gateway here — an order is placed and settled offline (cash /
// bank transfer on delivery), exactly as the brief asks.
//
// This module owns everything the screens should not have to think about:
//   · reading the many shapes the API can return (`normalizeShopProduct`,
//     `normalizeOrder`),
//   · money (`cartTotals`), status copy and the cancel rule (`canCancelOrder`),
//   · the cart and the offline order store,
//   · and the single place that talks to the API (`loadShopProducts`,
//     `submitOrder`, `loadOrders`, `cancelShopOrder`), including the dev-only
//     sample fallback described below.
//
// API contract (see backend/shopOrders.js for a ready-to-paste controller):
//   POST /api/shop/product-list   { search?, category? }        → { products: [] }
//   POST /api/orders/create       { items, address, ...totals } → { order: {} }
//   POST /api/orders/list         {}                            → { orders: [] }
//   POST /api/orders/cancel       { orderId, reason? }          → { order: {} }
//
// ── The sample fallback ──────────────────────────────────────────────────────
// The endpoints above are new. Until the backend serves them a partner would
// open the Shop tab and see an empty shelf, which makes the flow impossible to
// review — so when a request fails AND this build allows it (a Vite dev server,
// or VITE_SHOP_FALLBACK=true) the shop falls back to a sample catalog and
// stores orders on this device. Production builds without the flag show the
// honest empty state and a Retry. `source` is returned by every loader so the
// UI can say which one it is showing.

import { api } from './api';

// ── Catalog ──────────────────────────────────────────────────────────────────

export const SHOP_CATEGORIES = ['All', 'Hair colour', 'Hair care', 'Tools', 'Consumables'];

// Money rules for the cart. One place, so the cart, the checkout summary and
// the stored order can never disagree about what an order costs.
//
// There are NO delivery charges: what the items cost is what the salon pays.
// No fee line, no free-delivery threshold, nothing to add at checkout — the
// total is the subtotal.

// What admin adds today: the things a salon actually buys (scrubs, scissors,
// hair colours, consumables). Used only by the dev/sample fallback — a real
// backend replaces it through /api/shop/product-list.
export const SAMPLE_SHOP_PRODUCTS = [
  { productId: 'shop-01', productName: 'Professional Hair Cutting Scissors 6.5"', brand: 'Naai Pro', category: 'Tools', price: 1150, mrp: 1499, stock: 24, unit: '1 piece', description: 'Japanese stainless steel barber scissors with an adjustable tension screw. Balanced for long cutting sessions and safe on wet or dry hair.' },
  { productId: 'shop-02', productName: 'Texturising Thinning Scissors', brand: 'Naai Pro', category: 'Tools', price: 890, mrp: 1100, stock: 18, unit: '1 piece', description: '28-tooth thinning shear for de-bulking and blending. Rubber finger inserts and a finger rest for all-day use.' },
  { productId: 'shop-03', productName: 'Hair Trimmer Professional T-900', brand: 'Trimline', category: 'Tools', price: 2499, mrp: 2999, stock: 9, rating: 4.6, unit: '1 set', description: 'Cordless trimmer with a 180-minute battery, four guide combs and a zero-gap adjustable blade. Mains or cordless.' },
  { productId: 'shop-04', productName: 'Hair Dryer 2000W Professional', brand: 'Airstar', category: 'Tools', price: 1890, mrp: 2299, stock: 12, unit: '1 piece', description: '2000 W AC motor with two speeds, three heat settings and a cool shot. Comes with a concentrator and a diffuser.' },
  { productId: 'shop-05', productName: 'Hair Colour Tube — Natural Brown 60ml', brand: 'Keune', category: 'Hair colour', price: 520, mrp: 590, stock: 60, rating: 4.7, unit: '1 tube', description: 'Permanent professional hair colour with 100% grey coverage. Mix 1:1 with developer. Patch test 48 hours before use.' },
  { productId: 'shop-06', productName: 'Hair Colour — Burgundy 60ml', brand: 'Keune', category: 'Hair colour', price: 520, mrp: 590, stock: 44, unit: '1 tube', description: 'Vibrant Burgundy permanent colour with a conditioning base. Long-lasting shine, full grey coverage.' },
  { productId: 'shop-07', productName: 'Ammonia-Free Hair Colour Kit (Pack of 3)', brand: 'Gentle Look', category: 'Hair colour', price: 1250, mrp: 1499, stock: 15, unit: 'pack of 3', description: 'Ammonia-free three-tube kit for sensitive scalps, with gloves, brush and mixing bowl included.' },
  { productId: 'shop-08', productName: 'Developer / Oxidant 20 Vol 500ml', brand: 'Keune', category: 'Hair colour', price: 320, mrp: 380, stock: 70, unit: '500 ml', description: 'Cream developer for permanent colour, 20 volume (6%). Stable, easy-to-measure bottle.' },
  { productId: 'shop-09', productName: 'Scalp Scrub — Charcoal Detox 200ml', brand: 'Pure Roots', category: 'Hair care', price: 480, mrp: 549, stock: 33, rating: 4.4, unit: '200 ml', description: 'Charcoal and salicylic acid scalp scrub that lifts product build-up, flakes and excess oil. Use once a week before shampoo.' },
  { productId: 'shop-10', productName: 'Anti-Dandruff Scalp Scrub 250ml', brand: 'Pure Roots', category: 'Hair care', price: 420, mrp: 499, stock: 41, unit: '250 ml', description: 'Zinc pyrithione scrub for itchy, flaky scalps. Soothes between two washes.' },
  { productId: 'shop-11', productName: 'Keratin Repair Shampoo 500ml', brand: 'Silk Route', category: 'Hair care', price: 690, mrp: 799, stock: 50, unit: '500 ml', description: 'Sulphate-free keratin shampoo for chemically treated hair. Smooths the cuticle and cuts frizz.' },
  { productId: 'shop-12', productName: 'Argan Oil Hair Serum 100ml', brand: 'Silk Route', category: 'Hair care', price: 560, mrp: 650, stock: 38, unit: '100 ml', description: 'Lightweight argan serum for shine and heat protection. Two to three drops on damp or dry hair.' },
  { productId: 'shop-13', productName: 'Hair Spa Cream 500ml', brand: 'Silk Route', category: 'Hair care', price: 750, mrp: 899, stock: 22, unit: '500 ml', description: 'Deep-conditioning spa cream for a 20-minute salon service. Works with or without steam.' },
  { productId: 'shop-14', productName: 'Disposable Salon Towels (Pack of 100)', brand: 'Clean Cut', category: 'Consumables', price: 399, mrp: 499, stock: 90, unit: 'pack of 100', description: 'Absorbent, lint-free disposable towels. One towel per client — no laundry, no cross-use.' },
  { productId: 'shop-15', productName: 'Hair Colour Brush & Bowl Set', brand: 'Naai Pro', category: 'Consumables', price: 220, mrp: 280, stock: 65, unit: '1 set', description: 'Non-slip mixing bowl with a wide colour brush and a tint applicator comb.' },
  { productId: 'shop-16', productName: 'Shaving Razor + 10 Blades', brand: 'Sharp Edge', category: 'Consumables', price: 340, mrp: 399, stock: 47, unit: '1 razor + 10 blades', description: 'Classic barber razor with a balanced handle and ten stainless blades for fades and neck clean-ups.' },
  { productId: 'shop-17', productName: 'Barber Neck Strips (1 Roll)', brand: 'Clean Cut', category: 'Consumables', price: 180, mrp: 220, stock: 80, unit: '1 roll', description: 'Stretchable neck strips that keep hair and colour off the client collar. One roll is roughly 200 clients.' },
  { productId: 'shop-18', productName: 'Barber Cape — Waterproof', brand: 'Clean Cut', category: 'Consumables', price: 450, mrp: 549, stock: 29, unit: '1 piece', description: 'Anti-static waterproof cape with an adjustable snap closure. Wipes clean between clients.' },
];

function toNumber(value, fallback = 0) {
  const number = Number(String(value ?? '').toString().replace(/[^\d.-]/g, ''));
  return Number.isFinite(number) ? number : fallback;
}

// Reads the first field that is actually present and numeric, and — unlike
// `toNumber(firstString(...))` — keeps `fallback` when every alias is absent.
// `Number('')` is 0, so the old one-liner turned "the API did not send a
// subtotal" into a ₹0 order instead of the total of its own lines.
function pickNumber(values, fallback = 0) {
  for (const value of values) {
    const text = firstString(value);
    if (!text) continue;
    const number = Number(text.replace(/[^\d.-]/g, ''));
    if (Number.isFinite(number)) return number;
  }
  return fallback;
}

function firstString(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

// The catalog is shared with other My Naai surfaces, so a product arrives under
// several names (`productId`/`id`, `productName`/`name`, `isAvailable`/
// `inStock`) and `available` has been seen as `true`, `"true"` and `1`.
// A product can carry several photos. Admin may send `imagesArray`, `images`,
// `imageUrls` or a single `productImage`; every shape is flattened to one list
// so the shelf shows the first photo and the product page can show the rest.
export function productImages(item = {}) {
  const list = [].concat(item.imagesArray || item.images || item.imageUrls || []).filter(Boolean);
  const single = firstString(item.productImage, item.image, item.imageUrl);
  if (single && !list.includes(single)) list.unshift(single);
  return list.filter(value => typeof value === 'string' && value.trim());
}

export function normalizeShopProduct(item = {}) {
  const stock = pickNumber([item.stock, item.stockCount, item.quantityAvailable, item.availableQuantity], 0);
  const availableValue = item.isAvailable ?? item.available ?? item.inStock ?? true;
  const available = !(availableValue === false || String(availableValue).toLowerCase() === 'false');
  const price = pickNumber([item.price, item.sellingPrice, item.salePrice, item.amount], 0);
  const mrp = pickNumber([item.mrp, item.mrpPrice, item.actualPrice, item.maxPrice], 0);
  return {
    id: firstString(item.productId, item.id, item._id) || `shop-${Math.random().toString(36).slice(2, 9)}`,
    name: firstString(item.productName, item.name, item.title) || 'Unnamed product',
    brand: firstString(item.brand, item.brandName, item.company),
    category: firstString(item.category, item.productCategory, item.type) || 'Other',
    description: firstString(item.description, item.productDescription, item.details),
    unit: firstString(item.unit, item.packSize, item.quantityLabel),
    price,
    mrp: mrp > price ? mrp : 0,
    stock,
    available: available && stock !== 0,
    // `stock === 0` from a backend that never sends availability still reads as
    // sold out; a backend that sends neither gets the shelf's default stock.
    image: firstString(item.productImage, item.image, item.imageUrl),
    images: productImages(item),
    rating: pickNumber([item.rating], 0),
  };
}

// ── Orders ───────────────────────────────────────────────────────────────────

// One list, in the order an order travels through it. `tone` is a StatusPill
// tone that already exists in styles.css.
export const ORDER_STATUS = {
  PLACED: { key: 'PLACED', label: 'Order placed', tone: 'pending', note: 'Your order has been sent to the My Naai store.' },
  CONFIRMED: { key: 'CONFIRMED', label: 'Confirmed', tone: 'confirmed', note: 'The store has accepted your order and is packing it.' },
  PACKED: { key: 'PACKED', label: 'Packed', tone: 'confirmed', note: 'Your items are packed and waiting for the courier.' },
  SHIPPED: { key: 'SHIPPED', label: 'Shipped', tone: 'pending', note: 'Your parcel is on its way to the salon.' },
  OUT_FOR_DELIVERY: { key: 'OUT_FOR_DELIVERY', label: 'Out for delivery', tone: 'pending', note: 'The courier is delivering your order today.' },
  DELIVERED: { key: 'DELIVERED', label: 'Delivered', tone: 'completed', note: 'Delivered to your salon.' },
  CANCELLED: { key: 'CANCELLED', label: 'Cancelled', tone: 'cancelled', note: 'This order was cancelled and nothing was charged.' },
};

// The order an order moves through, used by the detail screen's tracker.
export const ORDER_FLOW = ['PLACED', 'CONFIRMED', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'];

// An order that has reached the salon cannot be called back — everything else
// can ("cancel the not-delivered order"). Delivered and cancelled are final.
const FINAL_ORDER_STATUSES = ['DELIVERED', 'CANCELLED'];

export function orderStatusMeta(status) {
  const key = String(status || '').toUpperCase();
  return ORDER_STATUS[key] || { key: key || 'PLACED', label: key ? titleCaseStatus(key) : 'Order placed', tone: 'pending', note: '' };
}

function titleCaseStatus(key) {
  return String(key).toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

export function canCancelOrder(order) {
  if (!order) return false;
  return !FINAL_ORDER_STATUSES.includes(String(order.status || '').toUpperCase());
}

// Servers send seconds, milliseconds and ISO strings, sometimes in the same
// list; a timestamp that cannot be read must not become `Invalid Date`.
export function toTimestamp(value) {
  if (!value && value !== 0) return 0;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 0 : value.getTime();
  if (typeof value === 'number') return value > 0 && value < 1e12 ? value * 1000 : value;
  const text = String(value).trim();
  if (!text) return 0;
  if (/^\d+$/.test(text)) {
    const number = Number(text);
    return number > 0 && number < 1e12 ? number * 1000 : number;
  }
  const parsed = new Date(text).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function normalizeOrderItem(item = {}) {
  const quantity = Math.max(1, pickNumber([item.quantity, item.qty, item.count], 1));
  const price = pickNumber([item.price, item.unitPrice, item.sellingPrice, item.amount], 0);
  return {
    productId: firstString(item.productId, item.id),
    name: firstString(item.productName, item.name) || 'Product',
    image: firstString(item.productImage, item.image, item.imageUrl),
    unit: firstString(item.unit, item.packSize),
    quantity,
    price,
    lineTotal: pickNumber([item.lineTotal, item.total, item.subTotal], price * quantity),
  };
}

export function normalizeOrder(item = {}) {
  const rawItems = Array.isArray(item.items) ? item.items
    : Array.isArray(item.products) ? item.products
      : Array.isArray(item.orderItems) ? item.orderItems
        : Array.isArray(item.orderProducts) ? item.orderProducts
          : [];
  const items = rawItems.map(normalizeOrderItem);
  const status = String(firstString(item.status, item.orderStatus) || 'PLACED').toUpperCase();
  const linesTotal = items.reduce((sum, line) => sum + line.lineTotal, 0);
  const subtotal = pickNumber([item.subtotal, item.subTotal, item.itemTotal], linesTotal);
  // Delivery is free, so the total is what the items cost. A `deliveryFee`
  // that an older payload still carries is ignored rather than charged.
  const totalAmount = pickNumber([item.totalAmount, item.total, item.grandTotal, item.amount], subtotal);
  const address = normalizeAddress(item.address || item.deliveryAddress || item.shippingAddress || {});
  const timeline = Array.isArray(item.timeline) && item.timeline.length
    ? item.timeline.map(step => ({ status: String(step.status || '').toUpperCase(), at: toTimestamp(step.at || step.createdAt) }))
    : buildTimeline(status, toTimestamp(firstString(item.createdAt, item.orderDate, item.placedAt, item.createdOn)));
  return {
    id: firstString(item.orderId, item.id, item._id),
    orderNumber: firstString(item.orderNumber, item.orderCode, item.reference, item.displayId, item.orderId, item.id),
    status,
    statusMeta: ORDER_STATUS[status] || orderStatusMeta(status),
    createdAt: toTimestamp(firstString(item.createdAt, item.orderDate, item.placedAt, item.createdOn)) || Date.now(),
    items,
    itemCount: items.reduce((sum, line) => sum + line.quantity, 0),
    subtotal,
    totalAmount,
    paymentMethod: firstString(item.paymentMethod, item.paymentMode) || 'COD',
    note: firstString(item.note, item.notes, item.deliveryNote),
    address,
    timeline,
    canCancel: !FINAL_ORDER_STATUSES.includes(status),
  };
}

// The backend stores one row per status change; when it sends only the current
// status, the tracker is rebuilt here so an order always reads as progress.
function buildTimeline(status, at) {
  if (!ORDER_FLOW.includes(status)) return [{ status: status || 'PLACED', at }];
  const upto = ORDER_FLOW.indexOf(status);
  return ORDER_FLOW.slice(0, upto + 1).map((key, index) => ({ status: key, at: index === upto ? at : 0 }));
}

// ── Cart & money ─────────────────────────────────────────────────────────────

export function cartTotals(items = []) {
  const lines = Array.isArray(items) ? items : [];
  const itemCount = lines.reduce((sum, item) => sum + Math.max(0, toNumber(item.quantity, 0)), 0);
  let subtotal = 0;
  let savings = 0;
  lines.forEach(item => {
    const quantity = Math.max(0, toNumber(item.quantity, 0));
    const price = toNumber(item.price, 0);
    const mrp = toNumber(item.mrp, 0);
    subtotal += price * quantity;
    if (mrp > price) savings += (mrp - price) * quantity;
  });
  return {
    itemCount,
    subtotal,
    savings,
    // Delivery is free — the salon pays exactly what the items cost.
    total: subtotal,
  };
}

// A cart line keeps the values the partner saw when adding it, so a price change
// in the catalog cannot silently change what is about to be ordered.
export function cartLineFromProduct(product, quantity = 1) {
  return {
    productId: product.id,
    name: product.name,
    brand: product.brand,
    category: product.category,
    image: product.image,
    images: Array.isArray(product.images) ? product.images : (product.image ? [product.image] : []),
    unit: product.unit,
    price: Number(product.price) || 0,
    mrp: Number(product.mrp) || 0,
    stock: Number(product.stock) || 0,
    quantity: Math.max(1, Math.min(quantity, Math.max(1, Number(product.stock) || 1))),
  };
}

export function maxOrderQuantity(product) {
  const stock = Number(product?.stock || 0);
  return stock > 0 ? Math.min(stock, 99) : 0;
}

// ── Address ──────────────────────────────────────────────────────────────────

export function normalizeAddress(value = {}) {
  const address = value && typeof value === 'object' ? value : {};
  return {
    name: firstString(address.name, address.fullName, address.contactName),
    phone: firstString(address.phone, address.phoneNumber, address.mobile, address.mobileNumber),
    line1: firstString(address.line1, address.addressLine1, address.address, address.street),
    line2: firstString(address.line2, address.addressLine2, address.landmark),
    city: firstString(address.city),
    state: firstString(address.state),
    pincode: firstString(address.pincode, address.pinCode, address.zip),
  };
}

// The shop delivers to the salon, so the salon's own profile IS the default
// delivery address — nobody has to type it again.
export function salonAddressFromProfile(profile = {}) {
  const source = { ...(profile || {}), ...(profile?.salon || {}) };
  return normalizeAddress({
    name: firstString(source.ownerName, source.salonName, source.name),
    phone: firstString(source.phoneNumber, source.phone, source.mobile),
    line1: firstString(source.addressLine1, source.address),
    line2: firstString(source.addressLine2, source.landmark),
    city: source.city,
    state: source.state,
    pincode: firstString(source.pincode, source.pinCode),
  });
}

export function formatAddress(address = {}, { multiline = false } = {}) {
  const value = normalizeAddress(address);
  const parts = [value.line1, value.line2, value.city, value.state, value.pincode].filter(Boolean);
  return parts.join(multiline ? ', ' : ', ');
}

export function isAddressComplete(address = {}) {
  const value = normalizeAddress(address);
  return Boolean(value.name && value.line1 && value.city && value.pincode && value.phone);
}

// Inline, per-field errors — the checkout never disables its button without
// saying which field is missing.
export function validateAddress(address = {}) {
  const value = normalizeAddress(address);
  const errors = {};
  if (!value.name) errors.name = 'Add a contact name for the delivery.';
  if (!value.line1) errors.line1 = 'Add the street or building address.';
  if (!value.city) errors.city = 'Add the city.';
  if (!value.pincode) errors.pincode = 'Add the pincode.';
  else if (!/^\d{6}$/.test(value.pincode)) errors.pincode = 'Pincode must be 6 digits.';
  if (!value.phone) errors.phone = 'Add a mobile number for the delivery.';
  else if (value.phone.replace(/\D/g, '').length < 10) errors.phone = 'Enter a 10-digit mobile number.';
  return errors;
}

// ── Local storage: cart + offline orders ─────────────────────────────────────

const CART_KEY = 'mynaai:shop-cart';
const SAVED_KEY = 'mynaai:shop-saved';
const ORDERS_KEY = 'mynaai:shop-orders';

function readStore(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A browser that refuses storage (private mode, quota) loses the cart on
    // reload; it must never break the screen that is already open.
  }
}

// The cart belongs to the salon, not to the browser profile: a partner who
// signs out and back in (or switches salon on one device) must not inherit
// somebody else's cart.
export function readCart(salonId) {
  const store = readStore(CART_KEY);
  const items = store[String(salonId || '')];
  if (!Array.isArray(items)) return [];
  return items
    .filter(item => item && item.productId)
    .map(item => ({ ...item, quantity: Math.max(1, toNumber(item.quantity, 1)), price: toNumber(item.price, 0) }));
}

export function saveCart(salonId, items) {
  const store = readStore(CART_KEY);
  const key = String(salonId || '');
  if (!items || !items.length) delete store[key];
  else store[key] = items;
  writeStore(CART_KEY, store);
}

export function readLocalOrders(salonId) {
  const store = readStore(ORDERS_KEY);
  const orders = store[String(salonId || '')];
  return Array.isArray(orders) ? orders.map(normalizeOrder) : [];
}

// "Save for later" — a second, per-salon list next to the cart. Nothing here is
// ordered; it exists so a partner can park an item instead of deleting it.
export function readSaved(salonId) {
  const store = readStore(SAVED_KEY);
  const items = store[String(salonId || '')];
  return Array.isArray(items) ? items.filter(item => item && item.productId).map(item => ({ ...item, quantity: Math.max(1, toNumber(item.quantity, 1)) })) : [];
}

export function saveSaved(salonId, items) {
  const store = readStore(SAVED_KEY);
  const key = String(salonId || '');
  if (!items || !items.length) delete store[key];
  else store[key] = items;
  writeStore(SAVED_KEY, store);
}

function writeLocalOrders(salonId, orders) {
  const store = readStore(ORDERS_KEY);
  const key = String(salonId || '');
  if (!orders.length) delete store[key];
  else store[key] = orders;
  writeStore(ORDERS_KEY, store);
}

// ── API ──────────────────────────────────────────────────────────────────────

// Sample/device fallback is for review builds only: the Vite dev server always
// allows it (that is where the flow gets demoed before the backend ships) and a
// deployed build opts in with VITE_SHOP_FALLBACK=true. Nothing else shows a
// product the admin did not publish.
export function shopFallbackEnabled() {
  return Boolean(import.meta.env?.DEV) || String(import.meta.env?.VITE_SHOP_FALLBACK || '').toLowerCase() === 'true';
}

function pickList(response, keys = []) {
  if (Array.isArray(response?.data)) return response.data;
  for (const key of keys) {
    if (Array.isArray(response?.data?.[key])) return response.data[key];
    if (Array.isArray(response?.[key])) return response[key];
  }
  if (Array.isArray(response?.products)) return response.products;
  return [];
}

function failedResponse(response) {
  const status = String(response?.status || '').toUpperCase();
  return Boolean(status) && status !== 'SUCCESS' && status !== 'OK';
}

function matchesFilters(product, { search = '', category = '' } = {}) {
  const query = String(search || '').trim().toLowerCase();
  const selectedCategory = String(category || '').trim().toLowerCase();
  if (selectedCategory && selectedCategory !== 'all' && String(product.category || '').toLowerCase() !== selectedCategory) return false;
  if (!query) return true;
  return `${product.name} ${product.brand} ${product.category}`.toLowerCase().includes(query);
}

// A server that ignores the filters (or the sample fallback) still shows the
// right shelf, so the screen filters what it received as well.
export function filterShopProducts(products = [], filters = {}) {
  return (products || []).filter(product => matchesFilters(product, filters)
    && (!filters.inStockOnly || (product.available && maxOrderQuantity(product) > 0)));
}

// "Only 4 left" is the nudge a supply order actually responds to — but only
// when there is genuinely little left, not for every product under the sun.
export const LOW_STOCK_THRESHOLD = 10;

export function isLowStock(product) {
  const stock = Number(product?.stock || 0);
  return Boolean(product?.available) && stock > 0 && stock <= LOW_STOCK_THRESHOLD;
}

// Sorting is offered in the UI and also sent to the API, so a backend that can
// sort returns the page already ordered and one that cannot still reads right.
export const SORT_OPTIONS = [
  { key: 'relevance', label: 'Relevance' },
  { key: 'price-asc', label: 'Price: low to high' },
  { key: 'price-desc', label: 'Price: high to low' },
  { key: 'name', label: 'Name A–Z' },
  { key: 'rating', label: 'Top rated' },
];

export function sortShopProducts(products = [], sort = 'relevance') {
  const list = [...(products || [])];
  const byName = (a, b) => String(a.name).localeCompare(String(b.name));
  if (sort === 'price-asc') return list.sort((a, b) => Number(a.price) - Number(b.price) || byName(a, b));
  if (sort === 'price-desc') return list.sort((a, b) => Number(b.price) - Number(a.price) || byName(a, b));
  if (sort === 'name') return list.sort(byName);
  if (sort === 'rating') return list.sort((a, b) => Number(b.rating) - Number(a.rating) || byName(a, b));
  return list;
}

// "More from Hair colour" — same category first, then the rest of the shelf, so
// the row is never empty on a small catalog.
export function relatedShopProducts(products = [], product = null, limit = 6) {
  const others = (products || []).filter(item => item.id !== product?.id);
  const sameCategory = others.filter(item => item.category && item.category === product?.category);
  const rest = others.filter(item => item.category !== product?.category);
  return [...sameCategory, ...rest].slice(0, limit);
}

// A deep link a partner can paste into WhatsApp — the shop's views are routes,
// so this opens the exact product on any device.
export function shopProductUrl(product) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/shop?view=product&productId=${encodeURIComponent(product?.id || '')}`;
}

export async function shareShopProduct(product, notify) {
  const url = shopProductUrl(product);
  const name = product?.name || 'this product';
  try {
    if (typeof navigator !== 'undefined' && navigator.share) {
      await navigator.share({ title: `${name} — My Naai shop`, text: `${name} for your salon, on the My Naai shop.`, url });
      return;
    }
  } catch (shareError) {
    if (shareError?.name === 'AbortError') return; // the partner closed the sheet
  }
  try {
    await navigator.clipboard.writeText(url);
    notify?.('success', 'Product link copied — share it anywhere.');
  } catch {
    notify?.('error', 'Could not share this product. Copy the link from the address bar.');
  }
}

// Product list. Server-side filtering is preferred (the catalog will be big);
// the sample fallback filters here instead.
export async function loadShopProducts(filters = {}) {
  try {
    const response = await api.shopProductList({ search: filters.search || '', category: filters.category || '' });
    if (failedResponse(response)) throw new Error(response?.message || 'Could not load the shop catalog.');
    const list = pickList(response, ['products', 'items', 'catalog']);
    return { products: list.map(normalizeShopProduct), source: 'api' };
  } catch (error) {
    if (!shopFallbackEnabled()) throw error;
    return {
      products: SAMPLE_SHOP_PRODUCTS.map(normalizeShopProduct).filter(product => matchesFilters(product, filters)),
      source: 'sample',
      error,
    };
  }
}

function orderPayload({ items, address, note, paymentMethod }, totals) {
  return {
    items: items.map(item => ({
      productId: item.productId,
      name: item.name,
      quantity: Number(item.quantity) || 1,
      price: Number(item.price) || 0,
    })),
    address: normalizeAddress(address),
    paymentMethod: paymentMethod || 'COD',
    note: String(note || '').trim(),
    itemCount: totals.itemCount,
    subtotal: totals.subtotal,
    totalAmount: totals.total,
  };
}

// Places the order. Returns `{ order, source }` — `source: 'local'` means the
// device stored it because the order service could not be reached.
export async function submitOrder({ items, address, note = '', paymentMethod = 'COD' }, { salonId } = {}) {
  const totals = cartTotals(items);
  const payload = orderPayload({ items, address, note, paymentMethod }, totals);
  try {
    const response = await api.createOrder(payload);
    if (failedResponse(response)) throw new Error(response?.message || 'Could not place your order.');
    const data = response?.data?.order || response?.data || response?.order || payload;
    return { order: normalizeOrder({ ...data, ...payload }), source: 'api' };
  } catch (error) {
    if (!shopFallbackEnabled()) throw error;
    const order = normalizeOrder({
      ...payload,
      orderId: `LOCAL-${Date.now()}`,
      status: 'PLACED',
      createdAt: Date.now(),
      items: items.map(item => ({ ...item, productName: item.name, lineTotal: (Number(item.price) || 0) * (Number(item.quantity) || 1) })),
    });
    writeLocalOrders(salonId, [order, ...readLocalOrders(salonId)]);
    return { order, source: 'local' };
  }
}

export async function loadOrders({ salonId } = {}) {
  try {
    const response = await api.orderList({});
    if (failedResponse(response)) throw new Error(response?.message || 'Could not load your orders.');
    const list = pickList(response, ['orders', 'items']);
    return { orders: list.map(normalizeOrder).sort((a, b) => b.createdAt - a.createdAt), source: 'api' };
  } catch (error) {
    if (!shopFallbackEnabled()) throw error;
    return { orders: readLocalOrders(salonId), source: 'local', error };
  }
}

export async function cancelShopOrder(orderId, reason = '', { salonId } = {}) {
  try {
    const response = await api.cancelOrder({ orderId, reason });
    if (failedResponse(response)) throw new Error(response?.message || 'Could not cancel this order.');
    const data = response?.data?.order || response?.data || { orderId, status: 'CANCELLED' };
    return { order: normalizeOrder({ ...data, orderId, status: 'CANCELLED' }), source: 'api' };
  } catch (error) {
    if (!shopFallbackEnabled()) throw error;
    const orders = readLocalOrders(salonId).map(order => (order.id === orderId
      ? normalizeOrder({ ...order, status: 'CANCELLED' })
      : order));
    writeLocalOrders(salonId, orders);
    const order = orders.find(item => item.id === orderId) || normalizeOrder({ orderId, status: 'CANCELLED' });
    return { order, source: 'local' };
  }
}

// A cart restored from storage can hold a product admin has since removed, made
// unavailable or run out of: drop it, or cap it at what is actually left.
export function reconcileCart(items = [], products = []) {
  if (!Array.isArray(items) || !items.length) return [];
  const byId = new Map(products.map(product => [product.id, product]));
  return items.reduce((lines, item) => {
    const product = byId.get(item.productId);
    if (!product) return lines;
    if (!product.available || maxOrderQuantity(product) === 0) return lines;
    const quantity = Math.min(Math.max(1, toNumber(item.quantity, 1)), maxOrderQuantity(product));
    lines.push({ ...cartLineFromProduct(product, quantity) });
    return lines;
  }, []);
}

// Saved items are parked, not ordered — they survive a product going out of
// stock (it may be back next week) but not being removed from the catalog.
export function reconcileSaved(items = [], products = []) {
  if (!Array.isArray(items) || !items.length) return [];
  const byId = new Map(products.map(product => [product.id, product]));
  return items.reduce((lines, item) => {
    const product = byId.get(item.productId);
    if (!product) return lines;
    lines.push({ ...item, price: product.price, mrp: product.mrp, stock: product.stock, available: product.available, name: product.name, image: product.image || item.image, unit: product.unit || item.unit });
    return lines;
  }, []);
}
