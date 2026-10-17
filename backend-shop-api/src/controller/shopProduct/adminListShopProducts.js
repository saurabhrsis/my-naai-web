const shopProductService = require('../../services/shopProduct.service');

// Company admin: the full shop catalog (soft-deleted rows excluded).
const adminListShopProducts = async (request, response) => {
    try {
        const { page, searchString } = request.body || {};
        const data = await shopProductService.listCatalog({ page, searchString });
        return response.status(200).json({
            status: 'SUCCESS',
            message: 'Shop product list fetched successfully',
            data
        });
    } catch (error) {
        console.log('error', error);
        return response.status(500).json({ status: 'FAILED', message: error.message });
    }
};
module.exports = adminListShopProducts;
