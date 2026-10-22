const shopCartService = require('../../services/shopCart.service');
const { resolveShopBuyer } = require('../../utils/shopBuyer');
const { validateCartLine } = require('../../validations/shopBuyer.validation');

/**
 * Add a product to the signed-in buyer's cart (or bump its quantity).
 *
 * A visitor on the public website cannot reach this: the web app asks them to
 * sign in on the first ADD and resumes with the same product, because a cart
 * that lived in the browser would not follow the person to the app.
 */
const addToCart = async (request, response) => {
    try {
        const buyer = resolveShopBuyer(request);
        if (!buyer) {
            return response.status(401).json({ status: 'FAILED', message: 'Sign in to add products to your cart.' });
        }

        const problem = validateCartLine(request.body || {});
        if (problem) {
            return response.status(400).json({ status: 'FAILED', message: problem });
        }

        const lines = await shopCartService.addItem(buyer, {
            productId: String(request.body.productId || request.body.id),
            qty: Number(request.body.qty) || 1
        });

        return response.status(200).json({ status: 'SUCCESS', message: 'Added to cart', data: { lines } });
    } catch (error) {
        console.log('error', error);
        const known = /not found|unavailable|out of stock/i.test(error.message);
        return response.status(known ? 400 : 500).json({ status: 'FAILED', message: error.message });
    }
};

module.exports = addToCart;
