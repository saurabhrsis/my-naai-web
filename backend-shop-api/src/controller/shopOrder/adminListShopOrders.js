const shopOrderService = require('../../services/shopOrder.service');

// Company admin (and, via the distributorId filter, the admin/distributor
// view): every salon's orders with BOTH status tracks and the assigned
// distributor. Filters: status (internal track), customerStatus (salon
// track), salonId, distributorId, searchString (order id), page.
const adminListShopOrders = async (request, response) => {
    try {
        const { page, status, customerStatus, salonId, distributorId, searchString } = request.body || {};
        const data = await shopOrderService.listForAdmin({ page, status, customerStatus, salonId, distributorId, searchString });

        return response.status(200).json({
            status: 'SUCCESS',
            message: 'Order list fetched successfully',
            data
        });
    } catch (error) {
        console.log('error', error);
        return response.status(500).json({ status: 'FAILED', message: error.message });
    }
};

module.exports = adminListShopOrders;
