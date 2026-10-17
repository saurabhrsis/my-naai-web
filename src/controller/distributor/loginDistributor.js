const { loginDistributorSchema } = require('../../validations/distributor.validation');
const distributorService = require('../../services/distributor.service');
const { generateToken } = require('../../utils/middleware/token.util');

// Distributor portal login (phone or email + the password the company admin
// set). Returns the same shape as the admin login so the admin panel can
// reuse its auth storage: { data: { distributor, token } }.
const loginDistributor = async (request, response) => {
    try {
        const { identifier, password } = request.body || {};
        const validationResult = loginDistributorSchema.validate({ identifier, password }, { abortEarly: true });
        if (validationResult.error) {
            return response.status(400).json({ status: 'FAILED', message: validationResult.error.details[0].message });
        }

        const distributor = await distributorService.login(validationResult.value.identifier, password);
        if (!distributor) {
            return response.status(401).json({ status: 'FAILED', message: 'Invalid phone/email or password, or the account has no login set up yet' });
        }

        const token = generateToken({
            distributorId: distributor.distributorId,
            name: distributor.name,
            role: 'distributor'
        });

        return response.status(200).json({
            status: 'SUCCESS',
            message: 'Login successful',
            data: {
                distributor: {
                    distributorId: distributor.distributorId,
                    name: distributor.name,
                    phone: distributor.phone,
                    email: distributor.email,
                    area: distributor.area,
                    deliveryCapability: distributor.deliveryCapability
                },
                token
            }
        });
    } catch (error) {
        console.log('error', error);
        return response.status(500).json({ status: 'FAILED', message: error.message });
    }
};

module.exports = loginDistributor;
