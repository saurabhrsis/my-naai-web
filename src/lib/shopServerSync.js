// The server-side bridge for the Naai Shop.
//
// The commerce core (src/lib/shopOrders.js) stays localStorage-first so the
// shop works offline and for guests; this module keeps the DURABLE copy in
// the backend (tables shop_carts / shop_orders) so the same salon account
// sees the same cart and the same order history on the web portal AND the
// mobile app — the web-only flow lost both when the device changed.
//
// Shape of the flow:
//   · local state always updates first (instant UI), then the matching call
//     is fired at the backend fire-and-forget — a failed push must never
//     break the in-session flow, the local record survives and the next
//     mount re-syncs from the server;
//   · on mount, a signed-in account PULLS the server cart/orders, which win
//     over the local copy (the server is the account-level truth);
//   · after checkout the order the client just wrote locally is REGISTERED
//     on the server under the same id (`placeOrder` generates it first), so
//     the local record and the server record share an identity;
//   · guests (no session token) never touch the network and keep the pure
//     localStorage behaviour.
//
// Everything async swallows its own errors and resolves to a falsy value,
// so callers can chain without try/catch. The pure `map*` helpers are
// exported for the unit tests.

import { api } from './api';
import { toPoint } from './geo';
import { readLocalSession } from './session';
import { normalizeCartLine, customerStatusToTrackerKey, SERVER_STATUS_TO_STEP_INDEX } from './shopOrders';

// Re-exported so screens/tests can reach the mapping from either module.
export { customerStatusToTrackerKey, SERVER_STATUS_TO_STEP_INDEX };
export const CANCELLABLE_SERVER_STATUSES = ['PENDING', 'CONFIRMED', 'PROCESSING'];

/* ------------------------------------------------------------------ *
 * Pure mappers — server payload <-> the local line/order shapes
 * ------------------------------------------------------------------ */

// Server cart line -> local cart line (the shapes already match 1:1).
export function mapServerCartLine(line = {}) {
  return normalizeCartLine({
    productId: line.productId,
    name: line.name,
    price: line.price,
    mrp: line.mrp,
    image: line.image,
    category: line.category,
    gender: line.gender,
    salonName: line.salonName || '',
    qty: line.qty,
  });
}

export function mapServerCart(data) {
  const lines = Array.isArray(data?.lines) ? data.lines : [];
  return lines.map(mapServerCartLine);
}

// Server order -> local order shape. The bill (`amounts`) and the items
// snapshot come straight from the server (they were recomputed there at
// placement), `placedAt` is the server's createdAt.
export function mapServerOrder(order = {}) {
  const status = String(order.status || order.customerStatus || '').toUpperCase();
  const items = (Array.isArray(order.items) ? order.items : []).map(item => ({
    productId: String(item.productId || item.id || ''),
    name: item.name || 'Untitled product',
    price: Math.max(0, Number(item.price) || 0),
    mrp: Math.max(0, Number(item.mrp) || 0),
    image: item.image || '',
    category: item.category || '',
    gender: item.gender || '',
    salonName: item.salonName || order.salon?.salonName || '',
    qty: Math.max(1, Math.min(99, Math.round(Number(item.qty) || 1))),
  }));
  const amounts = order.amounts || {};
  return {
    id: String(order.orderId || order.id || ''),
    salonId: String(order.salonId || ''),
    salonName: String(order.salon?.salonName || ''),
    items,
    address: {
      name: String(order.address?.name || ''),
      phone: String(order.address?.phone || ''),
      line1: String(order.address?.line1 || ''),
      city: String(order.address?.city || ''),
      state: String(order.address?.state || ''),
      pincode: String(order.address?.pincode || ''),
      // Only present when the server actually stored a point; an order with
      // no coordinates keeps the exact shape it always had.
      ...(toPoint({ latitude: order.address?.latitude, longitude: order.address?.longitude })
        ? {
            latitude: toPoint({ latitude: order.address.latitude, longitude: order.address.longitude }).latitude,
            longitude: toPoint({ latitude: order.address.latitude, longitude: order.address.longitude }).longitude,
          }
        : {}),
    },
    // The point the admin and the delivery partner see on their map (the
    // server computes it from the order snapshot, falling back to the salon).
    deliveryLocation: toPoint(order.deliveryLocation) || null,
    payment: {
      method: order.payment?.method === 'COD' ? 'COD' : 'ONLINE',
      status: String(order.payment?.status || 'PENDING'),
      paymentId: String(order.payment?.paymentId || ''),
      amount: Math.max(0, Number(order.payment?.amount) || Number(amounts.total) || 0),
    },
    amounts: {
      itemTotal: Number(amounts.itemTotal) || 0,
      savings: Number(amounts.savings) || 0,
      deliveryFee: Number(amounts.deliveryFee) || 0,
      total: Number(amounts.total) || 0,
    },
    placedAt: order.createdAt ? new Date(order.createdAt).toISOString() : new Date(0).toISOString(),
    cancelledAt: order.cancelledAt ? new Date(order.cancelledAt).toISOString() : null,
    cancelReason: String(order.cancelReason || ''),
    serverStatus: status || null,
    // Any order that came back from the API is, by definition, accepted by
    // the backend — even if the status field is still empty.
    syncState: 'synced',
  };
}

