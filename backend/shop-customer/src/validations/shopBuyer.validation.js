/**
 * Request validation for the shop endpoints, without adding a new dependency.
 *
 * The salon-only controllers validated with the project's Joi schemas. These
 * two helpers cover the same ground for the parts that matter to the server —
 * a non-empty item list, a deliverable address, a real product id and a sane
 * quantity — and return a message string (or null) so every controller can
 * answer 400 from one line.
 */

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isFilled = (value) => typeof value === 'string' ? value.trim().length > 0 : value !== null && value !== undefined;

const MAX_QTY = 20;
const PHONE = /^[0-9]{10}$/;

/** A cart line: which product, how many. */
const validateCartLine = (body = {}, { requireQty = false } = {}) => {
    const productId = body.productId || body.id;
    if (!isFilled(productId)) return 'productId is required';

    if (requireQty || body.qty !== undefined) {
        const qty = Number(body.qty);
        if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
            return `qty must be a whole number between 1 and ${MAX_QTY}`;
        }
    }
    return null;
};

/** An order: items with real prices, and somewhere to deliver to. */
const validateOrderBody = (body = {}) => {
    if (!Array.isArray(body.items) || body.items.length === 0) return 'At least one item is required';

    for (const item of body.items) {
        if (!isFilled(item?.productId)) return 'Every item needs a productId';
        const qty = Number(item.qty);
        if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) return `Every item needs a qty between 1 and ${MAX_QTY}`;
        if (!Number.isFinite(Number(item.price)) || Number(item.price) < 0) return 'Every item needs a price';
    }

    const address = body.address;
    if (!isObject(address)) return 'A delivery address is required';
    const missing = ['name', 'phone', 'line1', 'city', 'state', 'pincode'].filter((field) => !isFilled(address[field]));
    if (missing.length) return `Delivery address is missing: ${missing.join(', ')}`;
    if (!PHONE.test(String(address.phone).replace(/\D/g, '').slice(-10))) return 'Delivery phone must be a 10-digit number';

    const method = (body.payment && body.payment.method) || 'COD';
    if (!['COD', 'ONLINE'].includes(String(method).toUpperCase())) return 'payment.method must be COD or ONLINE';

    return null;
};

module.exports = { validateCartLine, validateOrderBody, MAX_QTY };
