const { Op } = require('sequelize');
const db = require('../database/models');
const DEFAULT_LIMIT = parseInt(process.env.PAGE_LIMIT) || 20;

/* ------------------------------------------------------------------ *\
 * Bill math — must stay in lock-step with the frontend's `cartTotals`
 * (my-naai-web/src/lib/shopOrders.js). Blinkit-style shipping: a flat
 * fee below the threshold, free above it. Env overrides:
 *   SHOP_DELIVERY_FEE        (default 49)
 *   SHOP_FREE_DELIVERY_ABOVE (default 499)
 * ------------------------------------------------------------------ */
const DELIVERY_FEE = Math.max(0, Number(process.env.SHOP_DELIVERY_FEE) || 49);
const FREE_DELIVERY_ABOVE = Number(process.env.SHOP_FREE_DELIVERY_ABOVE) || 499;

// A raw line without qty is read as one; the bill math must never emit NaN.
const lineQty = (line) => Math.max(1, Math.min(99, Math.round(Number(line?.qty) || 1)));

const computeTotals = (lines = []) => {
  const itemTotal = lines.reduce((sum, line) => sum + (Number(line?.price) || 0) * lineQty(line), 0);
  const savings = lines.reduce((sum, line) => sum + Math.max(0, (Number(line?.mrp) || 0) - (Number(line?.price) || 0)) * lineQty(line), 0);
  const deliveryFee = !lines.length || itemTotal >= FREE_DELIVERY_ABOVE ? 0 : DELIVERY_FEE;
  return {
    itemCount: lines.reduce((sum, line) => sum + lineQty(line), 0),
    itemTotal,
    savings,
    deliveryFee,
    total: itemTotal + deliveryFee,
    freeDeliveryAbove: FREE_DELIVERY_ABOVE
  };
};

// Same id format the frontend generates ('MN' + base36 time + 4 chars) so an
// order placed through the API looks like one placed through the web shop.
const ORDER_ID_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const generateOrderId = () => {
  let suffix = '';
  for (let i = 0; i < 4; i += 1) {
    suffix += ORDER_ID_CHARS[Math.floor(Math.random() * ORDER_ID_CHARS.length)];
  }
  return `MN${Date.now().toString(36).toUpperCase()}${suffix}`;
};

/* ------------------------------------------------------------------ *\
 * Two status tracks. The INTERNAL track drives fulfilment (who has the
 * parcel); the CUSTOMER track is what the buying salon sees, derived from
 * the internal one — the salon never sees warehouse internals.
 * ------------------------------------------------------------------ */
const INTERNAL_STATUSES = ['PENDING_ASSIGNMENT', 'ASSIGNED', 'PICKED', 'SHIPPED', 'DELIVERED', 'CANCELLED'];
const INTERNAL_TO_CUSTOMER_STATUS = {
  PENDING_ASSIGNMENT: 'PENDING',
  ASSIGNED: 'CONFIRMED',
  PICKED: 'PROCESSING',
  SHIPPED: 'SHIPPED',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED'
};

/**
 * Create a shop order. Amounts are always recomputed from the lines —
 * the client's `amounts` payload is ignored on purpose. A client-supplied
 * `orderId` is honoured (the web shop creates its local record first, so
 * both ends share the id); otherwise one is generated.
 */
const createOrder = async ({ salonId, orderId, items, address, payment, notes }) => {
  const amounts = computeTotals(items);
  const method = payment?.method === 'ONLINE' ? 'ONLINE' : 'COD';
  const paid = method === 'ONLINE' && payment?.status === 'PAID';

  return await db.ShopOrder.create({
    orderId: orderId || generateOrderId(),
    salonId,
    items,
    address,
    payment: {
      method,
      status: paid ? 'PAID' : 'PENDING',
      paymentId: payment?.paymentId || '',
      amount: amounts.total
    },
    amounts,
    // Every order starts waiting for a delivery partner; a paid order is
    // already confirmed on the customer side.
    status: 'PENDING_ASSIGNMENT',
    customerStatus: paid ? 'CONFIRMED' : 'PENDING',
    notes: notes || null
  });
};

