const shopOrderService = require('../../services/shopOrder.service');
const { resolveShopBuyer } = require('../../utils/shopBuyer');
const { validateOrderBody } = require('../../validations/shopBuyer.validation');

/**
 * Place a shop order.
 *
 * One endpoint, two buyers: a SALON restocking its chairs and a CUSTOMER
 * buying for home. The buyer comes from the TOKEN (`resolveShopBuyer`) — the
 * body never names a salon or a customer, so a client cannot place an order
 * into somebody else's history.
 *
 * What changes between the two, inside the service:
 *   SALON     delivery point = the salon's own coordinates, else the pin sent
 *   CUSTOMER  delivery point = the pin sent (a customer has no standing salon)
 * Both get a real `shop_orders` row, the same status track, the same admin
 * dashboard and the same distributor assignment.
 */
const createShopOrder = async (request, response) => {
    try {
        const buyer = resolveShopBuyer(request);
        if (!buyer) {
            return response.status(401).json({ status: 'FAILED', message: 'Sign in to place this order.' });
        }

        const body = request.body || {};
        const problem = validateOrderBody(body);
        if (problem) {
            return response.status(400).json({ status: 'FAILED', message: problem });
        }

        const order = await shopOrderService.createOrder({
            ...buyer,                 // buyerType, buyerId, isSalon
            orderId: body.orderId,
            items: body.items,
            address: body.address,
            payment: body.payment,
            notes: body.notes
        });

        return response.status(200).json({ status: 'SUCCESS', message: 'Order placed', data: order });
    } catch (error) {
        console.log('error', error);
        const known = /not found|unavailable|out of stock|address/i.test(error.message);
        return response.status(known ? 400 : 500).json({ status: 'FAILED', message: error.message });
    }
};

module.exports = createShopOrder;
