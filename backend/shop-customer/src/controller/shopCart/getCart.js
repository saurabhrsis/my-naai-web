const shopCartService = require('../../services/shopCart.service');
const { resolveShopBuyer } = require('../../utils/shopBuyer');

/**
 * The signed-in buyer's cart.
 *
 * The cart belongs to an ACCOUNT, not a browser: the salon's original cart
 * (keyed by salonId) and a customer's (keyed by customerId) live in the same
 * table and are told apart by the token. The response shape is unchanged —
 * `{ lines: [...] }` — so both roles read the same mapper in the clients.
 */
const getCart = async (request, response) => {
    try {
        const buyer = resolveShopBuyer(request);
        if (!buyer) {
            return response.status(401).json({ status: 'FAILED', message: 'Sign in to view your cart.' });
        }

        const lines = await shopCartService.getCart(buyer);
        return response.status(200).json({ status: 'SUCCESS', data: { lines } });
    } catch (error) {
        console.log('error', error);
        return response.status(500).json({ status: 'FAILED', message: 'Could not load the cart' });
    }
};

module.exports = getCart;
