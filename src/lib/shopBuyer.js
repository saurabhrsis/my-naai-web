// Who is shopping, and how the shop should talk to them.
//
// One catalog (`shop_products`, curated by the admin) is sold through the same
// screens to three audiences:
//
//   SALON     a partner buying stock for the chairs — the original B2B shop
//   CUSTOMER  a signed-in customer buying grooming products for themselves
//   GUEST     a visitor on the public website, browsing before an account
//
// Everything that differs between them lives here rather than as `role ===
// 'SALON'` conditionals scattered through the screens: the cart/order
// namespace, the address the delivery goes to, and the few sentences that
// would otherwise tell a customer their parcel is going to "your salon".

export const SHOP_AUDIENCE = {
  SALON: 'SALON',
  CUSTOMER: 'CUSTOMER',
  GUEST: 'GUEST',
};

export function shopAudience(session) {
  if (!session || !session.userId) return SHOP_AUDIENCE.GUEST;
  return String(session.role || '').toUpperCase() === 'SALON' ? SHOP_AUDIENCE.SALON : SHOP_AUDIENCE.CUSTOMER;
}

export function isShopGuest(session) {
  return shopAudience(session) === SHOP_AUDIENCE.GUEST;
}

// The name that answers "who is this order for?" on the success card, the
// order list and the backend snapshot. A salon order belongs to the salon; a
// customer order belongs to the person.
export function buyerName(session) {
  const user = session?.user || {};
  const salon = user.salon || {};
  if (shopAudience(session) === SHOP_AUDIENCE.SALON) {
    return String(salon.salonName || user.salonName || user.ownerName || user.fullName || 'My Naai salon').trim();
  }
  return String(user.fullName || user.name || user.ownerName || '').trim();
}

// The cart/order storage namespace. Salons keep the bare account id they have
// always used (their carts and history must survive this change); customers are
// namespaced, so the same device can hold a salon cart and a personal cart —
// and a shared browser never shows one account's cart to another.
export function shopStorageOwnerId(session) {
  if (!session?.userId) return 'guest';
  const id = String(session.userId);
  return shopAudience(session) === SHOP_AUDIENCE.SALON ? id : `user:${id}`;
}

/**
 * The role-aware wording of the shop. `deliveryTarget` is the phrase that
 * follows "delivered to …" — the one line that used to be wrong for customers.
 */
export function shopCopy(session) {
  const audience = shopAudience(session);
  const salon = audience === SHOP_AUDIENCE.SALON;
  const guest = audience === SHOP_AUDIENCE.GUEST;
  return {
    audience,
    isSalon: salon,
    isGuest: guest,
    // Header
    title: 'Naai Shop',
    subtitle: salon
      ? 'Grooming stock for your salon, supplied by My Naai.'
      : 'Salon-grade grooming products, delivered to your door.',
    // Address the parcel goes to
    deliveryTarget: salon ? 'your salon' : 'your address',
    addressFieldLabel: salon ? 'Shop / salon address' : 'Delivery address',
    checkoutSubtitle: salon ? 'Delivery to your salon' : 'Delivery to your address',
    cartEmptyHint: salon
      ? 'Fill it with shampoo, clippers and beard oil — delivered to your salon.'
      : 'Fill it with shampoo, beard oil and grooming essentials — delivered to your door.',
    locationCaption: salon
      ? 'Our delivery partner navigates to this point. It is the salon GPS location unless you set it here.'
      : 'Our delivery partner navigates to this point. It is your saved location unless you set it here.',
    codLine: salon ? 'when the order reaches your salon' : 'when the order reaches your address',
    // Product page
    deliveryLine: salon
      ? 'delivered to your salon in 1–2 days'
      : 'delivered to your address in 1–2 days',
    sellerFallback: 'Supplied by My Naai',
    deliveredLine: salon ? 'Delivered — enjoy the stock at' : 'Delivered — enjoy your order',
    // A visitor can look at everything AND fill a cart; the account is asked
    // for at the moment of purchase, when its value is obvious (the order has
    // to reach a person and be trackable afterwards).
    signInToBuy: 'Sign in to add products to your cart — it takes one OTP.',
    guestCartNote: 'Your cart stays on this device until you sign in — the account is asked for at checkout.',
    // The gate itself. `guestCheckoutPoints` is rendered as a short list, so
    // the visitor knows exactly what the account buys them before tapping.
    guestCheckoutTitle: 'Sign in to place this order',
    guestCheckoutLead: 'One OTP signs you in — and creates your account if you are new. Nothing in your cart is lost.',
    guestCheckoutPoints: [
      'Your phone number is what the delivery partner calls and what the OTP proves.',
      'Your cart moves to the account, so the order can be tracked and cancelled before dispatch.',
      'You can reorder from My orders later, from the app or this site.',
    ],
    guestCheckoutCta: 'Sign in / Create account',
    guestCheckoutBack: 'Keep shopping',
  };
}
