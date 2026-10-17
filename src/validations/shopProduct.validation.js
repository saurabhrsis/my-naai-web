const Joi = require('joi');

// The shop catalog is company-owned — no salonId in any payload.
const catalogFields = {
  productImage: Joi.string().allow(null, ''),
  productName: Joi.string().required(),
  price: Joi.number().positive().required(),
  rating: Joi.number().min(0).max(5).optional().default(0),
  isAvailable: Joi.boolean().optional().default(true),
  mrp: Joi.number().min(0).optional().allow(null),
  category: Joi.string().max(60).optional().allow(null, ''),
  // '' / absent = no explicit gender (the client infers); never a default.
  gender: Joi.string().valid('MALE', 'FEMALE', 'UNISEX').optional().allow(null, ''),
  description: Joi.string().max(2000).optional().allow(null)
};

const adminCreateShopProductSchema = Joi.object({ ...catalogFields });

// Partial update — only the fields actually sent are touched.
const adminUpdateShopProductSchema = Joi.object({
  productId: Joi.string().uuid().required(),
  productImage: Joi.string().optional().allow(null, ''),
  productName: Joi.string().optional(),
  price: Joi.number().positive().optional(),
  rating: Joi.number().min(0).max(5).optional(),
  isAvailable: Joi.boolean().optional(),
  mrp: Joi.number().min(0).optional().allow(null),
  category: Joi.string().max(60).optional().allow(null, ''),
  gender: Joi.string().valid('MALE', 'FEMALE', 'UNISEX').optional().allow(null, ''),
  description: Joi.string().max(2000).optional().allow(null)
});

const adminDeleteShopProductSchema = Joi.object({
  productId: Joi.string().uuid().required()
});

module.exports = {
  adminCreateShopProductSchema,
  adminUpdateShopProductSchema,
  adminDeleteShopProductSchema
};
