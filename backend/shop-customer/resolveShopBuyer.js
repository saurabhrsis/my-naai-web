/**
 * Who is shopping — drop-in helper for the My Naai backend.
 *
 * Copy to `src/utils/shopBuyer.js` in the API repo and use it in every cart and
 * order controller. The shop now serves two kinds of buyer through the same
 * endpoints:
 *
 *   SALON     a partner buying stock for its chairs   → shop_orders.salonId
 *   CUSTOMER  an app/website user buying for itself   → shop_orders.customerId
 *
 * The buyer is read from the TOKEN, never from the request body: a client that
 * could name its own buyerId could read or cancel somebody else's order.
 *
 * Returns `{ buyerType, buyerId, isSalon }`, or `null` when the token carries no
 * usable identity (the caller answers 401).
 */

/**
 * The shape of `req.user` differs slightly between middlewares in this project
 * (`{ role, salonId }` from the salon guard, `{ userType, userId }` from the
 * shared auth guard), so every spelling is accepted here and normalised.
 */
const roleOf = (user) => String(user.role || user.userType || user.type || '').toUpperCase();

const resolveShopBuyer = (req) => {
  const user = (req && (req.user || req.salon || req.auth)) || {};
  const role = roleOf(user);

  if (role === 'SALON') {
    const salonId = user.salonId || user.salon_id || user.id || null;
    return salonId ? { buyerType: 'SALON', buyerId: String(salonId), isSalon: true } : null;
  }

  if (role === 'USER' || role === 'CUSTOMER' || role === 'CLIENT') {
    const customerId = user.userId || user.user_id || user.id || null;
    return customerId ? { buyerType: 'CUSTOMER', buyerId: String(customerId), isSalon: false } : null;
  }

  return null;
};

/**
 * The Sequelize `where` fragment for a buyer — the one place that knows which
 * column identifies them, so a service never has to branch on the role.
 */
const buyerWhere = ({ buyerType, buyerId }) => (
  buyerType === 'CUSTOMER' ? { customerId: buyerId } : { salonId: buyerId }
);

/**
 * The columns to write when a buyer places something. Exactly one of the two
 * ids is set, which is what the nullable salonId + buyerType enum enforce.
 */
const buyerColumns = ({ buyerType, buyerId }) => (
  buyerType === 'CUSTOMER'
    ? { buyerType: 'CUSTOMER', customerId: buyerId, salonId: null }
    : { buyerType: 'SALON', salonId: buyerId, customerId: null }
);

module.exports = { resolveShopBuyer, buyerWhere, buyerColumns };
