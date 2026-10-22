const shopCartService = require('../../services/shopCart.service');
const { resolveShopBuyer } = require('../../utils/shopBuyer');
const { validateCartLine } = require('../../validations/shopBuyer.validation');

/** Remove one product from the signed-in buyer's cart. */
const removeFromCart = async (request, response) => {
    try {
        const buyer = resolveShopBuyer(request);
        if (!buyer) {
            return response.status(401).json({ status: 'FAILED', message: 'Sign in to change your cart.' });
        }

        const problem = validateCartLine(request.body || {});
        if (problem) {
            return response.status(400).json({ status: 'FAILED', message: problem });
        }

        const lines = await shopCartService.removeItem(buyer, String(request.body.productId || request.body.id));
        return response.status(200).json({ status: 'SUCCESS', data: { lines } });
    } catch (error) {
        console.log('error', error);
        return response.status(500).json({ status: 'FAILED', message: 'Could not update the cart' });
    }
};

module.exports = removeFromCart;
