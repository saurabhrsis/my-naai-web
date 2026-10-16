const productService = require('../../services/product.service');

// Company admin: every salon's products (the salon-scoped /list only shows
// the caller's own catalog). Filters: salonId, isAvailable, searchString
// (product name or salon name).
const adminListProducts = async (request, response) => {
    try {
        const { page, salonId, isAvailable, searchString } = request.body || {};
        const data = await productService.adminListProducts({ page, salonId, isAvailable, searchString });

        if (!data.products || data.products.length === 0) {
            return response.status(200).json({
                status: 'FAILED',
                message: 'No products found',
                data
            });
        }

        return response.status(200).json({
            status: 'SUCCESS',
            message: 'Product list fetched successfully',
            data
        });
    } catch (error) {
        console.log('error', error);
        return response.status(500).json({
            status: 'FAILED',
            message: error.message
        });
    }
};

module.exports = adminListProducts;
