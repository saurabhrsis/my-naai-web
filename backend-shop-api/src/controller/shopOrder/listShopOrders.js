const shopOrderService = require('../../services/shopOrder.service');

// The buying salon lists its own orders, newest first.
const listShopOrders = async (request, response) => {
    try {
        const salonId = request.salon?.salonId;
        if (!salonId) {
            return response.status(400).json({
                status: 'FAILED',
                message: 'Salon Id not found in token'
            });
        }

        const { page } = request.body || {};
        const data = await shopOrderService.listForSalon(salonId, page);

        if (!data.orders || data.orders.length === 0) {
            return response.status(200).json({
                status: 'FAILED',
                message: 'No orders found',
                data
            });
        }

        return response.status(200).json({
            status: 'SUCCESS',
            message: 'Order list fetched successfully',
            data
        });
    } catch (error) {
        console.log('error', error);
        return response.status(500).json({
            status: 'FAILED',
            message: error.message
        });
    }
};

module.exports = listShopOrders;
