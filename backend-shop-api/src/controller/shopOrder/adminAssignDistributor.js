const { adminAssignDistributorSchema } = require('../../validations/shopOrder.validation');
const shopOrderService = require('../../services/shopOrder.service');
const distributorService = require('../../services/distributor.service');

// Company admin: hand an order to a delivery partner. A brand-new order
// moves to ASSIGNED (salon sees CONFIRMED); re-assignment swaps the partner.
const adminAssignDistributor = async (request, response) => {
    try {
        const { orderId, distributorId, notes } = request.body || {};
        const validationResult = adminAssignDistributorSchema.validate({ orderId, distributorId, notes }, { abortEarly: true });
        if (validationResult.error) {
            return response.status(400).json({ status: 'FAILED', message: validationResult.error.details[0].message });
        }

        const distributor = await distributorService.getById(distributorId);
        if (!distributor || !distributor.isActive) {
            return response.status(404).json({ status: 'FAILED', message: 'Distributor not found or inactive' });
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
        const updated = await shopOrderService.assignDistributor(orderId, distributorId, notes || null, actor, distributor);
        return response.status(200).json({
            status: 'SUCCESS',
            message: 'Distributor assigned — awaiting their acceptance',
            data: updated
        });
    } catch (error) {
        console.log('error', error);
        const known = /can no longer be assigned/.test(error.message);
        return response.status(known ? 400 : 500).json({ status: 'FAILED', message: error.message });
    }
};

module.exports = adminAssignDistributor;
