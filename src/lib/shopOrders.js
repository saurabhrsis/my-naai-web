// The Naai Shop commerce engine — cart, checkout math, order lifecycle and
// the time-based status tracker, in one framework-free module.
//
// Why client-side? The MyNaai backend exposes the product catalog but no
// order endpoints yet (there is no /api/orders controller to call). The shop
// therefore owns its orders in this module, persisted per salon account in
// localStorage, exactly the way the mobile session store mirrors itself when
// storage is available. Every read/write funnels through the small storage
// functions at the bottom of this file, so wiring a real backend later means
// replacing those functions — the screens, the cart and the tracker do not
// change.
//
// Status model: an order walks a deterministic timeline from `placedAt`
// (placed → packed → shipped → delivered), the same trick the booking queue
// uses for "due now / overdue" chips. `getOrderStatus(order, now)` is pure —
// the screens pass `now` (default Date.now()) so tests are exact.

const CART_PREFIX = 'mynaaiShopCart:';
const ORDERS_PREFIX = 'mynaaiShopOrders:';

// Blinkit-style shipping: free above the threshold, a flat fee below it.
export const DELIVERY_FEE = 49;
export const FREE_DELIVERY_ABOVE = 499;

// Minutes after placement at which each step becomes current. Delivered is
// the ETA: 26 hours covers a next-day slot without over-promising.
export const STATUS_TIMELINE = [
  { key: 'placed', label: 'Order placed', atMinutes: 0 },
  { key: 'packed', label: 'Packing your order', atMinutes: 30 },
  { key: 'shipped', label: 'Out for delivery', atMinutes: 180 },
  { key: 'delivered', label: 'Delivered', atMinutes: 26 * 60 },
];
export const DELIVERY_AT_MINUTES = STATUS_TIMELINE[STATUS_TIMELINE.length - 1].atMinutes;

const ORDER_ID_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function orderKey(salonId) {
  return `${ORDERS_PREFIX}${String(salonId || 'guest')}`;
}
function cartKey(salonId) {
  return `${CART_PREFIX}${String(salonId || 'guest')}`;
}

function readJson(key) {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be blocked (private mode) or full. The in-memory state the
    // screen already holds keeps the flow working for this visit.
  }
}

export function clearShopStorage(salonId) {
  try {
    localStorage.removeItem(cartKey(salonId));
    localStorage.removeItem(orderKey(salonId));
  } catch { /* storage blocked */ }
}

/* ------------------------------------------------------------------ *\
 * Cart
 * ------------------------------------------------------------------ */

// A cart line keeps a snapshot of the product at the time it was added, so a
// catalog price change mid-checkout never rewrites an already-shown bill.
export function normalizeCartLine(line = {}) {
  return {
    productId: String(line.productId || line.id || ''),
    name: line.name || 'Untitled product',
    price: Math.max(0, Number(line.price) || 0),
    mrp: Math.max(0, Number(line.mrp) || 0),
    image: line.image || '',
    category: line.category || '',
    gender: line.gender || '',
    salonName: line.salonName || '',
    qty: Math.max(1, Math.min(99, Math.round(Number(line.qty) || 1))),
  };
}

export function readCart(salonId) {
  const stored = readJson(cartKey(salonId));
  const lines = Array.isArray(stored) ? stored : [];
  return lines.map(normalizeCartLine);
}

export function saveCart(salonId, lines) {
  writeJson(cartKey(salonId), (lines || []).map(normalizeCartLine));
}

// Upsert by product id and return the fresh cart (the screen keeps its own
// state and calls this to persist).
export function addToCart(salonId, product, qty = 1) {
  const lines = readCart(salonId).map(line => ({ ...line }));
  const index = lines.findIndex(line => line.productId === String(product?.id || product?.productId || ''));
  if (index >= 0) lines[index].qty = Math.min(99, lines[index].qty + Math.max(1, Math.round(Number(qty) || 1)));
  else lines.push(normalizeCartLine({ ...product, qty: Math.max(1, Math.round(Number(qty) || 1)) }));
  saveCart(salonId, lines);
  return lines;
}

