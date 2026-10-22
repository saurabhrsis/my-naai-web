const shopOrderService = require('../../services/shopOrder.service');
const { resolveShopBuyer } = require('../../utils/shopBuyer');

// The buyer's own order history. The SALON track is what either buyer may
// see: the response's `status` is the customer-facing status, and the internal
// fulfilment state, the assigned distributor and its distance are stripped.
//
// `deliveryLocation` stays: it is the buyer's OWN address (the point the admin
// and the distributor see on their map), so they can confirm the pin is right.
const cleanForBuyer = (order) => {
    const clean = order.toJSON ? order.toJSON() : { ...order };
    clean.status = clean.customerStatus;
    clean.deliveryLocation = shopOrderService.deliveryLocationOf(clean);
    delete clean.customerStatus;
    delete clean.distributorId;
    delete clean.distributor;
    // The raw snapshot columns are already summarised by deliveryLocation.
    delete clean.deliveryLatitude;
    delete clean.deliveryLongitude;
    return clean;
};

/**
 * `POST /api/shop-orders/list` — "my orders".
 *
 * The filter comes from the token, so a customer can only ever page through
 * their own parcels, and a salon through its own. Same pagination shape the
 * clients already read.
 */
const listShopOrders = async (request, response) => {
    try {
        const buyer = resolveShopBuyer(request);
        if (!buyer) {
            return response.status(401).json({ status: 'FAILED', message: 'Sign in to see your orders.' });
        }

        const { page = 1, status } = request.body || {};
        const result = await shopOrderService.listForBuyer({ buyer, page, status });

        return response.status(200).json({
            status: 'SUCCESS',
            data: {
                orders: (result.orders || []).map(cleanForBuyer),
                pagination: result.pagination
            }
        });
    } catch (error) {
        console.log('error', error);
        return response.status(500).json({ status: 'FAILED', message: 'Could not load your orders' });
    }
};

module.exports = listShopOrders;
