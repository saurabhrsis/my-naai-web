// The Naai Shop commerce engine — cart, checkout math, order lifecycle and
// the status tracker, in one framework-free module.
//
// localStorage keeps the in-session copy (offline + guests); the DURABLE,
// account-level copy lives in the backend (`shop_carts` / `shop_orders`) and
// is kept in step by src/lib/shopServerSync.js, so the same salon sees the
// same cart and order history on the web and in the mobile app.
//
// Status model: an order walks a deterministic timeline from `placedAt`
// (placed → packed → shipped → delivered), the same trick the booking queue
// uses for "due now / overdue" chips. When the order carries a `serverStatus`
// (the salon-facing track the backend sends — PENDING / CONFIRMED /
// PROCESSING / SHIPPED / DELIVERED / CANCELLED), that value wins over the
// clock: the tracker maps it onto the timeline (see
// customerStatusToTrackerKey in shopServerSync) and the cancel gate mirrors
// the server's rule (cancellable until the parcel leaves the depot).
// `getOrderStatus(order, now)` stays pure — the screens pass `now`
// (default Date.now()) so tests are exact.

import { toPoint } from './geo';

const CART_PREFIX = 'mynaaiShopCart:';
const ORDERS_PREFIX = 'mynaaiShopOrders:';

// Blinkit-style shipping: free above the threshold, a flat fee below it.
// The rules are admin-managed on the backend (single-row `shop_settings`
// table, edited in the Shop Settings tab) and reach the screens through
// `useShopSettings` (src/lib/shopSettings.js). These constants are the SAME
// defaults the backend seeds that row with, so a bill computed with the
// defaults — offline, or before the settings fetch resolves — matches the
// server's bill exactly.
export const DELIVERY_FEE = 49;
export const FREE_DELIVERY_ABOVE = 499;
export const DEFAULT_SHOP_SETTINGS = {
  freeDeliveryAbove: FREE_DELIVERY_ABOVE,
  deliveryFee: DELIVERY_FEE,
  discountPercent: 0,
  codThreshold: 0, // 0 = no limit
  codCharges: 0,
};

// Minutes after placement at which each step becomes current — a coarse
// progress signal only. The shop never prints an arrival CLOCK TIME: an
// "Arriving by Tomorrow, 08:51 pm" line was invented from `placedAt + 26 h`
// and read as a promise the backend never made (delivery is handled by the
// platform's own dispatch), so all ETA display was removed.
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

/**
 * Move a visitor's cart onto the account that just signed in.
 *
 * The storefront lets anyone fill a cart (`mynaaiShopCart:guest`) and asks for
 * an account at the moment of purchase. Signing in must therefore CARRY that
 * basket over, or the visitor reaches checkout with an empty cart — the exact
 * bug the gate would otherwise hide. Lines the account already had win on a
 * duplicate (they were picked in a signed-in session); the visitor's quantity
 * is kept when it is larger, and the guest copy is cleared so a shared device
 * never shows the same items twice.
 *
 * Returns the merged cart ([] when there was nothing to adopt).
 */
export function adoptGuestCart(ownerId) {
  const target = String(ownerId || 'guest');
  if (!target || target === 'guest') return [];
  const guestLines = readCart('guest');
  if (!guestLines.length) return [];

  const merged = readCart(target).map(line => ({ ...line }));
  guestLines.forEach(line => {
    const index = merged.findIndex(item => item.productId === line.productId);
    if (index >= 0) merged[index].qty = Math.min(99, Math.max(merged[index].qty, line.qty));
    else merged.push({ ...line });
  });

  saveCart(target, merged);
  saveCart('guest', []);
  return merged;
}

export function cartCount(lines) {
  return (lines || []).reduce((sum, line) => sum + (line ? lineQty(line) : 0), 0);
}

// A raw line without qty is read as one (normalizeCartLine does the same);
// the bill math must never emit NaN even from an un-normalised array.
function lineQty(line) {
  return Math.max(1, Math.min(99, Math.round(Number(line?.qty) || 1)));
}

const clampPercent = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(100, n);
};