const listForSalon = async (salonId, page = 1) => {
  const limit = DEFAULT_LIMIT;
  const safePage = parseInt(page, 10) > 0 ? parseInt(page, 10) : 1;
  const offset = (safePage - 1) * limit;

  const { count: totalOrders, rows: orders } = await db.ShopOrder.findAndCountAll({
    where: { salonId },
    include: [{ model: db.Salon, as: 'salon', attributes: ['salonId', 'salonName'] }],
    order: [['createdAt', 'DESC']],
    limit,
    offset
  });

  return {
    orders,
    pagination: { page: safePage, limit, totalOrders, totalPages: Math.ceil(totalOrders / limit) || 0 }
  };
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const getById = async (orderIdOrId) => {
  const where = { orderId: orderIdOrId };
  if (UUID_RE.test(String(orderIdOrId))) {
    where[Op.or] = [{ orderId: orderIdOrId }, { id: orderIdOrId }];
  }
  return await db.ShopOrder.findOne({
    where,
    include: [
      { model: db.Salon, as: 'salon', attributes: ['salonId', 'salonName'] },
      { model: db.Distributor, as: 'distributor', attributes: ['distributorId', 'name', 'phone'] }
    ]
  });
};

// The Razorpay webhook correlates a captured payment with an order by the
// payment id the client stored on the order.
const findByPaymentId = async (paymentId) => {
  return await db.ShopOrder.findOne({ where: { payment: { paymentId } } });
};

// Admin: hand the order to a delivery partner. Moves a brand-new order from
// PENDING_ASSIGNMENT to ASSIGNED (customer: CONFIRMED). Re-assignment of an
// already-moving order is allowed (drops the internal status back to
// ASSIGNED only when it had not moved past it).
const assignDistributor = async (orderIdOrId, distributorId, note) => {
  const order = await getById(orderIdOrId);
  if (!order) return null;
  if (order.status === 'DELIVERED' || order.status === 'CANCELLED') {
    throw new Error(`Order can no longer be assigned (status: ${order.status})`);
  }

  order.distributorId = distributorId;
  if (order.status === 'PENDING_ASSIGNMENT') {
    order.status = 'ASSIGNED';
    order.customerStatus = INTERNAL_TO_CUSTOMER_STATUS.ASSIGNED;
  }
  if (note) order.notes = [order.notes, note].filter(Boolean).join('\n');
  await order.save();
  return order;
};

// Admin: move the INTERNAL track; the customer track follows the mapping.
// DELIVERED/CANCELLED are terminal; anything else may move forward, backward
// (a parcel goes back to the depot) or to CANCELLED.
const updateStatus = async (orderIdOrId, nextStatus, note) => {
  if (!INTERNAL_STATUSES.includes(nextStatus)) {
    throw new Error(`Unknown order status: ${nextStatus}`);
  }
  const order = await getById(orderIdOrId);
  if (!order) return null;
  if ((order.status === 'DELIVERED' || order.status === 'CANCELLED') && nextStatus !== 'DELIVERED') {
    throw new Error(`Order is terminal (status: ${order.status})`);
  }

  order.status = nextStatus;
  order.customerStatus = INTERNAL_TO_CUSTOMER_STATUS[nextStatus];
  if (nextStatus === 'CANCELLED') {
    order.cancelledAt = new Date();
    if (order.payment?.method === 'ONLINE' && order.payment?.status === 'PAID') {
      order.payment = { ...order.payment, status: 'REFUND_REQUESTED' };
    }
  }
  if (note) order.notes = [order.notes, note].filter(Boolean).join('\n');
  await order.save();
  return order;
};

// Buyer self-service cancellation — allowed while the parcel has not left
// the depot (internal: PENDING_ASSIGNMENT / ASSIGNED / PICKED). Both tracks
// go terminal; a paid online order is flagged for a refund.
const cancelBySalon = async (orderIdOrId, reason) => {
  const order = await getById(orderIdOrId);
  if (!order) return null;
  if (order.status === 'CANCELLED') {
    throw new Error('Order is already cancelled');
  }
  if (!['PENDING_ASSIGNMENT', 'ASSIGNED', 'PICKED'].includes(order.status)) {
    throw new Error(`Order can no longer be cancelled (status: ${order.status})`);
  }
  order.status = 'CANCELLED';
  order.customerStatus = 'CANCELLED';
  order.cancelledAt = new Date();
  order.cancelReason = (reason || '').trim();
  if (order.payment?.method === 'ONLINE' && order.payment?.status === 'PAID') {
    order.payment = { ...order.payment, status: 'REFUND_REQUESTED' };
  }
  await order.save();
  return order;
};

// Company admin: every salon's orders. Filters: status (INTERNAL track),
// customerStatus, salonId, distributorId (the admin/distributor view),
// searchString (order id).
const listForAdmin = async ({ page = 1, status, customerStatus, salonId, distributorId, searchString = '' } = {}) => {
  const limit = DEFAULT_LIMIT;
  const safePage = parseInt(page, 10) > 0 ? parseInt(page, 10) : 1;
  const offset = (safePage - 1) * limit;

  const where = {};
  if (status && INTERNAL_STATUSES.includes(status)) where.status = status;
  if (customerStatus) where.customerStatus = customerStatus;
  if (salonId) where.salonId = salonId;
  if (distributorId) where.distributorId = distributorId;
  const trimmedSearch = String(searchString || '').trim();
  if (trimmedSearch) {
    where[Op.or] = [{ orderId: { [Op.iLike]: `%${trimmedSearch}%` } }];
  }

  const { count: totalOrders, rows: orders } = await db.ShopOrder.findAndCountAll({
    where,
    include: [
      { model: db.Salon, as: 'salon', attributes: ['salonId', 'salonName', 'phoneNumber'] },
      { model: db.Distributor, as: 'distributor', attributes: ['distributorId', 'name', 'phone', 'area'] }
    ],
    order: [['createdAt', 'DESC']],
    limit,
    offset
  });

  return {
    orders,
    pagination: { page: safePage, limit, totalOrders, totalPages: Math.ceil(totalOrders / limit) || 0 }
  };
};

module.exports = {
  DELIVERY_FEE,
  FREE_DELIVERY_ABOVE,
  computeTotals,
  INTERNAL_STATUSES,
  INTERNAL_TO_CUSTOMER_STATUS,
  createOrder,
  listForSalon,
  getById,
  findByPaymentId,
  assignDistributor,
  updateStatus,
  cancelBySalon,
  listForAdmin
};
