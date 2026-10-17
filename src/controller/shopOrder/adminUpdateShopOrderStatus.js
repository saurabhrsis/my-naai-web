const { adminUpdateShopOrderStatusSchema } = require('../../validations/shopOrder.validation');
const shopOrderService = require('../../services/shopOrder.service');

// Company admin: move the INTERNAL fulfilment track (PENDING_ASSIGNMENT ->
// ASSIGNED -> PICKED -> SHIPPED -> DELIVERED) or cancel. The salon-facing
// status is derived from it, so the customer view stays in sync on its own.
const adminUpdateShopOrderStatus = async (request, response) => {
    try {
        const { orderId, status, notes } = request.body || {};
        const validationResult = adminUpdateShopOrderStatusSchema.validate({ orderId, status, notes }, { abortEarly: true });
        if (validationResult.error) {
            return response.status(400).json({ status: 'FAILED', message: validationResult.error.details[0].message });
        }

        const order = await shopOrderService.getById(orderId);
        if (!order) {
            return response.status(404).json({ status: 'FAILED', message: 'Order not found' });
        }

        const actor = {
            actorType: 'ADMIN',
            actorId: request.admin?.id,
            actorLabel: request.admin?.name || 'Admin'
        };
        const updated = await shopOrderService.updateStatus(orderId, status, notes || null, actor);
        return response.status(200).json({ status: 'SUCCESS', message: 'Order status updated successfully', data: updated });
    } catch (error) {
        console.log('error', error);
        const known = /terminal|Unknown order status/.test(error.message);
        return response.status(known ? 400 : 500).json({ status: 'FAILED', message: error.message });
    }
};

module.exports = adminUpdateShopOrderStatus;