// A settings value, with the shipped default as fallback for unset rows.
const settingsNumber = (settings, field, fallback) => {
  const n = Number(settings?.[field]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

// The bill: item total, MRP savings, delivery fee and grand total.
// `deliveryFee` is 0 on an empty cart so the "proceed" button can never be
// paid on zero.
//
// `settings` is the admin-managed shop_settings row (see
// DEFAULT_SHOP_SETTINGS) — when omitted the bill is exactly the historic
// one. `method` ('COD' | 'ONLINE') adds the admin-set COD charges when COD
// is chosen. The free-delivery threshold applies to the AFTER-DISCOUNT
// subtotal, so the admin's discount and free-delivery rules compose
// predictably. MUST stay in lock-step with the backend's computeTotals
// (my_naai_backend/src/services/shopOrder.service.js) — the server
// recomputes the same bill when the order is registered.
export function cartTotals(lines, settings = null, { method } = {}) {
  const freeAbove = settingsNumber(settings, 'freeDeliveryAbove', FREE_DELIVERY_ABOVE);
  const fee = settingsNumber(settings, 'deliveryFee', DELIVERY_FEE);
  const discountPercent = clampPercent(settings?.discountPercent);
  const codCharges = settingsNumber(settings, 'codCharges', 0);

  const itemTotal = (lines || []).reduce((sum, line) => sum + (Number(line?.price) || 0) * lineQty(line), 0);
  const savings = (lines || []).reduce((sum, line) => sum + Math.max(0, (Number(line?.mrp) || 0) - (Number(line?.price) || 0)) * lineQty(line), 0);
  const discount = Math.round((itemTotal * discountPercent) / 100);
  const subtotal = itemTotal - discount;
  const deliveryFee = !lines?.length || subtotal >= freeAbove ? 0 : fee;
  const codFee = method === 'COD' ? codCharges : 0;
  return {
    itemCount: cartCount(lines),
    itemTotal,
    savings,
    discount,
    subtotal,
    deliveryFee,
    codFee,
    total: subtotal + deliveryFee + codFee,
    freeDeliveryAbove: freeAbove,
    deliveryFeeBase: fee,
    discountPercent,
  };
}

// How much more (after discount) to reach free delivery (0 when already
// there / empty).
export function freeDeliveryGap(lines, settings = null) {
  const totals = cartTotals(lines, settings);
  if (!lines?.length || totals.deliveryFee === 0) return 0;
  return totals.freeDeliveryAbove - totals.subtotal;
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

// Persist a whole (already merged/sorted) history — used after the server
// merge so offline visits and the detail screen see the server-tracked
// status without a round-trip.
export function saveOrders(salonId, orders) {
  writeJson(orderKey(salonId), (orders || []).filter(order => order?.id && order?.items?.length));
}

// Merge a server-fetched order into the local history (server copy wins on
// the same id) so an order seen through the backend is also found by the
// purely local reads — offline visits, the cancel gate, the detail screen.
export function upsertLocalOrder(salonId, order) {
  if (!order?.id) return null;
  const orders = readOrders(salonId);
  const index = orders.findIndex(value => value.id === order.id);
  if (index >= 0) orders[index] = { ...order };
  else orders.unshift({ ...order });
  writeJson(orderKey(salonId), orders);
  return { ...order };
}

// Remove a draft order (used when the server refuses an order that nothing
// was charged for — an order the salon can see but My Naai has never heard of
// is worse than an honest failure).
export function removeLocalOrder(salonId, orderId) {
  const orders = readOrders(salonId).filter(order => order.id !== String(orderId));
  writeJson(orderKey(salonId), orders);
  return orders;
}

// `pending` = the server has not confirmed it yet (queued for retry);
// `synced`  = it is a real record on the backend.
export function setOrderSyncState(salonId, orderId, syncState, extra = {}) {
  const orders = readOrders(salonId).map(order =>
    order.id === String(orderId) ? { ...order, ...extra, syncState } : order
  );
  writeJson(orderKey(salonId), orders);
  return orders.find(order => order.id === String(orderId)) || null;
}

// The address snapshot is the only delivery record the shop keeps, so it is
// validated here — the forms validate too, but a hand-edited storage entry
// must not break the tracker.
function normalizeAddress(address = {}) {
  // The delivery point travels with the address so the admin panel and the
  // delivery partner can put the order on a map. It is kept OUT of the text
  // fields (a coordinate is not part of the address the salon typed) and is
  // `null` rather than 0 when unknown — 0,0 is a real place in the Atlantic.
  const point = toPoint(address);
  const clean = {
    name: String(address.name || '').trim(),
    phone: String(address.phone || '').trim(),
    line1: String(address.line1 || '').trim(),
    city: String(address.city || '').trim(),
    state: String(address.state || '').trim(),
    pincode: String(address.pincode || '').trim(),
  };
  // Only carry the pair when it exists: an order from a salon without GPS
  // keeps exactly the shape it always had, and no client reads a missing
  // coordinate as (0, 0).
  if (point) {
    clean.latitude = point.latitude;
    clean.longitude = point.longitude;
  }
  return clean;
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
      discount: Number(amounts?.discount) || 0,
      deliveryFee: Number(amounts?.deliveryFee) || 0,
      codFee: Number(amounts?.codFee) || 0,
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

// The salon-facing order track the backend sends (as `status`) mapped onto
// this 4-step timeline. Kept here — the commerce core — so the tracker and
// shopServerSync share one table. The mapping is monotonic with the admin's
// internal track: PENDING (awaiting a delivery partner) → placed, CONFIRMED
// (assigned) → packed, PROCESSING (picked up at the depot) / SHIPPED (on the
// road) → shipped, DELIVERED → delivered.
export const SERVER_STATUS_TO_STEP_INDEX = {
  PENDING: 0,
  CONFIRMED: 1,
  PROCESSING: 2,
  SHIPPED: 2,
  DELIVERED: 3,
  CANCELLED: -1,
};

export function customerStatusToTrackerKey(status) {
  const index = SERVER_STATUS_TO_STEP_INDEX[String(status || '').toUpperCase()];
  if (index === undefined) return null;
  return index === -1 ? 'cancelled' : STATUS_TIMELINE[index].key;
}

// Status progression: when the order carries a `serverStatus` (it came from
// the backend and its fulfilment is managed server-side) that value wins
// over the clock; otherwise the order walks the deterministic timeline from
// `placedAt`. `now` is a timestamp so the tracker (and its tests) move on
// demand.
export function getOrderStatus(order, now = Date.now()) {
  if (!order) return { key: 'placed', label: 'Order placed', stepIndex: 0, progress: 0 };
  if (order.cancelledAt || String(order.serverStatus || '').toUpperCase() === 'CANCELLED') {
    return { key: 'cancelled', label: 'Cancelled', stepIndex: -1, progress: 0 };
  }

  const serverKey = customerStatusToTrackerKey(order.serverStatus);
  const placedAt = new Date(order.placedAt).getTime() || 0;

  if (serverKey) {
    const stepIndex = STATUS_TIMELINE.findIndex(step => step.key === serverKey);
    return {
      key: serverKey,
      label: STATUS_TIMELINE[stepIndex].label,
      stepIndex,
      progress: Math.round((stepIndex / (STATUS_TIMELINE.length - 1)) * 100),
    };
  }

  const elapsedMinutes = Math.max(0, (Number(now) - placedAt) / 60000);
  let stepIndex = 0;
  STATUS_TIMELINE.forEach((step, index) => {
    if (elapsedMinutes >= step.atMinutes) stepIndex = index;
  });
  return {
    key: STATUS_TIMELINE[stepIndex].key,
    label: STATUS_TIMELINE[stepIndex].label,
    stepIndex,
    progress: Math.min(100, Math.round((elapsedMinutes / DELIVERY_AT_MINUTES) * 100)),
  };
}

export const ACTIVE_ORDER_STATUSES = ['placed', 'packed', 'shipped'];

// An order is cancellable while it has not left the warehouse. For a
// server-tracked order the backend is the authority (cancellable until the
// parcel leaves the depot — the customer track PENDING/CONFIRMED/PROCESSING);
// a local-only order falls back to the clock (placed or packed).
export function canCancelOrder(order, now = Date.now()) {
  if (!order || order.cancelledAt) return false;
  const serverStatus = String(order.serverStatus || '').toUpperCase();
  if (serverStatus) {
    return ['PENDING', 'CONFIRMED', 'PROCESSING'].includes(serverStatus);
  }
  const status = getOrderStatus(order, now);
  return status.key === 'placed' || status.key === 'packed';
}

export function cancelOrder(salonId, orderId, { now = Date.now(), reason = '' } = {}) {
  const orders = readOrders(salonId);
  const order = orders.find(value => value.id === orderId);
  if (!order) return null;
  if (order.cancelledAt) return order;
  if (!canCancelOrder(order, now)) return order; // not cancellable (clock or server gate)
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
