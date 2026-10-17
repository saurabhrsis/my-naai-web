const { cancelShopOrderSchema } = require('../../validations/shopOrder.validation');
const shopOrderService = require('../../services/shopOrder.service');
const { cleanForSalon } = require('./listShopOrders');

// Buyer self-service cancellation — free until the parcel leaves the depot.
// A paid online order is flagged for a refund.
const cancelShopOrder = async (request, response) => {
    try {
        const salonId = request.salon?.salonId;
        if (!salonId) {
            return response.status(400).json({ status: 'FAILED', message: 'Salon Id not found in token' });
        }

        const { orderId, reason } = request.body || {};
        const validationResult = cancelShopOrderSchema.validate({ orderId, reason }, { abortEarly: true });
        if (validationResult.error) {
            return response.status(400).json({ status: 'FAILED', message: validationResult.error.details[0].message });
        }

        const order = await shopOrderService.getById(orderId);
        if (!order || String(order.salonId) !== String(salonId)) {
            return response.status(404).json({ status: 'FAILED', message: 'Order not found' });
        }

        const updated = await shopOrderService.cancelBySalon(orderId, reason);
        return response.status(200).json({ status: 'SUCCESS', message: 'Order cancelled successfully', data: cleanForSalon(updated) });
    } catch (error) {
        console.log('error', error);
        const known = /already cancelled|can no longer be cancelled/.test(error.message);
        return response.status(known ? 400 : 500).json({ status: 'FAILED', message: error.message });
    }
};

module.exports = cancelShopOrder;