/* ------------------------------------------------------------------ *
 * Session guard — guests stay fully local
 * ------------------------------------------------------------------ */

function signedIn() {
  try {
    return Boolean(readLocalSession()?.token);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * Cart sync
 * ------------------------------------------------------------------ */

// Pull the account's cart from the server. Resolves to local-shaped lines,
// or null when there is no session / the call fails (keep the local copy).
export async function fetchServerCart() {
  if (!signedIn()) return null;
  try {
    const response = await api.shopCartGet();
    return mapServerCart(response?.data);
  } catch {
    return null;
  }
}

// Fire-and-forget pushes — each resolves true when the server accepted.
export async function pushCartAdd(productId, qty = 1) {
  if (!signedIn() || !productId) return false;
  try {
    await api.shopCartAdd({ productId: String(productId), qty });
    return true;
  } catch {
    return false;
  }
}

export async function pushCartSetQty(productId, qty) {
  if (!signedIn() || !productId) return false;
  try {
    await api.shopCartSetQty({ productId: String(productId), qty });
    return true;
  } catch {
    return false;
  }
}

export async function pushCartRemove(productId) {
  if (!signedIn() || !productId) return false;
  try {
    await api.shopCartRemove({ productId: String(productId) });
    return true;
  } catch {
    return false;
  }
}

export async function clearServerCart() {
  if (!signedIn()) return false;
  try {
    await api.shopCartClear();
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * Order sync
 *
 * SHOP ORDERS ARE SERVER RECORDS. The browser copy is a cache: it keeps the
 * last known state on screen and covers an offline visit, but an order only
 * exists when `POST /api/shop-orders/create` accepted it — that is the row the
 * admin dashboard, the distributor and the salon's other devices read.
 *
 * This used to be a fire-and-forget call whose failure was swallowed
 * (`catch { return false }`), so a rejected registration left an order that
 * was visible ONLY to the salon that placed it. The rejection was real and
 * silent: the client sent `address.latitude/longitude`, the API's address
 * schema does not allow unknown keys, and every COD order 400'd while the
 * screen said "Order placed".
 *
 * So: the payload here is built FROM THE CONTRACT (only the fields the API
 * validates), the result is returned instead of swallowed, and a failed
 * attempt can be retried or queued.
 * ------------------------------------------------------------------ */

// The address fields `POST /api/shop-orders/create` validates. Nothing else
// may go in this object — Joi rejects unknown keys, and one extra key fails the
// whole order.
const ORDER_ADDRESS_KEYS = ['name', 'phone', 'line1', 'city', 'state', 'pincode'];

const digitsOnly = (value, max) => String(value ?? '').replace(/\D/g, '').slice(0, max);

// A cart line -> the API's line shape (uuid productId, numeric price/qty,
// handful of optional snapshot fields).
export function orderLinePayload(line = {}) {
  const payload = {
    productId: String(line.productId || line.id || '').trim(),
    name: String(line.name || 'Product').slice(0, 200),
    price: Math.max(0, Number(line.price) || 0),
    qty: Math.max(1, Math.min(99, Math.round(Number(line.qty) || 1))),
  };
  if (Number(line.mrp) > 0) payload.mrp = Number(line.mrp);
  if (line.image) payload.image = String(line.image);
  if (line.category) payload.category = String(line.category).slice(0, 60);
  if (line.gender) payload.gender = String(line.gender).slice(0, 20);
  if (line.salonName) payload.salonName = String(line.salonName).slice(0, 200);
  return payload;
}

/**
 * The exact body `POST /api/shop-orders/create` expects.
 *
 * `withCoordinates` adds the delivery pin. The deployed API's address schema
 * rejects unknown keys, so this is attempted FIRST and the request is repeated
 * without it when the server says "not allowed" — a build that understands the
 * pin records it, an older one still gets a real order.
 */
export function buildOrderPayload(order = {}, { withCoordinates = true } = {}) {
  const source = order.address || {};
  // Only the contract's keys — built from the allow-list so a field added to
  // the local order (or a stray property from an old cache) can never break
  // the request.
  const address = {
    name: String(source.name || '').trim().slice(0, 150),
    phone: digitsOnly(source.phone, 10),
    line1: String(source.line1 || '').trim().slice(0, 255),
    city: String(source.city || '').trim().slice(0, 100),
    state: String(source.state || '').trim().slice(0, 100),
    pincode: digitsOnly(source.pincode, 6),
  };
  const body = {
    orderId: String(order.id || ''),
    items: (order.items || []).map(orderLinePayload),
    address: Object.fromEntries(ORDER_ADDRESS_KEYS.map(key => [key, address[key]])),
    payment: {
      method: order.payment?.method === 'ONLINE' ? 'ONLINE' : 'COD',
      status: order.payment?.status === 'PAID' ? 'PAID' : 'PENDING',
      paymentId: order.payment?.paymentId || '',
      amount: Number(order.payment?.amount) || Number(order.amounts?.total) || 0,
    },
  };
  // The pin comes from the SOURCE order, not the stripped address above.
  const point = withCoordinates ? toPoint(source) : null;
  if (point) {
    body.address.latitude = point.latitude;
    body.address.longitude = point.longitude;
  }
  return body;
}

// A UUID is what the line schema requires. A catalogs line that is not one
// (a demo/mock id) cannot become a server order, and saying so is much better
// than a generic failure.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const errorMessageOf = (error) => String(error?.message || error?.data?.message || '').trim();

const looksLikeUnknownField = (error) => /not allowed|unknown|unexpected/i.test(errorMessageOf(error));

// "Retry later" vs "this will never work": a network blip, a timeout or a 5xx
// is worth queuing; a validation/auth rejection is not.
const isRetryable = (error) => {
  const status = Number(error?.status);
  return !status || status >= 500 || status === 408 || status === 429;
};

const classify = (error) => {
  const status = Number(error?.status);
  if (status === 0) return 'NETWORK';
  if (status === 401 || status === 403) return 'AUTH';
  if (status === 400 || status === 422) return 'VALIDATION';
  if (status >= 500) return 'SERVER';
  return 'UNKNOWN';
};

// Once a server has told us it does not understand the delivery pin, stop
// sending it for the rest of the session (one extra request per order, not two).
let coordinatesSupported = true;

/**
 * Register a locally-recorded order with the backend.
 *
 * Resolves to `{ ok, order, message, code, retryable }` — callers must look at
 * `ok`. Never throws. `order` is the server's own copy (mapped back) when the
 * server answered with one.
 */
export async function registerServerOrder(order) {
  if (!order?.id) {
    return { ok: false, code: 'INVALID', retryable: false, message: 'This order has no id.' };
  }
  if (!signedIn()) {
    return {
      ok: false,
      code: 'NO_SESSION',
      retryable: false,
      message: 'Sign in to your salon account so the order reaches My Naai.',
    };
  }

  const badLine = (order.items || []).find(line => !UUID_RE.test(String(line?.productId || '')));
  if (badLine) {
    return {
      ok: false,
      code: 'INVALID_ITEM',
      retryable: false,
      message: `"${badLine.name || 'A product'}" has no catalog id, so it cannot be ordered. Remove it from the cart and add it again from the shop.`,
    };
  }

  const attempt = async (withCoordinates) => api.shopOrderCreate(buildOrderPayload(order, { withCoordinates }));

  let response;
  try {
    response = await attempt(coordinatesSupported);
  } catch (error) {
    // The deployed API validates the address object strictly. A pin it does
    // not know about must never cost the salon its order: send the plain
    // address and remember that this server has no pin support.
    if (coordinatesSupported && toPoint(order.address) && looksLikeUnknownField(error)) {
      coordinatesSupported = false;
      try {
        response = await attempt(false);
      } catch (retryError) {
        return {
          ok: false,
          code: classify(retryError),
          retryable: isRetryable(retryError),
          message: errorMessageOf(retryError) || 'My Naai could not accept this order.',
        };
      }
    } else {
      return {
        ok: false,
        code: classify(error),
        retryable: isRetryable(error),
        message: errorMessageOf(error) || 'My Naai could not accept this order.',
      };
    }
  }

  const serverOrder = mapServerOrder(response?.data || {});
  return {
    ok: true,
    code: 'OK',
    retryable: false,
    message: '',
    order: serverOrder.id ? serverOrder : null,
  };
}

/* ------------------------------------------------------------------ *
 * Orders that the server has not confirmed yet
 *
 * Only a paid-but-unregistered order is ever queued (a COD order that failed
 * is simply not placed — nothing was taken, so the cart is left intact and the
 * salon tries again). The queue is a retry buffer, never the record.
 * ------------------------------------------------------------------ */

const PENDING_ORDERS_KEY = 'mynaaiShopPendingOrders';

function readPendingQueue() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(PENDING_ORDERS_KEY) : null;
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(entry => entry?.order?.id) : [];
  } catch {
    return [];
  }
}

function writePendingQueue(entries) {
  try {
    localStorage.setItem(PENDING_ORDERS_KEY, JSON.stringify(entries));
  } catch { /* storage blocked: the in-memory caller still has the order */ }
}

export function readPendingOrders() {
  return readPendingQueue();
}

export function queuePendingOrder(order) {
  if (!order?.id) return [];
  const entries = readPendingQueue().filter(entry => entry.order.id !== order.id);
  entries.push({ orderId: order.id, order, queuedAt: new Date().toISOString(), attempts: 0 });
  writePendingQueue(entries);
  return entries;
}

export function dequeuePendingOrder(orderId) {
  const entries = readPendingQueue().filter(entry => entry.order.id !== String(orderId));
  writePendingQueue(entries);
  return entries;
}

/**
 * Retry every queued order (paid orders whose registration failed, e.g. while
 * offline). Resolves to `{ synced, pending, results }`; the caller decides
 * whether to refresh the list.
 */
export async function flushPendingOrders() {
  const entries = readPendingQueue();
  if (!entries.length || !signedIn()) return { synced: [], pending: entries, results: [] };
  const synced = [];
  const stillPending = [];
  const results = [];
  for (const entry of entries) {
    const result = await registerServerOrder(entry.order);
    results.push({ orderId: entry.order.id, ...result });
    if (result.ok) synced.push({ orderId: entry.order.id, order: result.order });
    else stillPending.push({ ...entry, attempts: (Number(entry.attempts) || 0) + 1, lastError: result.message });
  }
  writePendingQueue(stillPending);
  return { synced, pending: stillPending, results };
}

// Pull the account's order history. Resolves to local-shaped orders (each
// carrying `serverStatus`) or null when there is no session / the call fails.
export async function fetchServerOrders(page = 1) {
  if (!signedIn()) return null;
  try {
    const response = await api.shopOrderList({ page });
    const orders = Array.isArray(response?.data?.orders) ? response.data.orders : [];
    return orders.map(mapServerOrder).filter(order => order.id && order.items.length);
  } catch {
    return null;
  }
}

// The whole practical history — the server pages 20 per call, a salon's
// shop orders number in the low dozens, so a few pages is the full set.
// A first-page failure means "fall back to the local copy" (null); a later
// page failure keeps whatever was fetched so far.
const SERVER_PAGE_SIZE = 20;
export async function fetchAllServerOrders(maxPages = 5) {
  if (!signedIn()) return null;
  const all = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const orders = await fetchServerOrders(page);
    if (orders === null) return page === 1 ? null : all;
    all.push(...orders);
    if (orders.length < SERVER_PAGE_SIZE) break;
  }
  return all;
}

// One order by id — the order-detail screen's single-fetch path.
export async function fetchServerOrderById(orderId) {
  if (!signedIn() || !orderId) return null;
  try {
    const response = await api.shopOrderGetById({ orderId: String(orderId) });
    const order = mapServerOrder(response?.data || {});
    return order.id ? order : null;
  } catch {
    return null;
  }
}

// Ask the server to cancel (the authoritative gate — "parcel left the
// depot" lives on the server). Resolves true only when the server accepted.
export async function cancelServerOrder(orderId, reason = '') {
  if (!signedIn() || !orderId) return false;
  try {
    await api.shopOrderCancel({ orderId: String(orderId), reason });
    return true;
  } catch {
    return false;
  }
}
