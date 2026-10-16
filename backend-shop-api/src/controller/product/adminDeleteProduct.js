const { deleteProductSchema } = require('../../validations/product.validation');
const productService = require('../../services/product.service');

// Company admin: delete ANY salon's product (the salon-scoped /delete can only
// remove the token's own products).
const adminDeleteProduct = async (request, response) => {
    try {
        const { productId } = request.body || {};

        const validationResult = deleteProductSchema.validate({ productId }, { abortEarly: true });
        if (validationResult.error) {
            return response.status(400).json({
                status: 'FAILED',
                message: validationResult.error.details[0].message
            });
        }

        const result = await productService.deleteProduct(productId);
        if (!result) {
            return response.status(404).json({
                status: 'FAILED',
                message: 'Product not found'
            });
        }

        return response.status(200).json({
            status: 'SUCCESS',
            message: 'Product deleted successfully'
        });
    } catch (error) {
        console.log('error', error);
        return response.status(500).json({
            status: 'FAILED',
            message: error.message
        });
    }
};

module.exports = adminDeleteProduct;
