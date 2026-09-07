// Subscription plan catalog and helpers for showing the active plan.
// Ids, titles, prices and durations mirror the mobile app's
// SubscriptionsPlan / RenewalSubscriptionsPlan screens so the web portal uses
// the same names and labels partners already know.
// One price list for the whole portal. A renewal costs the same as a new
// purchase, so the price lives here once and both lists read it — the two
// arrays previously drifted (renewals were still on the old ₹99/₹179/₹249
// ladder), which showed a partner one price on the plan card and charged
// another on the next screen.
export const PLAN_PRICES = {
  monthly: 199,
  trial_2_months: 299,
  quarterly: 499,
};

export const PARTNER_PLANS = [
  { id: 'monthly', title: 'Monthly Plan', price: PLAN_PRICES.monthly, duration: '1 Month (30 Days)', note: 'Flexible month-to-month growth' },
  { id: 'trial_2_months', title: 'Introductory', price: PLAN_PRICES.trial_2_months, duration: '2 Months (60 Days)', note: 'A gentle start for new partners' },
  { id: 'quarterly', title: 'Quarterly Plan', price: PLAN_PRICES.quarterly, duration: '3 Months (90 Days)', note: 'Best value for busy salons', best: true },
];
// Same ids, durations and prices as above; only the supporting line changes so
// the copy reads as a renewal rather than a first purchase.
const RENEWAL_NOTES = {
  monthly: 'Flexible month-to-month growth',
  trial_2_months: 'Restart with a simple plan',
  quarterly: 'Best value for busy salons',
};
export const RENEWAL_PLANS = PARTNER_PLANS.map(plan => ({ ...plan, note: RENEWAL_NOTES[plan.id] || plan.note }));
export const FREE_ONBOARDING_PLAN = { id: 'Free', title: 'Free trial', displayPrice: '₹ 00', price: 0, duration: '20 days', note: 'Start your salon journey at no cost', best: true };

const PLAN_CATALOG = {};
// First occurrence wins, so the partner (new-purchase) list price is the
// catalog price; renewal variants only differ in price, not identity.
for (const plan of [...PARTNER_PLANS, ...RENEWAL_PLANS, FREE_ONBOARDING_PLAN]) {
  if (!PLAN_CATALOG[plan.id]) PLAN_CATALOG[plan.id] = plan;
}

function prettifyPlanId(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/free|^trial/i.test(text)) return 'Free trial';
  return text
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, character => character.toUpperCase());
}

function readBoolean(sources, keys) {
  for (const source of sources) {
    for (const key of keys) {
      const value = source?.[key];
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string' && /^(true|false)$/i.test(value.trim())) return value.trim().toLowerCase() === 'true';
    }
  }
  return null;
}

// Reads the active subscription out of a get-salon profile response without
// assuming one fixed response shape. The backend has returned plan fields at
// the salon root and nested objects on different releases, so every known
// variant is checked and anything missing degrades to a graceful "unknown".
export function normalizePlanDetails(profile = {}) {
  if (!profile || typeof profile !== 'object') return null;
  const sources = [profile, profile.subscription, profile.plan, profile.planDetails, profile.salonPlan, profile.activePlan, profile.planInfo, profile.salon?.subscription]
    .filter(value => value && typeof value === 'object' && !Array.isArray(value));
  const readString = keys => {
    for (const source of sources) {
      for (const key of keys) {
        const value = source?.[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
        if (typeof value === 'number' && Number.isFinite(value)) return String(value);
      }
    }
    return '';
  };
  const planType = readString(['planType', 'planId', 'subscriptionPlan', 'subscriptionType', 'planName'])
    || (typeof profile.plan === 'string' && profile.plan.trim() ? profile.plan.trim() : '');
  if (!planType) return null;
  const catalog = PLAN_CATALOG[planType] || {};
  const rawPrice = readString(['price', 'amount', 'planPrice', 'totalAmount']);
  const price = rawPrice !== '' ? Number(rawPrice) : catalog.price;
  const startDate = readString(['planStartDate', 'startDate', 'subscriptionStartDate', 'purchasedAt', 'createdAt']);
  const expiryDate = readString(['planExpiryDate', 'planExpiry', 'expiryDate', 'planEndDate', 'subscriptionEndDate', 'endDate', 'expiry', 'validTill', 'validUntil']);

  // A root `status` can describe the salon account, so only use explicit plan
  // status names at the root. A generic status is safe inside subscription/plan
  // objects, which is how the mobile API has returned it in some releases.
  const rootStatus = readString(['planStatus', 'subscriptionStatus', 'plan_state', 'subscription_state']);
  const nestedStatus = sources.slice(1).reduce((found, source) => {
    if (found) return found;
    for (const key of ['planStatus', 'subscriptionStatus', 'status', 'state']) {
      const value = source?.[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
  }, '');
  const status = rootStatus || nestedStatus;
  const statusText = String(status).toUpperCase();

  // Explicit flags win over the date. This matters immediately after a renewal:
  // the cached profile may still contain yesterday's expiry date until the next
  // profile refresh, while the renewal response already says the plan is active.
  const explicitExpired = readBoolean(sources, ['subscriptionExpired', 'isSubscriptionExpired', 'planExpired', 'isPlanExpired']);
  const explicitActive = readBoolean(sources, ['subscriptionActive', 'isSubscriptionActive', 'planActive', 'isPlanActive']);
  const expiryTime = expiryDate ? new Date(expiryDate).getTime() : NaN;
  const expiredByDate = Number.isFinite(expiryTime) ? expiryTime < Date.now() : null;
  const expiredByStatus = /EXPIRED|INACTIVE|SUSPENDED|CANCELLED|FALSE/.test(statusText)
    ? true
    : /ACTIVE|VALID|CURRENT|TRUE/.test(statusText)
      ? false
      : null;
  const expired = explicitExpired !== null
    ? explicitExpired
    : explicitActive !== null
      ? !explicitActive
      : expiredByDate ?? expiredByStatus;
  const daysLeft = Number.isFinite(expiryTime) ? Math.ceil((expiryTime - Date.now()) / 86400000) : null;
  return {
    planType,
    title: catalog.title || prettifyPlanId(planType),
    duration: catalog.duration || '',
    price: Number.isFinite(price) ? price : null,
    startDate,
    expiryDate,
    daysLeft,
    expired,
    isActive: expired === null ? true : !expired,
  };
}

export function getSubscriptionState(profile = {}) {
  const plan = normalizePlanDetails(profile);
  return {
    plan,
    known: Boolean(plan && plan.expired !== null),
    expired: plan?.expired === true,
    active: plan?.expired === false,
  };
}
