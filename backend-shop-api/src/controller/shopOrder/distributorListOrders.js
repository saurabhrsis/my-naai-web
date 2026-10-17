const { distributorListOrdersSchema } = require('../../validations/shopOrder.validation');
const shopOrderService = require('../../services/shopOrder.service');

// Distributor portal: the orders currently assigned to this distributor.
// `status` filters the INTERNAL track — AWAITING_ACCEPTANCE is the
// "respond to these" queue. (Company admins use /admin-list instead.)
const distributorListOrders = async (request, response) => {
    try {
        if (!request.distributor) {
            return response.status(403).json({ status: 'FAILED', message: 'Distributor token required — admins use admin-list' });
        }
        const { page, status } = request.body || {};
        const validationResult = distributorListOrdersSchema.validate({ page, status }, { abortEarly: true });
        if (validationResult.error) {
            return response.status(400).json({ status: 'FAILED', message: validationResult.error.details[0].message });
        }

        const result = await shopOrderService.listForDistributor(request.distributor.distributorId, {
            page: validationResult.value.page || 1,
            status: validationResult.value.status || undefined
        });
        return response.status(200).json({ status: 'SUCCESS', message: 'Orders fetched successfully', data: result });
    } catch (error) {
        console.log('error', error);
        return response.status(500).json({ status: 'FAILED', message: error.message });
    }
};

module.exports = distributorListOrders;
