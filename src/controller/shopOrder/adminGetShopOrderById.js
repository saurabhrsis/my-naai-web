const { getShopOrderSchema } = require('../../validations/shopOrder.validation');
const shopOrderService = require('../../services/shopOrder.service');

// Company admin: fetch any salon's order by orderId (or uuid id).
const adminGetShopOrderById = async (request, response) => {
    try {
        const { orderId } = request.body || {};
        const validationResult = getShopOrderSchema.validate({ orderId }, { abortEarly: true });
        if (validationResult.error) {
            return response.status(400).json({
                status: 'FAILED',
                message: validationResult.error.details[0].message
            });
        }

        // withEvents: the complete record — who did what, when, and why
        // (rejection reasons, re-assignments, every status move).
        const order = await shopOrderService.getById(orderId, { withEvents: true });
        if (!order) {
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

module.exports = adminGetShopOrderById;
