const { Op } = require('sequelize');
const db = require('../database/models');
const DEFAULT_LIMIT = parseInt(process.env.PAGE_LIMIT) || 20;

/* ------------------------------------------------------------------ *
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

/**
 * Create a shop order. Amounts are always recomputed from the lines —
 * the client's `amounts` payload is ignored on purpose.
 */
const createOrder = async ({ salonId, items, address, payment, notes }) => {
  try {
    const amounts = computeTotals(items);
    const method = payment?.method === 'ONLINE' ? 'ONLINE' : 'COD';
    const paid = method === 'ONLINE' && payment?.status === 'PAID';

    const order = await db.ShopOrder.create({
      orderId: generateOrderId(),
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
      status: paid ? 'CONFIRMED' : 'PENDING',
      notes: notes || null
    });
    return order;
  } catch (error) {
    throw error;
  }
};

const listForSalon = async (salonId, page = 1) => {
  try {
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
  } catch (error) {
    console.error(error);
    throw error;
  }
};

const getById = async (orderIdOrId) => {
  try {
    return await db.ShopOrder.findOne({
      where: { [Op.or]: [{ orderId: orderIdOrId }, { id: orderIdOrId }] },
      include: [{ model: db.Salon, as: 'salon', attributes: ['salonId', 'salonName'] }]
    });
  } catch (error) {
    throw error;
  }
};

// The Razorpay webhook correlates a captured payment with an order by the
// payment id the client stored on the order.
const findByPaymentId = async (paymentId) => {
  try {
    return await db.ShopOrder.findOne({ where: { payment: { paymentId } } });
  } catch (error) {
    throw error;
  }
};

const listForAdmin = async ({ page = 1, status, salonId, searchString = '' } = {}) => {
  try {
    const limit = DEFAULT_LIMIT;
    const safePage = parseInt(page, 10) > 0 ? parseInt(page, 10) : 1;
    const offset = (safePage - 1) * limit;

    const where = {};
    if (status) where.status = status;
    if (salonId) where.salonId = salonId;
    const trimmedSearch = String(searchString || '').trim();
    if (trimmedSearch) {
      const like = `%${trimmedSearch}%`;
      where[Op.or] = [{ orderId: { [Op.iLike]: like } }];
    }

    const { count: totalOrders, rows: orders } = await db.ShopOrder.findAndCountAll({
      where,
      include: [{ model: db.Salon, as: 'salon', attributes: ['salonId', 'salonName', 'phoneNumber'] }],
      order: [['createdAt', 'DESC']],
      limit,
      offset
    });

    return {
      orders,
      pagination: { page: safePage, limit, totalOrders, totalPages: Math.ceil(totalOrders / limit) || 0 }
    };
  } catch (error) {
    console.error(error);
    throw error;
  }
};

module.exports = {
  DELIVERY_FEE,
  FREE_DELIVERY_ABOVE,
  computeTotals,
  createOrder,
  listForSalon,
  getById,
  findByPaymentId,
  listForAdmin
};
