const productService = require("../../services/product.service")
const getAllSalonsProducts = async (request, respsone) => {
    try {
        // authenticateUserOrSalon populates request.user (mobile app) or
        // request.salon (web shop) — the catalog is browsable by both.
        const callerId = request.user?.id || request.salon?.salonId;
        if (!callerId) {
            return respsone.status(400).json({
                status: 'FAILED',
                message: 'Caller identity not found in token'
            })
        }

        const { page, searchString } = request.body || {};

        const data = await productService.allSalonsProductsList({ page, searchString });

        if (!data.products || data.products.length === 0) {
            return respsone.status(200).json({
                status: 'FAILED',
                message: 'No products found',
                data
            });
        } else {
            //return prodct list
            return respsone.status(200).json({
                status: 'SUCCESS',
                message: 'Product list fetched successfully',
                data
            });
        }
    } catch (error) {
        return respsone.status(500).json({
            status: 'FAILED',
            message: error.message
        })
    }
}
module.exports = getAllSalonsProducts;