const { getShopOrderSchema } = require('../../validations/shopOrder.validation');
const shopOrderService = require('../../services/shopOrder.service');

// A salon fetches one of its own orders by the human-facing orderId
// (the uuid id also works).
const getShopOrderById = async (request, response) => {
    try {
        const salonId = request.salon?.salonId;
        if (!salonId) {
            return response.status(400).json({
                status: 'FAILED',
                message: 'Salon Id not found in token'
            });
        }

        const { orderId } = request.body || {};
        const validationResult = getShopOrderSchema.validate({ orderId }, { abortEarly: true });
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

        return response.status(200).json({
            status: 'SUCCESS',
            message: 'Order fetched successfully',
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

module.exports = getShopOrderById;