// Absolute set (the stepper) — qty <= 0 removes the line.
export function setCartQty(salonId, productId, qty) {
  let lines = readCart(salonId).map(line => ({ ...line }));
  const next = Math.round(Number(qty) || 0);
  if (next <= 0) lines = lines.filter(line => line.productId !== String(productId));
  else {
    const index = lines.findIndex(line => line.productId === String(productId));
    if (index < 0) return lines;
    lines[index].qty = Math.min(99, next);
  }
  saveCart(salonId, lines);
  return lines;
}

export function removeCartLine(salonId, productId) {
  const lines = readCart(salonId).map(line => ({ ...line })).filter(line => line.productId !== String(productId));
  saveCart(salonId, lines);
  return lines;
}

export function clearCart(salonId) {
  saveCart(salonId, []);
  return [];
}

export function cartCount(lines) {
  return (lines || []).reduce((sum, line) => sum + (line ? lineQty(line) : 0), 0);
}

// A raw line without qty is read as one (normalizeCartLine does the same);
// the bill math must never emit NaN even from an un-normalised array.
function lineQty(line) {
  return Math.max(1, Math.min(99, Math.round(Number(line?.qty) || 1)));
}

// The bill: item total, MRP savings, delivery fee and grand total.
// `deliveryFee` is 0 on an empty cart so the "proceed" button can never be
// paid on zero.
export function cartTotals(lines) {
  const itemTotal = (lines || []).reduce((sum, line) => sum + (Number(line?.price) || 0) * lineQty(line), 0);
  const savings = (lines || []).reduce((sum, line) => sum + Math.max(0, (Number(line?.mrp) || 0) - (Number(line?.price) || 0)) * lineQty(line), 0);
  const deliveryFee = !lines?.length || itemTotal >= FREE_DELIVERY_ABOVE ? 0 : DELIVERY_FEE;
  return {
    itemCount: cartCount(lines),
    itemTotal,
    savings,
    deliveryFee,
    total: itemTotal + deliveryFee,
    freeDeliveryAbove: FREE_DELIVERY_ABOVE,
  };
}

// How much more to reach free delivery (0 when already there / empty).
export function freeDeliveryGap(lines) {
  const { itemTotal, deliveryFee } = cartTotals(lines);
  if (!lines?.length || deliveryFee === 0) return 0;
  return FREE_DELIVERY_ABOVE - itemTotal;
}

/* ------------------------------------------------------------------ *\
 * Orders
 * ------------------------------------------------------------------ */

function randomOrderIdSuffix(length = 4) {
  let value = '';
  for (let i = 0; i < length; i += 1) value += ORDER_ID_CHARS[Math.floor(Math.random() * ORDER_ID_CHARS.length)];
  return value;
}

export function newOrderId(now = Date.now()) {
  return `MN${String(now).toString(36).toUpperCase()}${randomOrderIdSuffix()}`;
}

export function readOrders(salonId) {
  const stored = readJson(orderKey(salonId));
  const orders = Array.isArray(stored) ? stored : [];
  return orders
    .filter(order => order?.id && order?.items?.length)
    .sort((a, b) => String(b.placedAt).localeCompare(String(a.placedAt)));
}

export function findOrder(salonId, orderId) {
  return readOrders(salonId).find(order => order.id === orderId) || null;
}

// The address snapshot is the only delivery record the shop keeps, so it is
// validated here — the forms validate too, but a hand-edited storage entry
// must not break the tracker.
function normalizeAddress(address = {}) {
  return {
    name: String(address.name || '').trim(),
    phone: String(address.phone || '').trim(),
    line1: String(address.line1 || '').trim(),
    city: String(address.city || '').trim(),
    state: String(address.state || '').trim(),
    pincode: String(address.pincode || '').trim(),
  };
}

