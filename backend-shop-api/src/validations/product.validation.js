const Joi = require('joi');
const addProductSchema = Joi.object({
    productImage: Joi.string().required(),
    productName: Joi.string().required(),
    price: Joi.number().positive().required(),
    rating: Joi.number().min(0).max(5).required(),
    isAvailable: Joi.boolean().required()
});

const updateProductSchema = Joi.object({
    productId: Joi.string().uuid().required(),
    productImage: Joi.string().optional(),
    productName: Joi.string().optional(),
    price: Joi.number().positive().optional(),
    rating: Joi.number().min(0).max(5).optional(),
    isAvailable: Joi.boolean().optional()
});
const deleteProductSchema = Joi.object({
    productId: Joi.string().uuid().required()
});
module.exports = { 
    addProductSchema,
    updateProductSchema,
    deleteProductSchema
 }
