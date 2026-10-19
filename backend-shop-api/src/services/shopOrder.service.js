const { Op } = require('sequelize');
const db = require('../database/models');
const shopSettingsService = require('./shopSettings.service');
const DEFAULT_LIMIT = parseInt(process.env.PAGE_LIMIT) || 20;

/* ------------------------------------------------------------------ *\
 * Bill math — must stay in lock-step with the frontend's `cartTotals`
 * (my-naai-web/src/lib/shopOrders.js). Blinkit-style shipping: a flat
 * fee below the threshold, free above it.
 *
 * The rules come from the single-row shop_settings table (admin-managed
 * via /api/shop-settings/admin-update); the env vars are only the seed
 * defaults for a settings row that has never been written:
 *   SHOP_DELIVERY_FEE        (default 49)
 *   SHOP_FREE_DELIVERY_ABOVE (default 499)
 * ------------------------------------------------------------------ */
const DELIVERY_FEE = Math.max(0, Number(process.env.SHOP_DELIVERY_FEE) || 49);
const FREE_DELIVERY_ABOVE = Number(process.env.SHOP_FREE_DELIVERY_ABOVE) || 499;

// A raw line without qty is read as one; the bill math must never emit NaN.
const lineQty = (line) => Math.max(1, Math.min(99, Math.round(Number(line?.qty) || 1)));

const clampPercent = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(100, n);
};