// `now` is injectable so the deterministic timeline can be tested exactly;
// the screens call it without the extra argument.
export function placeOrder(salonId, { items, address, payment, amounts, salonName = '' } = {}, { now = Date.now() } = {}) {
  const order = {
    id: newOrderId(now),
    salonId: String(salonId || 'guest'),
    salonName: String(salonName || ''),
    items: (items || []).map(line => normalizeCartLine(line)),
    address: normalizeAddress(address),
    payment: {
      method: payment?.method === 'COD' ? 'COD' : 'ONLINE',
      status: payment?.status || 'PENDING',
      paymentId: payment?.paymentId || '',
      amount: Math.max(0, Number(payment?.amount) || Number(amounts?.total) || 0),
    },
    amounts: {
      itemTotal: Number(amounts?.itemTotal) || 0,
      savings: Number(amounts?.savings) || 0,
      deliveryFee: Number(amounts?.deliveryFee) || 0,
      total: Number(amounts?.total) || 0,
    },
    placedAt: new Date(now).toISOString(),
    cancelledAt: null,
    cancelReason: '',
  };
  const orders = readOrders(salonId);
  orders.unshift(order);
  writeJson(orderKey(salonId), orders);
  return order;
}

// Status progression: the last timeline step whose time has been reached.
// `now` is a timestamp so the tracker (and its tests) move on demand.
export function getOrderStatus(order, now = Date.now()) {
  if (!order) return { key: 'placed', label: 'Order placed', stepIndex: 0, progress: 0, eta: null };
  if (order.cancelledAt) {
    return { key: 'cancelled', label: 'Cancelled', stepIndex: -1, progress: 0, eta: null };
  }
  const placedAt = new Date(order.placedAt).getTime() || 0;
  const elapsedMinutes = Math.max(0, (Number(now) - placedAt) / 60000);
  let stepIndex = 0;
  STATUS_TIMELINE.forEach((step, index) => {
    if (elapsedMinutes >= step.atMinutes) stepIndex = index;
  });
  const eta = placedAt + DELIVERY_AT_MINUTES * 60000;
  return {
    key: STATUS_TIMELINE[stepIndex].key,
    label: STATUS_TIMELINE[stepIndex].label,
    stepIndex,
    progress: Math.min(100, Math.round((elapsedMinutes / DELIVERY_AT_MINUTES) * 100)),
    eta: new Date(eta),
  };
}

export const ACTIVE_ORDER_STATUSES = ['placed', 'packed', 'shipped'];

// An order is cancellable while it has not left the warehouse: placed or
// packed. Once "out for delivery" the only route left is support.
export function canCancelOrder(order, now = Date.now()) {
  const status = getOrderStatus(order, now);
  return status.key === 'placed' || status.key === 'packed';
}

export function cancelOrder(salonId, orderId, { now = Date.now(), reason = '' } = {}) {
  const orders = readOrders(salonId);
  const order = orders.find(value => value.id === orderId);
  if (!order) return null;
  if (order.cancelledAt) return order;
  const status = getOrderStatus(order, now);
  if (!(status.key === 'placed' || status.key === 'packed')) return order; // not cancellable
  order.cancelledAt = new Date(now).toISOString();
  order.cancelReason = String(reason || '').trim();
  if (order.payment?.method === 'ONLINE' && order.payment?.status === 'PAID') {
    // Refunds are initiated by support against the payment id; the order
    // shows the customer what to expect instead of a silent state.
    order.payment = { ...order.payment, status: 'REFUND_REQUESTED' };
  }
  writeJson(orderKey(salonId), orders);
  return order;
}

// ETA formatting shared by the tracker and the order cards ("by 6:40 pm,
// Tue 17 Oct" style).
export function formatEta(eta) {
  if (!(eta instanceof Date) || Number.isNaN(eta.getTime())) return '';
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const day = eta.toDateString() === tomorrow.toDateString() ? 'Tomorrow' : eta.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' });
  return `${day}, ${eta.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}`;
}
