const { createDistributorSchema } = require('../../validations/distributor.validation');
const distributorService = require('../../services/distributor.service');

// Company admin: add a delivery partner.
const createDistributor = async (request, response) => {
    try {
        const { name, phone, email, area, deliveryCapability, address, password, isActive } = request.body || {};
        const validationResult = createDistributorSchema.validate({ name, phone, email, area, deliveryCapability, address, password, isActive }, { abortEarly: true });
        if (validationResult.error) {
            return response.status(400).json({ status: 'FAILED', message: validationResult.error.details[0].message });
        }
        const value = validationResult.value;
        const result = await distributorService.create({
            name: value.name,
            phone: value.phone || null,
            email: value.email || null,
            area: value.area || null,
            deliveryCapability: value.deliveryCapability || null,
            address: value.address || null,
            password: value.password || null,
            isActive: value.isActive
        });
        return response.status(200).json({ status: 'SUCCESS', message: 'Distributor added successfully', data: result });
    } catch (error) {
        console.log('error', error);
        return response.status(500).json({ status: 'FAILED', message: error.message });
    }
};
module.exports = createDistributor;
