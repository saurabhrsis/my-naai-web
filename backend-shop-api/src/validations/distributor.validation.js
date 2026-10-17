const Joi = require('joi');

const createDistributorSchema = Joi.object({
  name: Joi.string().required(),
  phone: Joi.string().optional().allow(null, ''),
  email: Joi.string().email().optional().allow(null, ''),
  area: Joi.string().max(200).optional().allow(null, ''),
  address: Joi.string().max(2000).optional().allow(null),
  isActive: Joi.boolean().optional().default(true)
});

const updateDistributorSchema = Joi.object({
  distributorId: Joi.string().uuid().required(),
  name: Joi.string().optional(),
  phone: Joi.string().optional().allow(null, ''),
  email: Joi.string().email().optional().allow(null, ''),
  area: Joi.string().max(200).optional().allow(null, ''),
  address: Joi.string().max(2000).optional().allow(null),
  isActive: Joi.boolean().optional()
});

module.exports = { createDistributorSchema, updateDistributorSchema };
