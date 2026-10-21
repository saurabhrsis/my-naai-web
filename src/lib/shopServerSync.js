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
 * ------------------------------------------------------------------ */

// Register the order the client just placed (same id) so it becomes part of
// the account's server-side history. Resolves true on success; a failure
// leaves the local record (still visible) and does not re-open the cart.
export async function registerServerOrder(order) {
  if (!signedIn() || !order?.id) return false;
  try {
    await api.shopOrderCreate({
      orderId: order.id,
      items: order.items,
      // Coordinates ride along with the address so an order placed from a
      // salon whose profile predates the coordinate requirement still lands
      // on the admin's map. The server prefers the salon's own record.
      address: order.address,
      payment: {
        method: order.payment?.method === 'COD' ? 'COD' : 'ONLINE',
        status: order.payment?.status === 'PAID' ? 'PAID' : 'PENDING',
        paymentId: order.payment?.paymentId || '',
        amount: Number(order.payment?.amount) || Number(order.amounts?.total) || 0,
      },
    });
    return true;
  } catch {
    return false;
  }
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
