const Joi = require('joi');

// Shop-only product fields. `mrp` drives the "% off" badge (0/blank = no
// discount), `category`/`gender` skip the frontend's name-based inference when
// present, `description` feeds the product detail view. All optional so the
// existing (pre-shop) product create/update payloads keep working unchanged.
const shopFieldsSchema = {
    mrp: Joi.number().min(0).optional().allow(null),
    category: Joi.string().max(60).optional().allow(null, ''),
    gender: Joi.string().valid('MALE', 'FEMALE', 'UNISEX').optional().allow(null, ''),
    description: Joi.string().max(2000).optional().allow(null)
};

const addProductSchema = Joi.object({
    productImage: Joi.string().required(),
    productName: Joi.string().required(),
    price: Joi.number().positive().required(),
    rating: Joi.number().min(0).max(5).required(),
    isAvailable: Joi.boolean().required(),
    ...shopFieldsSchema
});

const updateProductSchema = Joi.object({
    productId: Joi.string().uuid().required(),
    productImage: Joi.string().optional(),
    productName: Joi.string().optional(),
    price: Joi.number().positive().optional(),
    rating: Joi.number().min(0).max(5).optional(),
    isAvailable: Joi.boolean().optional(),
    ...shopFieldsSchema
});
const deleteProductSchema = Joi.object({
    productId: Joi.string().uuid().required()
});

// Admin product management — salonId is explicit (the admin token carries no
// salon), image is optional, rating/isAvailable default like a fresh product.
const adminCreateProductSchema = Joi.object({
    salonId: Joi.string().uuid().required(),
    productImage: Joi.string().allow(null, ''),
    productName: Joi.string().required(),
    price: Joi.number().positive().required(),
    rating: Joi.number().min(0).max(5).optional().default(0),
    isAvailable: Joi.boolean().optional().default(true),
    ...shopFieldsSchema
});

// Partial update — only the fields actually sent are touched.
const adminUpdateProductSchema = Joi.object({
    productId: Joi.string().uuid().required(),
    productImage: Joi.string().optional().allow(null, ''),
    productName: Joi.string().optional(),
    price: Joi.number().positive().optional(),
    rating: Joi.number().min(0).max(5).optional(),
    isAvailable: Joi.boolean().optional(),
    ...shopFieldsSchema
});

module.exports = {
    addProductSchema,
    updateProductSchema,
    deleteProductSchema,
    adminCreateProductSchema,
    adminUpdateProductSchema
 }
