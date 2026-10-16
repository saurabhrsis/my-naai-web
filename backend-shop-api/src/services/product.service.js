const { Op } = require('sequelize');
const db = require('../database/models');
const DEFAULT_LIMIT = parseInt(process.env.PAGE_LIMIT) || 20;

/**
 * Add a new product
 */
const createProduct = async (productData) => {
  try {
    const product = await db.Product.create(productData);
    return product;
  } catch (error) {
    throw error;
  }
};

/**
 * Get product by ID
 */
const getProductById = async (productId) => {
  try {
    const product = await db.Product.findByPk(productId);
    return product;
  } catch (error) {
    throw error;
  }
};

/**
 * Update product
 */
const updateProduct = async (productId, salonId, updateData) => {
  try {
    const product = await db.Product.findOne({
      where: {
        productId,
        salonId
      }
    });

    if (!product) {
      return null;
    }

    await product.update(updateData);
    return product;
  } catch (error) {
    throw error;
  }
};

/**
 * Update product in ANY salon's catalog (admin routes only — the
 * salon-scoped updateProduct above always filters by the caller's salon).
 */
const updateProductAny = async (productId, updateData) => {
  try {
    const product = await db.Product.findByPk(productId);

    if (!product) {
      return null;
    }

    await product.update(updateData);
    return product;
  } catch (error) {
    throw error;
  }
};

/**
 * Delete product
 */
const deleteProduct = async (productId) => {
  try {
    const product = await db.Product.findByPk(productId);
    if (!product) {
      return null;
    }

    // Soft delete: isDeleted = true
    await product.destroy();
    return true;
  } catch (error) {
    throw error;
  }
};

/**
 * List products with pagination & search
 */

const listProducts = async ({salonId, page = 1, searchString = '' }) => {
  try {
    const limit = DEFAULT_LIMIT;
    const safePage = parseInt(page, 10) > 0 ? parseInt(page, 10) : 1;
    const offset = (safePage - 1) * limit;

    const where = { salonId: salonId};

    if ((searchString = (searchString?.trim()))) {
      const like = `%${searchString}%`;
      where[Op.or] = [
        { productName: { [Op.iLike]: like } }
      ];
    }

    const { count: totalProducts, rows: products } = await db.Product.findAndCountAll({
      where,
      attributes: [
        'productId',
        'productName',
        'productImage',
        'price',
        'mrp',
        'category',
        'gender',
        'description',
        'rating',
        'isAvailable',
        'stockStatus'
      ],
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });

    const totalPages = Math.ceil(totalProducts / limit) || 0;

    const result = {
      products,
      pagination: {
        page: safePage,
        limit,
        totalProducts,
        totalPages,
      },
    };
    return result;
  } catch (error) {
    console.error(error);
    throw error;
  }
};

/**
 * All Salons products List with pagination & search
 */

const allSalonsProductsList = async ({ page = 1, searchString = '' }) => {
  try {
    const limit = DEFAULT_LIMIT;
    const safePage = parseInt(page, 10) > 0 ? parseInt(page, 10) : 1;
    const offset = (safePage - 1) * limit;

    const where = {
      isAvailable: true
    };
    const trimmedSearch = searchString?.trim();
    if (trimmedSearch) {
      const like = `%${trimmedSearch}%`;
      where[Op.or] = [
        { productName: { [Op.iLike]: like } },
         { '$salon.salon_name$': { [Op.iLike]: like} }
      ];
    }

    const { count: totalProducts, rows: products } = await db.Product.findAndCountAll({
      where,
      attributes: [
        'productId',
        'productImage',
        'productName',
        'price',
        'mrp',
        'category',
        'gender',
        'description',
        'rating',
        'isAvailable',
        'stockStatus'
      ],
      include: [
        {
          model: db.Salon,
          as: 'salon',
          // genderType lets the shop fall back to the SELLING salon's type
          // for products with no explicit gender (legacy salon products).
          attributes: ['salonId', 'salonName', 'genderType']
        }
      ],
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });

    const totalPages = Math.ceil(totalProducts / limit) || 1;

    const result = {
      products,
      pagination: {
        page: safePage,
        limit,
        totalProducts,
        totalPages,
      },
    };
    return result;
  } catch (error) {
    console.error(error);
    throw error;
  }
};


/**
 * Admin: products across every salon, newest first.
 * Filters: salonId, isAvailable (boolean), searchString (product name or
 * salon name).
 */
const adminListProducts = async ({ page = 1, salonId, isAvailable, searchString = '' } = {}) => {
  try {
    const limit = DEFAULT_LIMIT;
    const safePage = parseInt(page, 10) > 0 ? parseInt(page, 10) : 1;
    const offset = (safePage - 1) * limit;

    const where = {};
    if (salonId) where.salonId = salonId;
    if (typeof isAvailable === 'boolean') where.isAvailable = isAvailable;

    const trimmedSearch = searchString?.trim();
    if (trimmedSearch) {
      const like = `%${trimmedSearch}%`;
      where[Op.or] = [
        { productName: { [Op.iLike]: like } },
        { '$salon.salon_name$': { [Op.iLike]: like } }
      ];
    }

    const { count: totalProducts, rows: products } = await db.Product.findAndCountAll({
      where,
      attributes: [
        'productId',
        'productName',
        'productImage',
        'price',
        'mrp',
        'category',
        'gender',
        'description',
        'rating',
        'isAvailable',
        'stockStatus'
      ],
      include: [
        {
          model: db.Salon,
          as: 'salon',
          attributes: ['salonId', 'salonName', 'genderType']
        }
      ],
      order: [['createdAt', 'DESC']],
      limit,
      offset
    });

    const totalPages = Math.ceil(totalProducts / limit) || 0;

    return {
      products,
      pagination: {
        page: safePage,
        limit,
        totalProducts,
        totalPages
      }
    };
  } catch (error) {
    console.error(error);
    throw error;
  }
};

module.exports = {
  createProduct,
  getProductById,
  updateProduct,
  updateProductAny,
  deleteProduct,
  listProducts,
  allSalonsProductsList,
  adminListProducts
};
