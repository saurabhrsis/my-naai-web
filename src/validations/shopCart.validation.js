const Joi = require('joi');

const productIdField = { productId: Joi.string().uuid().required() };

const addShopCartSchema = Joi.object({
  ...productIdField,
  qty: Joi.number().integer().min(1).max(99).optional().default(1)
});

const setShopCartQtySchema = Joi.object({
  ...productIdField,
  // 0 (or negative) = remove the line — same rule as the web stepper.
  qty: Joi.number().integer().min(0).max(99).required()
});

const removeShopCartSchema = Joi.object(productIdField);

module.exports = {
  addShopCartSchema,
  setShopCartQtySchema,
  removeShopCartSchema
};
