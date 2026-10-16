const shopOrderService = require('../../services/shopOrder.service');

// Company admin: every salon's orders, filterable by status / salon / orderId.
const adminListShopOrders = async (request, response) => {
    try {
        const { page, status, salonId, searchString } = request.body || {};
        const data = await shopOrderService.listForAdmin({ page, status, salonId, searchString });

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

module.exports = adminListShopOrders;
