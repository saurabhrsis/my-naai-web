const productService = require("../../services/product.service")
const getAllSalonsProducts = async (request, respsone) => {
    try {
        const userId = request.user?.id;
        if (!userId) {
            return respsone.status(400).json({
                status: 'FAILED',
                message: 'User Id not found in token'
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