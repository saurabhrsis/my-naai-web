const shopSettingsService = require('../../services/shopSettings.service');

// Public read of the shop's commerce rules (delivery fee / free-delivery
// threshold / discount / COD limit + charges). Nothing sensitive — the web
// shop needs these to show honest "free above ₹X" and COD availability
// without waiting on the catalog.
const getShopSettings = async (request, response) => {
    try {
        const data = await shopSettingsService.getSettings();
        return response.status(200).json({ status: 'SUCCESS', data });
    } catch (error) {
        console.log('error', error);
        return response.status(500).json({ status: 'FAILED', message: 'Could not read shop settings' });
    }
};

module.exports = getShopSettings;
