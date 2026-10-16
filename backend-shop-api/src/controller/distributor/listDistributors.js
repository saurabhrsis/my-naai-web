const distributorService = require('../../services/distributor.service');

// Company admin: the delivery partners orders can be assigned to.
const listDistributors = async (request, response) => {
    try {
        const { page, searchString } = request.body || {};
        const data = await distributorService.list({ page, searchString });
        return response.status(200).json({ status: 'SUCCESS', message: 'Distributor list fetched successfully', data });
    } catch (error) {
        console.log('error', error);
        return response.status(500).json({ status: 'FAILED', message: error.message });
    }
};
module.exports = listDistributors;
