const shopOrderService = require('../../services/shopOrder.service');
const { resolveShopBuyer, buyerActor } = require('../../utils/shopBuyer');

/**
 * Cancel one of MY orders, before it goes out for delivery.
 *
 * Same ownership rule as get-by-id: the service only cancels an order the
 * token's buyer owns, so a stale or guessed order id cannot cancel somebody
 * else's parcel. `DELIVERED` / `CANCELLED` are terminal and answer 400 with
 * the service's own explanation.
 */
const cancelShopOrder = async (request, response) => {
    try {
        const buyer = resolveShopBuyer(request);
        if (!buyer) {
            return response.status(401).json({ status: 'FAILED', message: 'Sign in to cancel this order.' });
        }

        const { orderId, reason } = request.body || {};
        if (!orderId) {
            return response.status(400).json({ status: 'FAILED', message: 'orderId is required' });
        }

        const order = await shopOrderService.cancelOrder(orderId, {
            buyer,
            reason: reason || null,
            actor: buyerActor(buyer)
        });
        if (!order) {
            return response.status(404).json({ status: 'FAILED', message: 'Order not found' });
        }

        return response.status(200).json({ status: 'SUCCESS', message: 'Order cancelled', data: order });
    } catch (error) {
        console.log('error', error);
        const known = /terminal|out for delivery|already|cannot be cancelled/i.test(error.message);
        return response.status(known ? 400 : 500).json({ status: 'FAILED', message: error.message });
    }
};

module.exports = cancelShopOrder;
