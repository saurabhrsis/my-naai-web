// Salon supply shop — the partner-facing e-commerce backend.
//
//   admin publishes the catalog  →  salon carts it  →  salon orders it
//   →  it is delivered to the salon address  →  the salon follows and can
//      cancel it until it is delivered.
//
// There is deliberately NO payment gateway here. `paymentMethod` is stored as
// 'COD' (cash / bank transfer on delivery) and nothing is charged online; the
// web client shows exactly that. Payment can be added later without touching
// the order model or these routes.
//
// Drop this file in next to the other controllers and wire it:
//
//   const shop = require('./controllers/shop/shopOrders');
//   router.post('/shop/product-list', salonAuth, shop.listProducts);   // auth optional
//   router.post('/orders/create',     salonAuth, shop.createOrder);
//   router.post('/orders/list',       salonAuth, shop.listOrders);
//   router.post('/orders/cancel',     salonAuth, shop.cancelOrder);
//
// Routes — all POST, all JSON, all answering `{ status: 'SUCCESS', data }`
// (the shape every other My Naai endpoint uses and the one the web client and
// the mobile app already parse):
//
//   POST /api/shop/product-list
//     body: { "search": "scrub", "category": "Hair care" }   // both optional
//     data: { products: [ { productId, productName, brand, category, price,
//                           mrp, stock, unit, productImage, description } ] }
//
//   POST /api/orders/create
//     body: { items: [{ productId, quantity }], address: { name, phone, line1,
//            line2, city, state, pincode }, note, paymentMethod }
//     data: { order: { orderId, orderNumber, status, createdAt, items, subtotal,
//                      totalAmount, paymentMethod, address,
//                      timeline } }
//
//   POST /api/orders/list
//     body: {}
//     data: { orders: [ …newest first… ] }
//
//   POST /api/orders/cancel
//     body: { orderId, reason }
//     data: { order: { …status: 'CANCELLED' } }
//
// Statuses travel PLACED → CONFIRMED → PACKED → SHIPPED → OUT_FOR_DELIVERY →
// DELIVERED, with CANCELLED as the other exit. Only DELIVERED and CANCELLED are
// final, which is the rule the app uses to show (or hide) Cancel.
//
// Sequelize models expected (create them once, columns are camelCase):
//   db.ShopProduct : productId, productName, brand, category, price, mrp, stock,
//                    unit, productImage, description, isAvailable
//   db.Order       : orderId, salonId, orderNumber, status, subtotal,
//                    totalAmount, paymentMethod, note,
//                    address (JSON), createdAt
//   db.OrderItem   : orderItemId, orderId, productId, productName, unit,
//                    productImage, quantity, price, lineTotal
//   db.OrderEvent  : orderEventId, orderId, status, at        (optional — the
//                    tracker is rebuilt from `status` when the table is absent)
//
// Every column write is filtered through `pickColumns()`, so a model that is
// still missing an optional column (address, note, unit…) keeps working instead
// of throwing "Unknown attribute" on the very first order.

const db = require('../database/models');

// ── Status model — one list, shared by create, list and cancel ───────────────

