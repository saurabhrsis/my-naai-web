/**
 * One order, two possible buyers.
 *
 * Shop orders used to come from a salon only, so every screen read
 * `order.salon.salonName`. A customer order has `salon === null` and a
 * `customer` object instead — this file is the single place the panel asks
 * "who bought this?" so no table cell, drawer or CSV export has to repeat the
 * `buyerType === 'CUSTOMER'` check.
 *
 * Backend contract (docs/SHOP-CUSTOMERS.md):
 *   order.buyerType  'SALON' | 'CUSTOMER'   (older rows may omit it)
 *   order.salon      { salonId, salonName, phoneNumber } | null
 *   order.customer   { userId, fullName, phoneNumber }   | null
 */

export const BUYER_TYPES = {
    SALON: 'SALON',
    CUSTOMER: 'CUSTOMER',
};

const asText = (value) => String(value ?? '').trim();

export const isCustomerOrder = (order) => {
    if (!order) return false;
    if (order.buyerType) return asText(order.buyerType).toUpperCase() === BUYER_TYPES.CUSTOMER;
    // Rows created before the column existed are salon orders by definition —
    // and the safest fallback for a row with no salon to show.
    return !order.salon && Boolean(order.customer);
};

/**
 * @returns {{ type: 'SALON'|'CUSTOMER', isCustomer: boolean, name: string,
 *             phone: string, id: string, subtitle: string }}
 */
export const buyerOf = (order) => {
    const customer = isCustomerOrder(order);
    const source = customer ? (order?.customer || {}) : (order?.salon || {});
    const name = customer
        ? asText(source.fullName) || 'Customer'
        : asText(source.salonName) || asText(order?.salonName) || 'Salon';
    const phone = asText(source.phoneNumber) || asText(order?.salonPhoneNumber) || '';
    const id = asText(customer ? source.userId : source.salonId);

    return {
        type: customer ? BUYER_TYPES.CUSTOMER : BUYER_TYPES.SALON,
        isCustomer: customer,
        name,
        phone,
        id,
        subtitle: customer ? 'Customer order · no salon account' : 'Salon order',
    };
};

/** The one-line label a table row needs ("Customer · Sneha Waghmare"). */
export const buyerLabel = (order) => {
    const buyer = buyerOf(order);
    return buyer.isCustomer ? `Customer · ${buyer.name}` : buyer.name;
};

/** The filter value to send as `buyerType` ('' means "all"). */
export const buyerTypeParam = (value) => {
    const text = asText(value).toUpperCase();
    return text === BUYER_TYPES.SALON || text === BUYER_TYPES.CUSTOMER ? text : '';
};

/** `tel:` href for the tap-to-call link, or '' when there is no number. */
export const telHref = (phone) => {
    const digits = asText(phone).replace(/[^\d+]/g, '');
    return digits ? `tel:${digits}` : '';
};
