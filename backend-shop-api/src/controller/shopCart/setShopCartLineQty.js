const { setShopCartQtySchema } = require('../../validations/shopCart.validation');
const shopCartService = require('../../services/shopCart.service');

// Absolute quantity for a cart line (the stepper). qty 0 removes it.
const setShopCartLineQty = async (request, response) => {
    try {
        const salonId = request.salon?.salonId;
        if (!salonId) {
            return response.status(400).json({ status: 'FAILED', message: 'Salon Id not found in token' });
        }
        const { productId, qty } = request.body || {};
        const validationResult = setShopCartQtySchema.validate({ productId, qty }, { abortEarly: true });
        if (validationResult.error) {
            return response.status(400).json({ status: 'FAILED', message: validationResult.error.details[0].message });
        }

        const newQty = await shopCartService.setLineQty(salonId, validationResult.value.productId, validationResult.value.qty);
        if (newQty === null) {
            return response.status(404).json({ status: 'FAILED', message: 'Item not in cart' });
        }

        const data = await shopCartService.getCart(salonId);
        return response.status(200).json({ status: 'SUCCESS', message: 'Cart updated', data });
    } catch (error) {
        console.log('error', error);
        return response.status(500).json({ status: 'FAILED', message: error.message });
    }
};
module.exports = setShopCartLineQty;
