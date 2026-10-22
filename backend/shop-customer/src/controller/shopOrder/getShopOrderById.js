const shopOrderService = require('../../services/shopOrder.service');
const { resolveShopBuyer } = require('../../utils/shopBuyer');

/**
 * One order, for its owner only.
 *
 * The ownership check happens in the service (`getById(..., { buyer })`), which
 * returns null for an order that belongs to somebody else — the caller gets the
 * same 404 as for an id that does not exist, so probing ids reveals nothing.
 */
const getShopOrderById = async (request, response) => {
    try {
        const buyer = resolveShopBuyer(request);
        if (!buyer) {
            return response.status(401).json({ status: 'FAILED', message: 'Sign in to view this order.' });
        }

        const { orderId } = request.body || {};
        if (!orderId) {
            return response.status(400).json({ status: 'FAILED', message: 'orderId is required' });
        }

        const order = await shopOrderService.getById(orderId, { buyer, withEvents: true });
        if (!order) {
            return response.status(404).json({ status: 'FAILED', message: 'Order not found' });
        }

        const clean = order.toJSON ? order.toJSON() : { ...order };
        clean.status = clean.customerStatus || clean.status;
        clean.deliveryLocation = shopOrderService.deliveryLocationOf(clean);
        delete clean.customerStatus;
        delete clean.distributorId;
        delete clean.distributor;

        return response.status(200).json({ status: 'SUCCESS', data: clean });
    } catch (error) {
        console.log('error', error);
        return response.status(500).json({ status: 'FAILED', message: 'Could not load the order' });
    }
};

module.exports = getShopOrderById;
