const { Op } = require('sequelize');
const db = require('../database/models');
const DEFAULT_LIMIT = parseInt(process.env.PAGE_LIMIT) || 20;

/**
 * Shop catalog service — the company's products that SALONS purchase
 * (table `shop_products`, separate from the salons' customer-facing
 * `products`). The catalog is company-wide: there is no salon scoping.
 */

// The buying side (salon app/web, or a mobile user) browses the catalog.
// Filters stay coarse on purpose — the shop UI does its own chip/price
// filtering client-side; the server serves the shelf.
const listCatalog = async ({ page = 1, searchString = '' } = {}) => {
  const limit = DEFAULT_LIMIT;
  const safePage = parseInt(page, 10) > 0 ? parseInt(page, 10) : 1;
  const offset = (safePage - 1) * limit;

  const where = { deletedAt: null };
  const trimmedSearch = String(searchString || '').trim();
  if (trimmedSearch) {
    where[Op.and] = [{ productName: { [Op.iLike]: `%${trimmedSearch}%` } }];
  }

  const { count: totalProducts, rows: products } = await db.ShopProduct.findAndCountAll({
    where,
    order: [['createdAt', 'DESC']],
    limit,
    offset
  });

  return {
    products,
    pagination: { page: safePage, limit, totalProducts, totalPages: Math.ceil(totalProducts / limit) || 0 }
  };
};

const getById = async (productId) => {
  return await db.ShopProduct.findOne({ where: { productId, deletedAt: null } });
};

// Admin create — the company adds to its own catalog (no salonId involved).
const create = async (dataToInsert) => {
  return await db.ShopProduct.create(dataToInsert);
};

// Admin partial update — only the fields actually sent are touched.
const update = async (productId, dataToUpdate) => {
  const product = await db.ShopProduct.findOne({ where: { productId, deletedAt: null } });
  if (!product) return null;
  await product.update(dataToUpdate);
  return product;
};

// Admin soft delete — cart lines and placed orders keep their snapshots, so
// history never dangles.
const softDelete = async (productId) => {
  const product = await db.ShopProduct.findOne({ where: { productId, deletedAt: null } });
  if (!product) return null;
  await product.update({ deletedAt: new Date() });
  return product;
};

module.exports = {
  listCatalog,
  getById,
  create,
  update,
  softDelete
};
