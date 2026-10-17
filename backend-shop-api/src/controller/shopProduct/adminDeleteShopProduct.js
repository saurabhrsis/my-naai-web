const { adminDeleteShopProductSchema } = require('../../validations/shopProduct.validation');
const shopProductService = require('../../services/shopProduct.service');

// Company admin: soft-delete a shop product. Cart lines and placed orders
// keep their snapshots, so nothing dangles.
const adminDeleteShopProduct = async (request, response) => {
    try {
        const { productId } = request.body || {};
        const validationResult = adminDeleteShopProductSchema.validate({ productId }, { abortEarly: true });
        if (validationResult.error) {
            return response.status(400).json({ status: 'FAILED', message: validationResult.error.details[0].message });
        }

        const result = await shopProductService.softDelete(productId);
        if (!result) {
            return response.status(404).json({ status: 'FAILED', message: 'Shop product not found' });
        }

        return response.status(200).json({ status: 'SUCCESS', message: 'Shop product deleted successfully' });
    } catch (error) {
        console.log('error', error);
        return response.status(500).json({ status: 'FAILED', message: error.message });
    }
};
module.exports = adminDeleteShopProduct;
