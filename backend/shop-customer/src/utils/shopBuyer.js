/**
 * Who is using the shop right now — the one place that answers it.
 *
 * The shop serves two kinds of buyer through the same endpoints:
 *
 *   SALON     a partner buying stock for its chairs
 *   CUSTOMER  an app/website user buying grooming products for themselves
 *
 * Both authenticate with the same bearer token, so the buyer is read from the
 * TOKEN — never from the request body, which a client could set to somebody
 * else's id and then read or cancel their orders.
 *
 * The middlewares in this project attach slightly different shapes
 * (`{ role, salonId }` from the salon guard, `{ userType, userId }` from the
 * shared one), so every spelling is normalised here and nowhere else.
 */

const roleOf = (user) => String(user.role || user.userType || user.type || '').toUpperCase();

const SALON_ROLES = ['SALON', 'PARTNER'];
const CUSTOMER_ROLES = ['USER', 'CUSTOMER', 'CLIENT'];

/**
 * @returns {{ buyerType: 'SALON'|'CUSTOMER', buyerId: string, isSalon: boolean } | null}
 *          null when the token carries no usable identity → the controller
 *          answers 401.
 */
const resolveShopBuyer = (request) => {
    const user = (request && (request.user || request.salon || request.auth)) || {};
    const role = roleOf(user);

    if (SALON_ROLES.includes(role)) {
        const salonId = user.salonId || user.salon_id || user.id || null;
        return salonId ? { buyerType: 'SALON', buyerId: String(salonId), isSalon: true } : null;
    }

    if (CUSTOMER_ROLES.includes(role)) {
        const customerId = user.userId || user.user_id || user.id || null;
        return customerId ? { buyerType: 'CUSTOMER', buyerId: String(customerId), isSalon: false } : null;
    }

    return null;
};

/**
 * The Sequelize `where` fragment for a buyer. The single place that knows
 * which column identifies the buyer, so a service never branches on the role
 * itself — and a new role (a distributor buying supplies, say) is one line.
 */
const buyerWhere = (buyer) => (
    buyer && buyer.buyerType === 'CUSTOMER'
        ? { customerId: buyer.buyerId }
        : { salonId: buyer ? buyer.buyerId : null }
);

/**
 * The columns written when a buyer places something. Exactly one of the two
 * ids is set, which is what the nullable `salonId` + `buyerType` design
 * enforces: a row is either a salon's or a customer's, never both.
 */
const buyerColumns = (buyer) => (
    buyer && buyer.buyerType === 'CUSTOMER'
        ? { buyerType: 'CUSTOMER', customerId: buyer.buyerId, salonId: null }
        : { buyerType: 'SALON', salonId: buyer ? buyer.buyerId : null, customerId: null }
);

/**
 * True when the signed-in buyer owns this order. Used by get-by-id, cancel and
 * anything else that must not leak one buyer's parcel to another. Salons keep
 * the check they always had; customers get the equivalent one.
 */
const buyerOwnsOrder = (buyer, order) => {
    if (!buyer || !order) return false;
    const row = order.toJSON ? order.toJSON() : order;
    return buyer.buyerType === 'CUSTOMER'
        ? String(row.customerId || '') === buyer.buyerId
        : String(row.salonId || '') === buyer.buyerId;
};

/**
 * The actor written into `shop_order_events` when a buyer moves their own
 * order (placement, cancellation). The admin timeline renders the same row
 * shape for both buyers, so nothing on the dashboard changes.
 */
const buyerActor = (buyer, label) => ({
    actorType: buyer && buyer.buyerType === 'CUSTOMER' ? 'CUSTOMER' : 'SALON',
    actorId: buyer ? buyer.buyerId : null,
    actorLabel: label || (buyer && buyer.buyerType === 'CUSTOMER' ? 'Customer' : 'Salon')
});

module.exports = { resolveShopBuyer, buyerWhere, buyerColumns, buyerOwnsOrder, buyerActor };