// A settings value, with the env default as fallback for unset rows.
const settingsNumber = (settings, field, fallback) => {
  const n = Number(settings?.[field]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

// `method` ('COD' | 'ONLINE') decides whether the COD surcharge is added.
// The free-delivery threshold applies to the AFTER-DISCOUNT subtotal, so
// admin-managed discount and free-delivery rules compose predictably.
const computeTotals = (lines = [], settings = {}, method = 'COD') => {
  const freeAbove = settingsNumber(settings, 'freeDeliveryAbove', FREE_DELIVERY_ABOVE);
  const fee = settingsNumber(settings, 'deliveryFee', DELIVERY_FEE);
  const discountPercent = clampPercent(settings?.discountPercent);
  const codCharges = settingsNumber(settings, 'codCharges', 0);

  const itemTotal = lines.reduce((sum, line) => sum + (Number(line?.price) || 0) * lineQty(line), 0);
  const savings = lines.reduce((sum, line) => sum + Math.max(0, (Number(line?.mrp) || 0) - (Number(line?.price) || 0)) * lineQty(line), 0);
  const discount = Math.round((itemTotal * discountPercent) / 100);
  const subtotal = itemTotal - discount;
  const deliveryFee = !lines.length || subtotal >= freeAbove ? 0 : fee;
  const codFee = method === 'COD' ? codCharges : 0;
  return {
    itemCount: lines.reduce((sum, line) => sum + lineQty(line), 0),
    itemTotal,
    savings,
    discount,
    subtotal,
    deliveryFee,
    codFee,
    total: subtotal + deliveryFee + codFee,
    freeDeliveryAbove: freeAbove,
    deliveryFeeBase: fee,
    discountPercent
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
const INTERNAL_STATUSES = ['PENDING_ASSIGNMENT', 'AWAITING_ACCEPTANCE', 'ASSIGNED', 'PICKED', 'SHIPPED', 'DELIVERED', 'CANCELLED'];
const INTERNAL_TO_CUSTOMER_STATUS = {
  PENDING_ASSIGNMENT: 'PENDING',
  AWAITING_ACCEPTANCE: 'PENDING',
  ASSIGNED: 'CONFIRMED',
  PICKED: 'PROCESSING',
  SHIPPED: 'SHIPPED',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED'
};

// The customer track only moves forward (never PENDING -> CONFIRMED ->
// PENDING when a distributor is swapped or rejects) — except CANCELLED,
// which always wins. A paid order sits at CONFIRMED from placement, so a
// rejection must not drag it back to PENDING.
const CUSTOMER_STATUS_ORDER = ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'];
const nextCustomerStatus = (current, derived) => {
  if (derived === 'CANCELLED' || current === 'CANCELLED') return 'CANCELLED';
  const from = CUSTOMER_STATUS_ORDER.indexOf(current);
  const to = CUSTOMER_STATUS_ORDER.indexOf(derived);
  return to > from ? derived : current;
};

// Append an audit event. Best-effort on purpose: the state change itself is
// the source of truth and must not be rolled back because the log write
// failed — a missing row is visible in the log, a wrong order state is not.
const logEvent = (order, { actorType, actorId = null, actorLabel = null, action, fromStatus = null, toStatus = null, note = null }) => {
  return db.ShopOrderEvent.create({
    orderId: order.id,
    actorType,
    actorId: actorId == null ? null : String(actorId),
    actorLabel,
    action,
    fromStatus,
    toStatus,
    note
  }).catch((error) => {
    console.error(`[shop-order-events] failed to log ${action} for ${order.orderId}:`, error.message);
  });
};

// Rupee formatting for error messages (thousands as in India).
const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;

/**
 * Create a shop order. Amounts are always recomputed from the lines —
 * the client's `amounts` payload is ignored on purpose. A client-supplied
 * `orderId` is honoured (the web shop creates its local record first, so
 * both ends share the id); otherwise one is generated.
 *
 * The COD limit (shop_settings.codThreshold) is enforced here as well as in
 * the checkout UI — a tampered client cannot order COD above it.
 */
const createOrder = async ({ salonId, orderId, items, address, payment, notes }) => {
  const method = payment?.method === 'ONLINE' ? 'ONLINE' : 'COD';
  const settings = await shopSettingsService.getSettings();

  // The COD limit is enforced HERE, not just in the checkout UI — a tampered
  // client cannot slip past it. Judged on the item total (0 = no limit).
  const amounts = computeTotals(items, settings, method);
  if (method === 'COD' && settings.codThreshold > 0 && amounts.itemTotal > settings.codThreshold) {
    throw new Error(
      `Cash on delivery is available only for orders of ${inr(settings.codThreshold)} or less — this one is ${inr(amounts.itemTotal)}. Please pay online.`
    );
  }
  const paid = method === 'ONLINE' && payment?.status === 'PAID';

  const order = await db.ShopOrder.create({
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

  // First entries of the audit record: the order arrived on the central
  // dashboard, and (if paid) the payment is confirmed.
  const salon = await db.Salon.findByPk(salonId, { attributes: ['salonName'] });
  const actor = { actorType: 'SALON', actorId: salonId, actorLabel: salon?.salonName || 'Salon' };
  await logEvent(order, { ...actor, action: 'ORDER_PLACED', toStatus: order.status, note: method === 'ONLINE' ? 'Order placed (online payment)' : 'Order placed (cash on delivery)' });
  if (paid) {
    await logEvent(order, { ...actor, action: 'PAYMENT_CONFIRMED', toStatus: order.customerStatus });
  }
  return order;
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

const getById = async (orderIdOrId, { withEvents = false } = {}) => {
  const where = { orderId: orderIdOrId };
  if (UUID_RE.test(String(orderIdOrId))) {
    where[Op.or] = [{ orderId: orderIdOrId }, { id: orderIdOrId }];
  }
  const include = [
    { model: db.Salon, as: 'salon', attributes: ['salonId', 'salonName'] },
    { model: db.Distributor, as: 'distributor', attributes: ['distributorId', 'name', 'phone'] }
  ];
  if (withEvents) {
    include.push({
      model: db.ShopOrderEvent,
      as: 'events',
      separate: true,
      order: [['createdAt', 'ASC'], ['id', 'ASC']]
    });
  }
  return await db.ShopOrder.findOne({ where, include });
};

// The Razorpay webhook correlates a captured payment with an order by the
// payment id the client stored on the order.
const findByPaymentId = async (paymentId) => {
  return await db.ShopOrder.findOne({ where: { payment: { paymentId } } });
};

// Admin: request a delivery partner for the order (assignment and
// re-assignment both go through here). A fresh or rejected order moves
// PENDING_ASSIGNMENT -> AWAITING_ACCEPTANCE and waits for the distributor to
// accept; an order that is already moving keeps its internal status and just
// swaps the partner. Every action lands in the event record.
const assignDistributor = async (orderIdOrId, distributorId, note, actor = {}, distributor = null) => {
  const order = await getById(orderIdOrId);
  if (!order) return null;
  if (order.status === 'DELIVERED' || order.status === 'CANCELLED') {
    throw new Error(`Order can no longer be assigned (status: ${order.status})`);
  }

  const fromStatus = order.status;
  order.distributorId = distributorId;
  if (order.status === 'PENDING_ASSIGNMENT') {
    order.status = 'AWAITING_ACCEPTANCE';
  }
  order.customerStatus = nextCustomerStatus(order.customerStatus, INTERNAL_TO_CUSTOMER_STATUS[order.status]);
  if (note) order.notes = [order.notes, note].filter(Boolean).join('\n');
  await order.save();

  await logEvent(order, {
    ...actor,
    action: 'ASSIGNED',
    fromStatus,
    toStatus: order.status,
    note: [note, `Distributor requested: ${distributor?.name || distributorId}`].filter(Boolean).join(' — ')
  });
  return order;
};

// Distributor (or the admin on their behalf): accept the order they were
// requested for. AWAITING_ACCEPTANCE -> ASSIGNED; the salon track moves to
// CONFIRMED (a paid order is already there).
const acceptOrder = async (orderIdOrId, actor = {}, distributor = null) => {
  const order = await getById(orderIdOrId);
  if (!order) return null;
  if (order.status !== 'AWAITING_ACCEPTANCE') {
    throw new Error(`Only an order awaiting distributor response can be accepted (status: ${order.status})`);
  }
  if (distributor && order.distributorId !== distributor.distributorId) {
    throw new Error('This order is not assigned to your distributor account');
  }

  const fromStatus = order.status;
  order.status = 'ASSIGNED';
  order.customerStatus = nextCustomerStatus(order.customerStatus, INTERNAL_TO_CUSTOMER_STATUS.ASSIGNED);
  await order.save();

  const who = distributor ? `Distributor ${distributor.name} accepted` : (actor.label ? `${actor.label} recorded acceptance for distributor ${order.distributor?.name || order.distributorId}` : 'Order accepted by distributor');
  await logEvent(order, { ...actor, action: 'ACCEPTED', fromStatus, toStatus: order.status, note: who });
  return order;
};

// Distributor (or the admin on their behalf): reject the order, with a
// reason. The order goes back to PENDING_ASSIGNMENT for re-assignment; the
// rejection reason is recorded in the event record. A paid order keeps its
// CONFIRMED customer status — the payment was real even if this delivery
// attempt was not.
const rejectOrder = async (orderIdOrId, reason, actor = {}, distributor = null) => {
  const order = await getById(orderIdOrId);
  if (!order) return null;
  if (order.status !== 'AWAITING_ACCEPTANCE') {
    throw new Error(`Only an order awaiting distributor response can be rejected (status: ${order.status})`);
  }
  if (distributor && order.distributorId !== distributor.distributorId) {
    throw new Error('This order is not assigned to your distributor account');
  }

  const fromStatus = order.status;
  const trimmedReason = (reason || '').trim();
  order.status = 'PENDING_ASSIGNMENT';
  order.distributorId = null;
  order.customerStatus = nextCustomerStatus(order.customerStatus, INTERNAL_TO_CUSTOMER_STATUS.PENDING_ASSIGNMENT);
  await order.save();

  const who = distributor ? `Distributor ${distributor.name} rejected` : (actor.label ? `${actor.label} recorded rejection by distributor ${order.distributor?.name || order.distributorId}` : 'Order rejected by distributor');
  await logEvent(order, { ...actor, action: 'REJECTED', fromStatus, toStatus: order.status, note: `${who} — reason: ${trimmedReason}` });
  return order;
};

// Distributor (or the admin on their behalf) advances an ACCEPTED order
// through the fulfilment chain: ASSIGNED -> PICKED -> SHIPPED -> DELIVERED.
// Only the next step is allowed — no skipping, no going back, no cancelling
// (that stays the salon's or admin's call). Re-sending the current status is
// a harmless no-op so a double-tap never errors.
const DISTRIBUTOR_PROGRESSION = [
  { from: 'ASSIGNED', to: 'PICKED', label: 'picked up' },
  { from: 'PICKED', to: 'SHIPPED', label: 'shipped' },
  { from: 'SHIPPED', to: 'DELIVERED', label: 'delivered' }
];

const distributorUpdateStatus = async (orderIdOrId, nextStatus, actor = {}, distributor = null) => {
  const step = DISTRIBUTOR_PROGRESSION.find(entry => entry.to === nextStatus);
  if (!step) {
    throw new Error('This order can only be moved to PICKED, SHIPPED or DELIVERED');
  }
  const order = await getById(orderIdOrId);
  if (!order) return null;
  if (distributor && order.distributorId !== distributor.distributorId) {
    throw new Error('This order is not assigned to your distributor account');
  }
  if (order.status === step.to) return order; // idempotent re-submit

  if (order.status !== step.from) {
    throw new Error(
      `This order must be ${step.from.replace(/_/g, ' ')} before it can be marked ${nextStatus.replace(/_/g, ' ')} (current: ${order.status.replace(/_/g, ' ')})`
    );
  }

  const fromStatus = order.status;
  order.status = nextStatus;
  order.customerStatus = nextCustomerStatus(order.customerStatus, INTERNAL_TO_CUSTOMER_STATUS[nextStatus]);
  await order.save();

  const who = distributor
    ? `Distributor ${distributor.name}`
    : (actor.label ? `${actor.label} for distributor ${order.distributor?.name || order.distributorId}` : 'Distributor');
  await logEvent(order, { ...actor, action: nextStatus, fromStatus, toStatus: nextStatus, note: `${who} marked the order ${step.label}` });
  return order;
};

// Admin: move the INTERNAL track; the customer track follows the mapping
// (and never regresses — see nextCustomerStatus). DELIVERED/CANCELLED are
// terminal; anything else may move forward, backward (a parcel goes back to
// the depot) or to CANCELLED.
const updateStatus = async (orderIdOrId, nextStatus, note, actor = {}) => {
  if (!INTERNAL_STATUSES.includes(nextStatus)) {
    throw new Error(`Unknown order status: ${nextStatus}`);
  }
  const order = await getById(orderIdOrId);
  if (!order) return null;
  if ((order.status === 'DELIVERED' || order.status === 'CANCELLED') && nextStatus !== 'DELIVERED') {
    throw new Error(`Order is terminal (status: ${order.status})`);
  }

  const fromStatus = order.status;
  order.status = nextStatus;
  order.customerStatus = nextCustomerStatus(order.customerStatus, INTERNAL_TO_CUSTOMER_STATUS[nextStatus]);
  if (nextStatus === 'CANCELLED') {
    order.cancelledAt = new Date();
    if (order.payment?.method === 'ONLINE' && order.payment?.status === 'PAID') {
      order.payment = { ...order.payment, status: 'REFUND_REQUESTED' };
    }
  }
  if (note) order.notes = [order.notes, note].filter(Boolean).join('\n');
  await order.save();

  await logEvent(order, { ...actor, action: nextStatus === 'CANCELLED' ? 'CANCELLED' : 'STATUS_CHANGED', fromStatus, toStatus: nextStatus, note: note || null });
  return order;
};

// Buyer self-service cancellation — allowed while the parcel has not left
// the depot (internal: PENDING_ASSIGNMENT / AWAITING_ACCEPTANCE / ASSIGNED /
// PICKED). Both tracks go terminal; a paid online order is flagged for a
// refund.
const cancelBySalon = async (orderIdOrId, reason) => {
  const order = await getById(orderIdOrId);
  if (!order) return null;
  if (order.status === 'CANCELLED') {
    throw new Error('Order is already cancelled');
  }
  if (!['PENDING_ASSIGNMENT', 'AWAITING_ACCEPTANCE', 'ASSIGNED', 'PICKED'].includes(order.status)) {
    throw new Error(`Order can no longer be cancelled (status: ${order.status})`);
  }
  const fromStatus = order.status;
  order.status = 'CANCELLED';
  order.customerStatus = 'CANCELLED';
  order.cancelledAt = new Date();
  order.cancelReason = (reason || '').trim();
  if (order.payment?.method === 'ONLINE' && order.payment?.status === 'PAID') {
    order.payment = { ...order.payment, status: 'REFUND_REQUESTED' };
  }
  await order.save();

  await logEvent(order, { actorType: 'SALON', actorId: order.salonId, actorLabel: order.salon?.salonName || 'Salon', action: 'CANCELLED', fromStatus, toStatus: 'CANCELLED', note: order.cancelReason || 'Cancelled by salon' });
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
      { model: db.Distributor, as: 'distributor', attributes: ['distributorId', 'name', 'phone', 'area'] },
      {
        model: db.ShopOrderEvent,
        as: 'events',
        separate: true,
        order: [['createdAt', 'ASC'], ['id', 'ASC']]
      }
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

// Distributor portal: the orders currently on their plate. `status` filters
// the INTERNAL track (most useful: AWAITING_ACCEPTANCE = "respond to these").
const listForDistributor = async (distributorId, { page = 1, status } = {}) => {
  const limit = DEFAULT_LIMIT;
  const safePage = parseInt(page, 10) > 0 ? parseInt(page, 10) : 1;
  const offset = (safePage - 1) * limit;

  const where = { distributorId };
  if (status && INTERNAL_STATUSES.includes(status)) where.status = status;

  const { count: totalOrders, rows: orders } = await db.ShopOrder.findAndCountAll({
    where,
    include: [
      { model: db.Salon, as: 'salon', attributes: ['salonId', 'salonName', 'phoneNumber'] },
      {
        model: db.ShopOrderEvent,
        as: 'events',
        separate: true,
        order: [['createdAt', 'ASC'], ['id', 'ASC']]
      }
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
  acceptOrder,
  rejectOrder,
  distributorUpdateStatus,
  updateStatus,
  cancelBySalon,
  listForAdmin,
  listForDistributor
};
