const shopCartService = require('../../services/shopCart.service');

// Empty the salon's cart (called after a successful order placement).
const clearShopCart = async (request, response) => {
    try {
        const salonId = request.salon?.salonId;
        if (!salonId) {
            return response.status(400).json({ status: 'FAILED', message: 'Salon Id not found in token' });
        }
        await shopCartService.clearCart(salonId);
        return response.status(200).json({ status: 'SUCCESS', message: 'Cart cleared' });
    } catch (error) {
        console.log('error', error);
        return response.status(500).json({ status: 'FAILED', message: error.message });
    }
};
module.exports = clearShopCart;
