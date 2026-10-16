const { adminUpdateShopOrderStatusSchema } = require('../../validations/shopOrder.validation');
const shopOrderService = require('../../services/shopOrder.service');

// Company admin: move an order through the fulfilment timeline
// (PENDING -> CONFIRMED -> PROCESSING -> SHIPPED -> DELIVERED) or cancel it.
const adminUpdateShopOrderStatus = async (request, response) => {
    try {
        const { orderId, status, notes } = request.body || {};
        const validationResult = adminUpdateShopOrderStatusSchema.validate({ orderId, status, notes }, { abortEarly: true });
        if (validationResult.error) {
            return response.status(400).json({
                status: 'FAILED',
                message: validationResult.error.details[0].message
            });
        }

        const order = await shopOrderService.getById(orderId);
        if (!order) {
            return response.status(404).json({
                status: 'FAILED',
                message: 'Order not found'
            });
        }

        order.status = status;
        if (status === 'CANCELLED') {
            order.cancelledAt = new Date();
            order.cancelReason = (notes || '').trim();
            if (order.payment?.method === 'ONLINE' && order.payment?.status === 'PAID') {
                order.payment = { ...order.payment, status: 'REFUND_REQUESTED' };
            }
        }
        if (typeof notes === 'string' && notes.trim()) {
            order.notes = notes.trim();
        }
        await order.save();

        return response.status(200).json({
            status: 'SUCCESS',
            message: 'Order status updated successfully',
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

module.exports = adminUpdateShopOrderStatus;
