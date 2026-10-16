const { createShopOrderSchema } = require('../../validations/shopOrder.validation');
const shopOrderService = require('../../services/shopOrder.service');

// A salon places an order for stock (B2B shop). The client sends the exact
// snapshot shape it keeps in localStorage; the bill is recomputed here so the
// amounts can never be tampered with.
const createShopOrder = async (request, response) => {
    try {
        const salonId = request.salon?.salonId;
        if (!salonId) {
            return response.status(400).json({
                status: 'FAILED',
                message: 'Salon Id not found in token'
            });
        }

        const { items, address, payment, notes } = request.body || {};

        const validationResult = createShopOrderSchema.validate(
            { items, address, payment, notes },
            { abortEarly: false }
        );

        if (validationResult.error) {
            const first = validationResult.error.details[0];
            return response.status(400).json({
                status: 'FAILED',
                message: first?.message || 'Invalid order'
            });
        }

        const value = validationResult.value;
        const order = await shopOrderService.createOrder({
            salonId,
            items: value.items,
            address: value.address,
            payment: value.payment,
            notes: value.notes
        });

        return response.status(200).json({
            status: 'SUCCESS',
            message: 'Order placed successfully',
            data: order
        });
    } catch (error) {
        console.log('error', error);
        return response.status(500).json({
            status: 'FAILED',
            message: error.message
        });
    }
};

module.exports = createShopOrder;