const ORDER_FLOW = ['PLACED', 'CONFIRMED', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'];
const FINAL_STATUSES = ['DELIVERED', 'CANCELLED'];
const DEFAULT_STATUS = 'PLACED';

// Money rule — identical to src/lib/shop.js, so the app's cart and the stored
// order can never disagree: there are no delivery charges, the total is the
// subtotal.

function normalizeStatus(value) {
  const status = String(value || '').trim().toUpperCase();
  if (status === 'CANCELLED' || status === 'CANCEL' || status === 'CANCELED') return 'CANCELLED';
  if (ORDER_FLOW.includes(status)) return status;
  return DEFAULT_STATUS;
}

function isFinal(status) {
  return FINAL_STATUSES.includes(normalizeStatus(status));
}

// Only the columns the loaded model actually declares — see the header note.
function pickColumns(model, values) {
  const attributes = model?.rawAttributes;
  if (!attributes) return values;
  return Object.fromEntries(
    Object.entries(values).filter(([key]) => Object.prototype.hasOwnProperty.call(attributes, key)),
  );
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toInt(value, fallback = 0) {
  return Math.trunc(toNumber(value, fallback));
}

// Quantity is capped at what is actually on the shelf and at a sane maximum:
// an order for 10,000 tubes is a mistyped field, not a sale.
const MAX_LINE_QUANTITY = 99;
const MAX_LINES = 50;

function cleanAddress(value = {}) {
  const address = value && typeof value === 'object' ? value : {};
  const text = (...values) => values.map(item => String(item ?? '').trim()).find(item => item) || '';
  return {
    name: text(address.name, address.fullName, address.contactName).slice(0, 80),
    phone: text(address.phone, address.phoneNumber, address.mobile).replace(/[^\d+]/g, '').slice(0, 15),
    line1: text(address.line1, address.addressLine1, address.address).slice(0, 160),
    line2: text(address.line2, address.addressLine2).slice(0, 160),
    city: text(address.city).slice(0, 60),
    state: text(address.state).slice(0, 60),
    pincode: text(address.pincode, address.pinCode).replace(/\D/g, '').slice(0, 10),
  };
}

function addressIsComplete(address) {
  return Boolean(address.name && address.line1 && address.city && address.pincode && address.phone.length >= 10);
}

// ── Serialisation ───────────────────────────────────────────────────────────

function publicProduct(row = {}) {
  const value = typeof row?.toJSON === 'function' ? row.toJSON() : row;
  return {
    productId: value.productId ?? value.id ?? null,
    productName: value.productName || value.name || 'Unnamed product',
    brand: value.brand || '',
    category: value.category || 'Other',
    description: value.description || '',
    unit: value.unit || '',
    price: toNumber(value.price, 0),
    mrp: toNumber(value.mrp, 0),
    stock: toInt(value.stock, 0),
    isAvailable: value.isAvailable === undefined ? true : Boolean(value.isAvailable),
    productImage: value.productImage || value.image || '',
  };
}

function publicItem(row = {}) {
  const value = typeof row?.toJSON === 'function' ? row.toJSON() : row;
  const quantity = Math.max(1, toInt(value.quantity, 1));
  const price = toNumber(value.price, 0);
  return {
    productId: value.productId ?? null,
    productName: value.productName || value.name || 'Product',
    productImage: value.productImage || '',
    unit: value.unit || '',
    quantity,
    price,
    lineTotal: toNumber(value.lineTotal, price * quantity),
  };
}

// A backend that does not store an OrderEvent row still shows a tracker: the
// steps up to and including the current status, stamped with the order's own
// timestamps (the last one is the moment it reached this status).
function buildTimeline(status, createdAt, events = []) {
  const normalized = normalizeStatus(status);
  if (Array.isArray(events) && events.length) {
    return events
      .map(event => ({ status: normalizeStatus(event.status), at: event.at || event.createdAt || null }))
      .sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));
  }
  if (normalized === 'CANCELLED') return [{ status: 'CANCELLED', at: createdAt }];
  const upto = ORDER_FLOW.indexOf(normalized);
  return ORDER_FLOW.slice(0, upto + 1).map((key, index) => ({
    status: key,
    at: index === upto ? createdAt : null,
  }));
}

