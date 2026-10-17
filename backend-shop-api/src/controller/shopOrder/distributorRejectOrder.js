const { distributorRejectOrderSchema } = require('../../validations/shopOrder.validation');
const shopOrderService = require('../../services/shopOrder.service');

// Distributor rejects the order with a reason (or the admin records it on
// their behalf). The order goes back to PENDING_ASSIGNMENT for
// re-assignment; the reason is stored in the order's event record.
const distributorRejectOrder = async (request, response) => {
    try {
        const { orderId, reason } = request.body || {};
        const validationResult = distributorRejectOrderSchema.validate({ orderId, reason }, { abortEarly: true });
        if (validationResult.error) {
            return response.status(400).json({ status: 'FAILED', message: validationResult.error.details[0].message });
        }

        const actor = request.distributor
            ? { actorType: 'DISTRIBUTOR', actorId: request.distributor.distributorId, actorLabel: request.distributor.name }
            : { actorType: 'ADMIN', actorId: request.admin?.id, actorLabel: request.admin?.name || 'Admin' };

        const updated = await shopOrderService.rejectOrder(orderId, reason, actor, request.distributor || null);
        if (!updated) {
            return response.status(404).json({ status: 'FAILED', message: 'Order not found' });
        }
        return response.status(200).json({ status: 'SUCCESS', message: 'Order rejected — waiting for re-assignment', data: updated });
    } catch (error) {
        console.log('error', error);
        const known = /Only an order awaiting|not assigned to your distributor/.test(error.message);
        return response.status(known ? 400 : 500).json({ status: 'FAILED', message: error.message });
    }
};

module.exports = distributorRejectOrder;
