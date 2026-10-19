const { distributorUpdateStatusSchema } = require('../../validations/shopOrder.validation');
const shopOrderService = require('../../services/shopOrder.service');

// Distributor advances the order they are carrying through fulfilment:
// ASSIGNED -> PICKED -> SHIPPED -> DELIVERED (next step only — enforced in
// the service). The company admin may record the move on their behalf.
const distributorUpdateOrderStatus = async (request, response) => {
    try {
        const { orderId, status } = request.body || {};
        const validationResult = distributorUpdateStatusSchema.validate({ orderId, status }, { abortEarly: true });
        if (validationResult.error) {
            return response.status(400).json({ status: 'FAILED', message: validationResult.error.details[0].message });
        }

        const actor = request.distributor
            ? { actorType: 'DISTRIBUTOR', actorId: request.distributor.distributorId, actorLabel: request.distributor.name }
            : { actorType: 'ADMIN', actorId: request.admin?.id, actorLabel: request.admin?.name || 'Admin' };

        const updated = await shopOrderService.distributorUpdateStatus(orderId, status, actor, request.distributor || null);
        if (!updated) {
            return response.status(404).json({ status: 'FAILED', message: 'Order not found' });
        }
        return response.status(200).json({ status: 'SUCCESS', message: `Order marked ${String(status).toLowerCase().replace(/_/g, ' ')}`, data: updated });
    } catch (error) {
        console.log('error', error);
        const known = /can only be moved|not assigned to your distributor|must be (assigned|picked|shipped)/i.test(error.message);
        return response.status(known ? 400 : 500).json({ status: 'FAILED', message: error.message });
    }
};

module.exports = distributorUpdateOrderStatus;
