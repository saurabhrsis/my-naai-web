const { distributorOrderSchema } = require('../../validations/shopOrder.validation');
const shopOrderService = require('../../services/shopOrder.service');

// Distributor accepts the order they were requested for (or the company
// admin records the acceptance on their behalf — e.g. after a phone call).
// AWAITING_ACCEPTANCE -> ASSIGNED; the salon track moves to CONFIRMED.
const distributorAcceptOrder = async (request, response) => {
    try {
        const { orderId } = request.body || {};
        const validationResult = distributorOrderSchema.validate({ orderId }, { abortEarly: true });
        if (validationResult.error) {
            return response.status(400).json({ status: 'FAILED', message: validationResult.error.details[0].message });
        }

        const actor = request.distributor
            ? { actorType: 'DISTRIBUTOR', actorId: request.distributor.distributorId, actorLabel: request.distributor.name }
            : { actorType: 'ADMIN', actorId: request.admin?.id, actorLabel: request.admin?.name || 'Admin' };

        const updated = await shopOrderService.acceptOrder(orderId, actor, request.distributor || null);
        if (!updated) {
            return response.status(404).json({ status: 'FAILED', message: 'Order not found' });
        }
        return response.status(200).json({ status: 'SUCCESS', message: 'Order accepted', data: updated });
    } catch (error) {
        console.log('error', error);
        const known = /Only an order awaiting|not assigned to your distributor/.test(error.message);
        return response.status(known ? 400 : 500).json({ status: 'FAILED', message: error.message });
    }
};

module.exports = distributorAcceptOrder;
