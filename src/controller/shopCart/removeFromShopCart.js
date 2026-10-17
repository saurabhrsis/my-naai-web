const { removeShopCartSchema } = require('../../validations/shopCart.validation');
const shopCartService = require('../../services/shopCart.service');

// Remove one line from the salon's cart.
const removeFromShopCart = async (request, response) => {
    try {
        const salonId = request.salon?.salonId;
        if (!salonId) {
            return response.status(400).json({ status: 'FAILED', message: 'Salon Id not found in token' });
        }
        const { productId } = request.body || {};
        const validationResult = removeShopCartSchema.validate({ productId }, { abortEarly: true });
        if (validationResult.error) {
            return response.status(400).json({ status: 'FAILED', message: validationResult.error.details[0].message });
        }

        const removed = await shopCartService.removeLine(salonId, validationResult.value.productId);
        if (!removed) {
            return response.status(404).json({ status: 'FAILED', message: 'Item not in cart' });
        }

        const data = await shopCartService.getCart(salonId);
        return response.status(200).json({ status: 'SUCCESS', message: 'Item removed from cart', data });
    } catch (error) {
        console.log('error', error);
        return response.status(500).json({ status: 'FAILED', message: error.message });
    }
};
module.exports = removeFromShopCart;
