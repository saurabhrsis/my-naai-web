const shopSettingsService = require('../../services/shopSettings.service');

// Admin panel — update the shop's commerce rules. Every field is optional so
// the form can save a partial change; validation lives in the service.
const adminUpdateShopSettings = async (request, response) => {
    try {
        const data = await shopSettingsService.updateSettings(request.body || {});
        return response.status(200).json({ status: 'SUCCESS', message: 'Shop settings saved', data });
    } catch (error) {
        console.log('error', error);
        const known = /must be a number|cannot be more than/.test(error.message);
        return response.status(known ? 400 : 500).json({ status: 'FAILED', message: error.message });
    }
};

module.exports = adminUpdateShopSettings;
