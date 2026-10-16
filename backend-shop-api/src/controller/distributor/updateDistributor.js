const { updateDistributorSchema } = require('../../validations/distributor.validation');
const distributorService = require('../../services/distributor.service');

// Company admin: partially update a delivery partner.
const updateDistributor = async (request, response) => {
    try {
        const { distributorId, name, phone, email, area, address, isActive } = request.body || {};
        const validationResult = updateDistributorSchema.validate({ distributorId, name, phone, email, area, address, isActive }, { abortEarly: true });
        if (validationResult.error) {
            return response.status(400).json({ status: 'FAILED', message: validationResult.error.details[0].message });
        }
        const dataToUpdate = {};
        if (name !== undefined) dataToUpdate.name = name;
        if (phone !== undefined) dataToUpdate.phone = phone || null;
        if (email !== undefined) dataToUpdate.email = email || null;
        if (area !== undefined) dataToUpdate.area = area || null;
        if (address !== undefined) dataToUpdate.address = address || null;
        if (typeof isActive === 'boolean') dataToUpdate.isActive = isActive;
        if (Object.keys(dataToUpdate).length === 0) {
            return response.status(400).json({ status: 'FAILED', message: 'No fields to update' });
        }
        const result = await distributorService.update(validationResult.value.distributorId, dataToUpdate);
        if (!result) {
            return response.status(404).json({ status: 'FAILED', message: 'Distributor not found' });
        }
        return response.status(200).json({ status: 'SUCCESS', message: 'Distributor updated successfully', data: result });
    } catch (error) {
        console.log('error', error);
        return response.status(500).json({ status: 'FAILED', message: error.message });
    }
};
module.exports = updateDistributor;