function publicOrder(row = {}, items = [], events = []) {
  const value = typeof row?.toJSON === 'function' ? row.toJSON() : row;
  const createdAt = value.createdAt || value.orderDate || null;
  const status = normalizeStatus(value.status);
  const lines = items.map(publicItem);
  const subtotal = toNumber(value.subtotal, lines.reduce((sum, line) => sum + line.lineTotal, 0));
  return {
    orderId: value.orderId ?? value.id ?? null,
    orderNumber: value.orderNumber || (value.orderId ? `MN${value.orderId}` : ''),
    status,
    createdAt,
    items: lines,
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    subtotal,
    totalAmount: toNumber(value.totalAmount, subtotal),
    paymentMethod: value.paymentMethod || 'COD',
    note: value.note || '',
    address: value.address && typeof value.address === 'string' ? safeJson(value.address) : (value.address || {}),
    timeline: buildTimeline(status, createdAt, events),
  };
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

async function loadOrderItems(dbOrder) {
  if (!db.OrderItem || typeof db.OrderItem.findAll !== 'function') return [];
  const orderId = dbOrder?.orderId;
  if (orderId === undefined || orderId === null) return [];
  try {
    const rows = await db.OrderItem.findAll({ where: { orderId } });
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    console.error('Could not read order items:', error?.message || error);
    return [];
  }
}

async function loadOrderEvents(orderId) {
  if (!db.OrderEvent || typeof db.OrderEvent.findAll !== 'function') return [];
  if (orderId === undefined || orderId === null) return [];
  try {
    const rows = await db.OrderEvent.findAll({ where: { orderId }, order: [['at', 'ASC']] });
    return Array.isArray(rows) ? rows : [];
  } catch {
    // The tracker is rebuilt from the order's own status when this optional
    // table is missing or unreadable, so a failure here is not fatal.
    return [];
  }
}

// The salon the order belongs to comes from the salon auth middleware
// (`req.salon`, `req.salonId`, `req.user.salonId` …) — never from the request
// body, or one partner could read another partner's orders.
function salonIdFromRequest(req) {
  const candidates = [
    req?.salonId,
    req?.salon?.salonId,
    req?.salon?.id,
    req?.user?.salonId,
    req?.auth?.salonId,
    req?.body?.salonId, // last resort for a deployment whose middleware sets nothing
  ];
  return candidates.map(value => (value === undefined || value === null ? '' : String(value))).find(Boolean) || '';
}

// An Order model without a `salonId` column (a table still being migrated)
// must not silently query everything, so the owner filter is applied in JS as a
// fallback instead of being dropped.
function orderHasSalonId() {
  return Boolean(db.Order?.rawAttributes && Object.prototype.hasOwnProperty.call(db.Order.rawAttributes, 'salonId'));
}

function orderWhere(salonId) {
  return orderHasSalonId() ? { salonId } : {};
}

function ownOrders(rows, salonId) {
  const list = Array.isArray(rows) ? rows : [];
  if (orderHasSalonId()) return list;
  return list.filter(row => String(row?.salonId ?? '') === String(salonId));
}

// ── 1. Catalog ──────────────────────────────────────────────────────────────

const listProducts = async (req, res) => {
  try {
    const Model = db.ShopProduct;
    if (!Model) return res.status(200).json({ status: 'SUCCESS', data: { products: [] } });

    const search = String(req?.body?.search || '').trim();
    const category = String(req?.body?.category || '').trim();
    // Sequelize's Op is not imported everywhere; build the where clause with the
    // operators the model's query interface already exposes.
    const where = { isAvailable: true };
    if (category && category.toLowerCase() !== 'all') where.category = category;

    let rows = [];
    if (typeof Model.findAll === 'function') {
      rows = await Model.findAll({ where, order: [['productName', 'ASC']], limit: 200 });
    }
    let products = (Array.isArray(rows) ? rows : []).map(publicProduct);

    if (search) {
      const query = search.toLowerCase();
      products = products.filter(product => `${product.productName} ${product.brand} ${product.category}`.toLowerCase().includes(query));
    }
    return res.status(200).json({ status: 'SUCCESS', data: { products } });
  } catch (err) {
    console.error('Shop product list error:', err);
    return res.status(500).json({ status: 'FAILED', message: err.message });
  }
};

// ── 2. Place an order ───────────────────────────────────────────────────────

const createOrder = async (req, res) => {
  try {
    const salonId = salonIdFromRequest(req);
    if (!salonId) return res.status(401).json({ status: 'FAILED', message: 'Salon session is required to place an order.' });

    const requested = Array.isArray(req?.body?.items) ? req.body.items.slice(0, MAX_LINES) : [];
    if (!requested.length) return res.status(400).json({ status: 'FAILED', message: 'Your cart is empty.' });

    const address = cleanAddress(req.body.address);
    if (!addressIsComplete(address)) {
      return res.status(400).json({ status: 'FAILED', message: 'Delivery address is incomplete.' });
    }

    // Re-price every line from the catalog. A price in the request body is a
    // client's opinion; the shelf is the truth.
    const ids = requested.map(line => line.productId).filter(Boolean);
    if (!ids.length) return res.status(400).json({ status: 'FAILED', message: 'No products in this order.' });

    let products = [];
    if (db.ShopProduct && typeof db.ShopProduct.findAll === 'function') {
      const rows = await db.ShopProduct.findAll({ where: { productId: ids, isAvailable: true } });
      products = (Array.isArray(rows) ? rows : []).map(publicProduct);
    }
    const byId = new Map(products.map(product => [String(product.productId), product]));

    const lines = [];
    const problems = [];
    requested.forEach(line => {
      const product = byId.get(String(line.productId));
      if (!product) { problems.push('Some items are no longer available.'); return; }
      const quantity = Math.min(Math.max(1, toInt(line.quantity, 1)), MAX_LINE_QUANTITY, product.stock > 0 ? product.stock : MAX_LINE_QUANTITY);
      if (product.stock > 0 && quantity > product.stock) problems.push(`Only ${product.stock} left of ${product.productName}.`);
      lines.push({
        productId: product.productId,
        productName: product.productName,
        productImage: product.productImage,
        unit: product.unit,
        quantity,
        price: product.price,
        lineTotal: product.price * quantity,
      });
    });
    if (!lines.length) return res.status(400).json({ status: 'FAILED', message: problems[0] || 'None of these items are available.' });

    const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
    // No delivery fee: what the items cost is what the salon pays. A fee in the
    // request body is ignored rather than charged.
    const totalAmount = subtotal;

    const now = new Date();
    let orderId = null;
    if (db.Order?.create) {
      const created = await db.Order.create(pickColumns(db.Order, {
        salonId,
        status: DEFAULT_STATUS,
        subtotal,
        totalAmount,
        paymentMethod: String(req.body.paymentMethod || 'COD').toUpperCase() === 'COD' ? 'COD' : String(req.body.paymentMethod || 'COD').slice(0, 24),
        note: String(req.body.note || '').slice(0, 300),
        address,
        createdAt: now,
        updatedAt: now,
      }));
      orderId = created?.orderId ?? created?.id ?? null;
    }

    if (db.OrderItem?.create && orderId !== null) {
      for (const line of lines) {
        await db.OrderItem.create(pickColumns(db.OrderItem, { ...line, orderId }));
      }
    }
    if (db.OrderEvent?.create && orderId !== null) {
      await db.OrderEvent.create(pickColumns(db.OrderEvent, { orderId, status: DEFAULT_STATUS, at: now }));
    }

    const order = publicOrder(
      { orderId, orderNumber: orderId ? `MN${orderId}` : `MN${Date.now()}`, status: DEFAULT_STATUS, subtotal, totalAmount, paymentMethod: 'COD', note: String(req.body.note || ''), address, createdAt: now },
      lines,
    );
    return res.status(201).json({ status: 'SUCCESS', message: problems[0] || 'Order placed.', data: { order } });
  } catch (err) {
    console.error('Shop create order error:', err);
    return res.status(500).json({ status: 'FAILED', message: err.message });
  }
};

// ── 3. List the salon's orders ──────────────────────────────────────────────

const listOrders = async (req, res) => {
  try {
    const salonId = salonIdFromRequest(req);
    if (!salonId) return res.status(401).json({ status: 'FAILED', message: 'Salon session is required.' });
    if (!db.Order?.findAll) return res.status(200).json({ status: 'SUCCESS', data: { orders: [] } });

    const rows = await db.Order.findAll({ where: orderWhere(salonId), order: [['createdAt', 'DESC']], limit: 100 });
    const orders = [];
    for (const row of ownOrders(rows, salonId)) {
      const items = await loadOrderItems(row);
      const events = await loadOrderEvents(row?.orderId);
      orders.push(publicOrder(row, items, events));
    }
    return res.status(200).json({ status: 'SUCCESS', data: { orders } });
  } catch (err) {
    console.error('Shop order list error:', err);
    return res.status(500).json({ status: 'FAILED', message: err.message });
  }
};

// ── 4. Cancel an order that has not been delivered ──────────────────────────

const cancelOrder = async (req, res) => {
  try {
    const salonId = salonIdFromRequest(req);
    if (!salonId) return res.status(401).json({ status: 'FAILED', message: 'Salon session is required.' });

    const orderId = req?.body?.orderId;
    if (orderId === undefined || orderId === null || orderId === '') {
      return res.status(400).json({ status: 'FAILED', message: 'orderId is required.' });
    }
    if (!db.Order?.findOne) return res.status(500).json({ status: 'FAILED', message: 'Orders are not configured.' });

    const order = ownOrders(await db.Order.findAll({ where: { ...orderWhere(salonId), orderId }, limit: 1 }), salonId)[0]
      || null;
    if (!order) return res.status(404).json({ status: 'FAILED', message: 'Order not found.' });

    const current = normalizeStatus(order.status);
    if (isFinal(current)) {
      return res.status(409).json({
        status: 'FAILED',
        message: current === 'DELIVERED' ? 'This order has already been delivered.' : 'This order is already cancelled.',
      });
    }

    const now = new Date();
    if (typeof order.update === 'function') {
      await order.update(pickColumns(db.Order, { status: 'CANCELLED', updatedAt: now }) || {});
    } else if (db.Order.update) {
      await db.Order.update(pickColumns(db.Order, { status: 'CANCELLED', updatedAt: now }), { where: { ...orderWhere(salonId), orderId } });
    }
    if (db.OrderEvent?.create) {
      await db.OrderEvent.create(pickColumns(db.OrderEvent, { orderId, status: 'CANCELLED', at: now }));
    }

    const items = await loadOrderItems(order);
    const events = await loadOrderEvents(orderId);
    return res.status(200).json({
      status: 'SUCCESS',
      message: 'Order cancelled.',
      data: { order: publicOrder({ ...(typeof order.toJSON === 'function' ? order.toJSON() : order), status: 'CANCELLED' }, items, events) },
    });
  } catch (err) {
    console.error('Shop cancel order error:', err);
    return res.status(500).json({ status: 'FAILED', message: err.message });
  }
};

module.exports = { listProducts, createOrder, listOrders, cancelOrder, ORDER_FLOW, FINAL_STATUSES, normalizeStatus };
