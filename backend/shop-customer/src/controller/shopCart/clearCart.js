const shopCartService = require('../../services/shopCart.service');
const { resolveShopBuyer } = require('../../utils/shopBuyer');

/** Empty the signed-in buyer's cart (used after a successful order). */
const clearCart = async (request, response) => {
    try {
        const buyer = resolveShopBuyer(request);
        if (!buyer) {
            return response.status(401).json({ status: 'FAILED', message: 'Sign in to change your cart.' });
        }

        await shopCartService.clear(buyer);
        return response.status(200).json({ status: 'SUCCESS', message: 'Cart cleared', data: { lines: [] } });
    } catch (error) {
        console.log('error', error);
        return response.status(500).json({ status: 'FAILED', message: 'Could not clear the cart' });
    }
};

module.exports = clearCart;
