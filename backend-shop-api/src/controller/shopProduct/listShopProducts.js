const shopProductService = require('../../services/shopProduct.service');

// The buying side's catalog: the mobile app browses as a USER, the web shop
// as a SALON — authUserOrSalon accepts either token and identifies the
// caller. The catalog itself is company-wide, so the identity only proves
// the caller is an account, not which account.
const listShopProducts = async (request, respsone) => {
    try {
        const callerId = request.user?.id || request.salon?.salonId;
        if (!callerId) {
            return respsone.status(400).json({
                status: 'FAILED',
                message: 'Caller identity not found in token'
            });
        }

        const { page, searchString } = request.body || {};
        const data = await shopProductService.listCatalog({ page, searchString });

        return respsone.status(200).json({
            status: 'SUCCESS',
            message: 'Shop product list fetched successfully',
            data
        });
    } catch (error) {
        return respsone.status(500).json({
            status: 'FAILED',
            message: error.message
        });
    }
};
module.exports = listShopProducts;
