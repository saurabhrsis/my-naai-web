const shopCartService = require('../../services/shopCart.service');
const { resolveShopBuyer } = require('../../utils/shopBuyer');
const { validateCartLine } = require('../../validations/shopBuyer.validation');

/**
 * Set a cart line's quantity. `qty: 0` removes the line — the clients use one
 * endpoint for both, and the − on a 1-quantity stepper is a remove.
 */
const setCartQty = async (request, response) => {
    try {
        const buyer = resolveShopBuyer(request);
        if (!buyer) {
            return response.status(401).json({ status: 'FAILED', message: 'Sign in to change your cart.' });
        }

        const body = request.body || {};
        const qty = Number(body.qty);
        if (!Number.isInteger(qty) || qty < 0) {
            return response.status(400).json({ status: 'FAILED', message: 'qty must be a whole number, 0 or more' });
        }

        const problem = validateCartLine(body);
        if (problem) {
            return response.status(400).json({ status: 'FAILED', message: problem });
        }

        const lines = await shopCartService.setQty(buyer, {
            productId: String(body.productId || body.id),
            qty
        });

        return response.status(200).json({ status: 'SUCCESS', data: { lines } });
    } catch (error) {
        console.log('error', error);
        return response.status(500).json({ status: 'FAILED', message: 'Could not update the cart' });
    }
};

module.exports = setCartQty;
