const { cancelShopOrderSchema } = require('../../validations/shopOrder.validation');
const shopOrderService = require('../../services/shopOrder.service');

// Buyer self-service cancellation — free until the order leaves the shop
// (PENDING / CONFIRMED). A paid online order is flagged for a refund.
const cancelShopOrder = async (request, response) => {
    try {
        const salonId = request.salon?.salonId;
        if (!salonId) {
            return response.status(400).json({
                status: 'FAILED',
                message: 'Salon Id not found in token'
            });
        }

        const { orderId, reason } = request.body || {};
        const validationResult = cancelShopOrderSchema.validate({ orderId, reason }, { abortEarly: true });
        if (validationResult.error) {
            return response.status(400).json({
                status: 'FAILED',
                message: validationResult.error.details[0].message
            });
        }

        const order = await shopOrderService.getById(orderId);
        if (!order || String(order.salonId) !== String(salonId)) {
            return response.status(404).json({
                status: 'FAILED',
                message: 'Order not found'
            });
        }

        if (order.status === 'CANCELLED') {
            return response.status(400).json({
                status: 'FAILED',
                message: 'Order is already cancelled'
            });
        }

        if (!['PENDING', 'CONFIRMED'].includes(order.status)) {
            return response.status(400).json({
                status: 'FAILED',
                message: `Order can no longer be cancelled (status: ${order.status})`
            });
        }

        order.status = 'CANCELLED';
        order.cancelledAt = new Date();
        order.cancelReason = (reason || '').trim();
        if (order.payment?.method === 'ONLINE' && order.payment?.status === 'PAID') {
            order.payment = { ...order.payment, status: 'REFUND_REQUESTED' };
        }
        await order.save();

        return response.status(200).json({
            status: 'SUCCESS',
            message: 'Order cancelled successfully',
            data: order
        });
    } catch (error) {
        console.log('error', error);
        return response.status(500).json({
            status: 'FAILED',
            message: error.message
        });
    }
};

module.exports = cancelShopOrder;
