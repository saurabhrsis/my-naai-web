const { Op } = require('sequelize');
const db = require('../database/models');
const shopOrderService = require('./shopOrder.service');

/**
 * Server-side shop cart (table `shop_carts`), keyed by the buying salon.
 *
 * The web portal and the mobile app both read and write the cart through
 * this service, so the same salon sees the same cart on every device —
 * the pre-server flow kept the cart in web localStorage and it never
 * crossed to the app.
 *
 * Only the quantity is stored per line; name/price/image are read live
 * from `shop_products` so an admin price change updates the bill.
 */

const clampQty = (value) => Math.max(1, Math.min(99, Math.round(Number(value) || 1)));

// Render the salon's cart: one row per product with the product's live
// fields. Lines whose product was deleted are dropped; lines whose product
// is unavailable are kept (flagged) so the UI can show "no longer
// available" and let the buyer remove them. Totals count available lines
// only — you cannot buy what is off the shelf.
const getCart = async (salonId) => {
  const rows = await db.ShopCart.findAll({
    where: { salonId },
    include: [{
      model: db.ShopProduct,
      as: 'product',
      where: { deletedAt: null },
      required: true,
      attributes: ['productId', 'productName', 'productImage', 'price', 'mrp', 'category', 'gender', 'isAvailable', 'description']
    }],
    order: [['createdAt', 'ASC']]
  });

  const lines = rows.map(row => ({
    productId: String(row.productId),
    name: row.product.productName,
    price: Number(row.product.price) || 0,
    mrp: Number(row.product.mrp) || 0,
    image: row.product.productImage || '',
    category: row.product.category || '',
    gender: row.product.gender || '',
    available: Boolean(row.product.isAvailable),
    qty: clampQty(row.qty)
  }));

  const buyable = lines.filter(line => line.available);
  return { lines, totals: shopOrderService.computeTotals(buyable) };
};

// The product must exist and be buyable before it can enter a cart.
const requireBuyableProduct = async (productId) => {
  const product = await db.ShopProduct.findOne({
    where: { productId, deletedAt: null, isAvailable: true }
  });
  return product;
};

// Add (or top up) a line. Returns the fresh line qty.
const addLine = async (salonId, productId, qty = 1) => {
  const product = await requireBuyableProduct(productId);
  if (!product) return null;

  const nextQty = clampQty(qty);
  const existing = await db.ShopCart.findOne({ where: { salonId, productId } });
  if (existing) {
    await existing.update({ qty: Math.min(99, existing.qty + nextQty) });
    return existing.qty;
  }
  const row = await db.ShopCart.create({ salonId, productId, qty: nextQty });
  return row.qty;
};

// Absolute set (the stepper). qty <= 0 removes the line.
const setLineQty = async (salonId, productId, qty) => {
  const next = Math.round(Number(qty) || 0);
  const existing = await db.ShopCart.findOne({ where: { salonId, productId } });
  if (next <= 0) {
    if (existing) await existing.destroy();
    return 0;
  }
  if (!existing) return null; // nothing to set
  const clamped = Math.min(99, next);
  await existing.update({ qty: clamped });
  return clamped;
};

const removeLine = async (salonId, productId) => {
  const existing = await db.ShopCart.findOne({ where: { salonId, productId } });
  if (!existing) return false;
  await existing.destroy();
  return true;
};

// Called after a successful order placement so the placed cart is not
// bought twice from another device.
const clearCart = async (salonId) => {
  await db.ShopCart.destroy({ where: { salonId } });
  return true;
};

module.exports = {
  getCart,
  addLine,
  setLineQty,
  removeLine,
  clearCart
};
