const shopCartService = require('../../services/shopCart.service');

// The salon's cart, with live product fields and a server-computed bill.
// Web and app both render from this — same salon, same cart, every device.
const getShopCart = async (request, response) => {
    try {
        const salonId = request.salon?.salonId;
        if (!salonId) {
            return response.status(400).json({ status: 'FAILED', message: 'Salon Id not found in token' });
        }
        const data = await shopCartService.getCart(salonId);
        return response.status(200).json({ status: 'SUCCESS', message: 'Cart fetched successfully', data });
    } catch (error) {
        console.log('error', error);
        return response.status(500).json({ status: 'FAILED', message: error.message });
    }
};
module.exports = getShopCart;
