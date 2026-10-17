const Joi = require('joi');

const createDistributorSchema = Joi.object({
  name: Joi.string().required(),
  phone: Joi.string().optional().allow(null, ''),
  email: Joi.string().email().optional().allow(null, ''),
  area: Joi.string().max(200).optional().allow(null, ''),
  deliveryCapability: Joi.string().max(200).optional().allow(null, ''),
  address: Joi.string().max(2000).optional().allow(null),
  // Portal login password (plain text in the payload, stored hashed).
  password: Joi.string().min(6).max(100).optional().allow(null, ''),
  isActive: Joi.boolean().optional().default(true)
});

const updateDistributorSchema = Joi.object({
  distributorId: Joi.string().uuid().required(),
  name: Joi.string().optional(),
  phone: Joi.string().optional().allow(null, ''),
  email: Joi.string().email().optional().allow(null, ''),
  area: Joi.string().max(200).optional().allow(null, ''),
  deliveryCapability: Joi.string().max(200).optional().allow(null, ''),
  address: Joi.string().max(2000).optional().allow(null),
  // Empty string clears the password (disables portal login).
  password: Joi.string().min(6).max(100).optional().allow(null, ''),
  isActive: Joi.boolean().optional()
});

// Distributor portal login — identifier is the phone OR the email on file.
const loginDistributorSchema = Joi.object({
  identifier: Joi.string().required(),
  password: Joi.string().required()
});

module.exports = { createDistributorSchema, updateDistributorSchema, loginDistributorSchema };
