const Joi = require('joi');

// Line shape mirrors the frontend cart line (my-naai-web/src/lib/shopOrders.js
// `normalizeCartLine`) — the product snapshot as it was shown at add-to-cart.
const shopOrderLineSchema = Joi.object({
    productId: Joi.string().uuid().required(),
    name: Joi.string().max(200).required(),
    price: Joi.number().min(0).required(),
    mrp: Joi.number().min(0).optional().allow(null),
    image: Joi.string().allow(null, ''),
    category: Joi.string().max(60).allow(null, ''),
    gender: Joi.string().max(20).allow(null, ''),
    salonName: Joi.string().max(200).allow(null, ''),
    qty: Joi.number().integer().min(1).max(99).default(1)
});

// The client may send its own order id (the web shop records the order
// locally before registering it, so both ends share the id).
const createShopOrderSchema = Joi.object({
    orderId: Joi.string().max(32).optional().allow(null, ''),
    items: Joi.array().min(1).max(50).items(shopOrderLineSchema).required(),
    address: Joi.object({
        name: Joi.string().max(150).required(),
        phone: Joi.string().pattern(/^\d{10}$/).required(),
        line1: Joi.string().max(255).required(),
        city: Joi.string().max(100).required(),
        state: Joi.string().max(100).allow(null, '').optional(),
        pincode: Joi.string().pattern(/^\d{6}$/).required()
    }).required(),
    payment: Joi.object({
        method: Joi.string().valid('ONLINE', 'COD').default('COD'),
        status: Joi.string().valid('PENDING', 'PAID', 'FAILED').default('PENDING'),
        paymentId: Joi.string().allow(null, '').default(''),
        amount: Joi.number().min(0).optional()
    }).default({}),
    notes: Joi.string().max(500).allow(null, '').optional()
});

const getShopOrderSchema = Joi.object({
    orderId: Joi.string().max(64).required()
});

const cancelShopOrderSchema = Joi.object({
    orderId: Joi.string().max(64).required(),
    reason: Joi.string().max(500).allow(null, '').optional()
});

// Admin moves the INTERNAL track (fulfilment); the customer-facing status is
// derived from it. See shopOrder.service.INTERNAL_STATUSES.
const adminUpdateShopOrderStatusSchema = Joi.object({
    orderId: Joi.string().max(64).required(),
    status: Joi.string().valid('PENDING_ASSIGNMENT', 'AWAITING_ACCEPTANCE', 'ASSIGNED', 'PICKED', 'SHIPPED', 'DELIVERED', 'CANCELLED').required(),
    notes: Joi.string().max(1000).allow(null, '').optional()
});

const adminAssignDistributorSchema = Joi.object({
    orderId: Joi.string().max(64).required(),
    distributorId: Joi.string().uuid().required(),
    notes: Joi.string().max(1000).allow(null, '').optional()
});

// Distributor portal (or the admin acting on the distributor's behalf).
const distributorOrderSchema = Joi.object({
    orderId: Joi.string().max(64).required()
});

const distributorRejectOrderSchema = Joi.object({
    orderId: Joi.string().max(64).required(),
    // The reason is part of the permanent record — it must say something.
    reason: Joi.string().trim().min(3).max(500).required()
});

const distributorListOrdersSchema = Joi.object({
    page: Joi.number().integer().min(1).optional(),
    status: Joi.string().valid('PENDING_ASSIGNMENT', 'AWAITING_ACCEPTANCE', 'ASSIGNED', 'PICKED', 'SHIPPED', 'DELIVERED', 'CANCELLED').optional().allow(null, '')
});

// Distributor advances an accepted order (the service enforces the chain:
// ASSIGNED -> PICKED -> SHIPPED -> DELIVERED, next step only).
const distributorUpdateStatusSchema = Joi.object({
    orderId: Joi.string().max(64).required(),
    status: Joi.string().valid('PICKED', 'SHIPPED', 'DELIVERED').required()
});

module.exports = {
    createShopOrderSchema,
    getShopOrderSchema,
    cancelShopOrderSchema,
    adminUpdateShopOrderStatusSchema,
    adminAssignDistributorSchema,
    distributorOrderSchema,
    distributorRejectOrderSchema,
    distributorListOrdersSchema,
    distributorUpdateStatusSchema
};
