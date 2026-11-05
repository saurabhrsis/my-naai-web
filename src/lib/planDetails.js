// Subscription plan helpers: the active-plan card, and the ONE catalog the
// picker renders.
//
// The prices, durations and the free-trial length are DATA now — the admin panel
// owns them (`src/lib/planCatalog.js` reads `POST /api/salons/plans/list` and
// falls back to the seed). This module keeps its two jobs: look a plan up by the
// id a subscription row stores, and work out whether that plan is still live.
//
// `PLAN_PRICES`, `PARTNER_PLANS`, `RENEWAL_PLANS` and `FREE_ONBOARDING_PLAN` are
// still exported — every existing caller keeps working — but they are now
// DERIVED from the catalog, so a price the admin changes is the price shown here
// without a redeploy.
import {
  DEFAULT_FREE_TRIAL,
  DEFAULT_PLAN_CATALOG,
  DEFAULT_PARTNER_PLANS,
  activePlans,
  describeDuration,
  freeTrialPlan,
  planById,
  renewalPlans,
} from './planCatalog';

export const PARTNER_PLANS = DEFAULT_PARTNER_PLANS.map(plan => ({
  id: plan.id,
  title: plan.title,
  price: plan.price,
  duration: describeDuration(plan.days),
  note: plan.note,
  ...(plan.best ? { best: true } : {}),
}));

// One price list for the whole portal. A renewal costs the same as a new
// purchase, so the price lives in one place and both lists read it.
export const PLAN_PRICES = PARTNER_PLANS.reduce((prices, plan) => ({ ...prices, [plan.id]: plan.price }), {});

export const RENEWAL_PLANS = renewalPlans(DEFAULT_PLAN_CATALOG).map(plan => ({
  ...plan,
  duration: describeDuration(plan.days),
}));

export const FREE_ONBOARDING_PLAN = freeTrialPlan(DEFAULT_PLAN_CATALOG);

// The plans a screen should render right now, from the server's catalog when it
// has answered and from the seed until then. `isUpgrade` only changes the
// supporting line, never the price.
export function plansForScreen(catalog = DEFAULT_PLAN_CATALOG, { isUpgrade = false } = {}) {
  const list = isUpgrade ? renewalPlans(catalog) : activePlans(catalog);
  // `duration` is always re-derived from `days`, so a stored string can never
  // disagree with what the salon actually gets.
  return list.map(plan => ({ ...plan, duration: describeDuration(plan.days) }));
}

export function freePlanForScreen(catalog = DEFAULT_PLAN_CATALOG) {
  return freeTrialPlan(catalog);
}

export const SEED_FREE_TRIAL_DAYS = DEFAULT_FREE_TRIAL.days;

// The seed catalog, used when nothing has been fetched yet. `planById` reads the
// live one when a caller has it: an admin rename must reach the active-plan card.
const PLAN_CATALOG = {};
for (const plan of [...PARTNER_PLANS, ...RENEWAL_PLANS, FREE_ONBOARDING_PLAN]) {
  if (!PLAN_CATALOG[plan.id]) PLAN_CATALOG[plan.id] = plan;
}
let liveCatalog = DEFAULT_PLAN_CATALOG;

// The subscription screen hands the fetched catalog here once, so an active-plan
// card rendered elsewhere (the account tab, the renewal gate) shows the admin's
// title and price for the same plan id.
export function setLivePlanCatalog(catalog) {
  // `null` explicitly resets to the seed (sign-out, tests); an answer with no
  // plans is ignored rather than emptying every plan label on the portal.
  if (catalog === null) liveCatalog = DEFAULT_PLAN_CATALOG;
  else if (catalog?.plans?.length) liveCatalog = catalog;
  return liveCatalog;
}

export function getLivePlanCatalog() {
  return liveCatalog;
}

function catalogEntry(planId) {
  const live = planById(liveCatalog, planId);
  if (live) return { ...live, duration: describeDuration(live.days) };
  return PLAN_CATALOG[planId] || null;
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

// Collects EVERY boolean-like value for the keys across all sources instead of
// the first one. A renewal writes `isPlanActive` on the subscription record
// while an older copy of the same flag can linger at the salon root — when the
// two disagree, the live "true" must win or the renewed salon is locked out.
function readBooleanAll(sources, keys) {
  const values = [];
  for (const source of sources) {
    for (const key of keys) {
      const value = source?.[key];
      if (typeof value === 'boolean') values.push(value);
      else if (typeof value === 'number' && (value === 1 || value === 0)) values.push(value === 1);
      else if (typeof value === 'string' && /^(true|false|yes|no|1|0)$/i.test(value.trim())) values.push(/^(true|yes|1)$/i.test(value.trim()));
    }
  }
  return values;
}

// Epoch numbers (ms or s) and ISO strings both appear as date values across
// backend releases; anything else is ignored rather than guessed at.
function parseTime(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value > 1e12 ? value : value * 1000;
  if (typeof value === 'string' && value.trim()) {
    const text = value.trim();
    if (/^\d+$/.test(text)) return parseTime(Number(text));
    const time = new Date(text).getTime();
    return Number.isFinite(time) ? time : NaN;
  }
  return NaN;
}

// The LATEST parsed value across sources. A renewal rewrites planStartDate /
// planEndDate forward on the subscription record; older copies of the same
// window can linger on the salon root, and the current plan is the one that
// ends furthest away.
function readDateMax(sources, keys) {
  let best = null;
  for (const source of sources) {
    for (const key of keys) {
      const raw = source?.[key];
      if (raw === undefined || raw === null || raw === '') continue;
      const time = parseTime(raw);
      if (!Number.isFinite(time)) continue;
      const numeric = typeof raw === 'number' || /^\d+$/.test(String(raw).trim());
      const value = numeric ? new Date(time).toISOString() : String(raw).trim();
      if (!best || time > best.time) best = { value, time };
    }
  }
  return best;
}

// The subscription record's own fields — exactly what `renew-salon-plan`
// rewrites at every renewal (the salon's `subscription` document carries
// planType / planStartDate / planEndDate / isPlanActive / createdAt /
// updatedAt). These are the fields the forced-renewal paywall
// (mode=RENEW&forceRenewal=true) must check before locking a salon out.
const RECORD_ACTIVE_FLAGS = ['isPlanActive', 'planActive'];
const RECORD_START_KEYS = ['planStartDate'];
const RECORD_END_KEYS = ['planEndDate'];

// Reads the active subscription out of a get-salon profile response without
// assuming one fixed response shape. The backend has returned plan fields at
// the salon root and nested objects on different releases, so every known
// variant is checked and anything missing degrades to a graceful "unknown".
export function normalizePlanDetails(profile = {}) {
  if (!profile || typeof profile !== 'object') return null;
  // Every known home of the subscription record. Singleton arrays are unwrapped
  // (some releases return `subscription: [{ … }]`) and `profile.salon` is read
  // directly so a record nested under the salon object is seen without callers
  // having to pre-merge it.
  const unwrap = value => {
    if (Array.isArray(value)) return value.length === 1 && value[0] && typeof value[0] === 'object' && !Array.isArray(value[0]) ? value[0] : null;
    return value && typeof value === 'object' ? value : null;
  };
  const sources = [...new Set([
    profile,
    profile.subscription,
    profile.plan,
    profile.planDetails,
    profile.salonPlan,
    profile.activePlan,
    profile.planInfo,
    profile.subscriptionDetails,
    profile.currentSubscription,
    profile.activeSubscription,
    profile.salon,
    profile.salon?.subscription,
  ].map(unwrap).filter(Boolean))];
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
  const catalog = catalogEntry(planType) || {};
  const rawPrice = readString(['price', 'amount', 'planPrice', 'totalAmount']);
  const price = rawPrice !== '' ? Number(rawPrice) : catalog.price;
  // The subscription record's own window (planStartDate / planEndDate) is what
  // a renewal rewrites; legacy aliases are only consulted when the record does
  // not carry them.
  const recordStart = readDateMax(sources, RECORD_START_KEYS);
  const recordEnd = readDateMax(sources, RECORD_END_KEYS);
  const startDate = recordStart?.value
    || readString(['startDate', 'subscriptionStartDate', 'purchasedAt', 'createdAt']);
  const expiryDate = recordEnd?.value
    || readString(['planExpiryDate', 'planExpiry', 'expiryDate', 'subscriptionEndDate', 'endDate', 'expiry', 'validTill', 'validUntil']);

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

  // ---- Is the plan actually over? -----------------------------------------
  // The subscription record (planStartDate / planEndDate / isPlanActive — the
  // fields `renew-salon-plan` writes on every renewal) is the arbiter for the
  // forced-renewal paywall (mode=RENEW&forceRenewal=true). Stale copies of the
  // old flags — a `subscriptionExpired: true` cached in the session before the
  // renewal, a legacy `planExpiryDate` left at the salon root — must never lock
  // a salon whose record is live.
  const recordFlags = readBooleanAll(sources, RECORD_ACTIVE_FLAGS);
  const recordFlagActive = recordFlags.includes(true);
  const recordFlagInactive = !recordFlagActive && recordFlags.includes(false);
  const expiryTime = expiryDate ? new Date(expiryDate).getTime() : NaN;
  const expiredByDate = Number.isFinite(expiryTime) ? expiryTime < Date.now() : null;
  // Explicit flags win over the date. This matters immediately after a renewal:
  // the cached profile may still contain yesterday's expiry date until the next
  // profile refresh, while the renewal response already says the plan is active.
  const explicitExpired = readBoolean(sources, ['subscriptionExpired', 'isSubscriptionExpired', 'planExpired', 'isPlanExpired']);
  const explicitActive = readBoolean(sources, ['subscriptionActive', 'isSubscriptionActive', 'planActive', 'isPlanActive']);
  const expiredByStatus = /EXPIRED|INACTIVE|SUSPENDED|CANCELLED|FALSE/.test(statusText)
    ? true
    : /ACTIVE|VALID|CURRENT|TRUE/.test(statusText)
      ? false
      : null;
  // A record flag of `isPlanActive: true` is ABSOLUTE: the renewal modal never
  // shows while the flag says the plan is live — not for a passed planEndDate,
  // not for a stale subscriptionExpired cache flag, not for a PLAN_EXPIRED echo.
  // Without a live flag, planEndDate is the hard bound of the window and a
  // false flag is a veto once the window is gone. Only when the record carries
  // none of these fields does the legacy chain (explicit flags → status →
  // expiry aliases) decide, exactly as older releases behaved.
  const expired = recordFlagActive
    ? false
    : recordEnd
      ? recordEnd.time < Date.now()
      : recordFlagInactive
        ? true
        : explicitExpired !== null
          ? explicitExpired
          : explicitActive !== null
            ? !explicitActive
            : expiredByStatus ?? expiredByDate;
  const daysLeft = Number.isFinite(expiryTime) ? Math.ceil((expiryTime - Date.now()) / 86400000) : null;
  return {
    planType,
    title: catalog.title || prettifyPlanId(planType),
    duration: catalog.duration || '',
    price: Number.isFinite(price) ? price : null,
    startDate,
    expiryDate,
    daysLeft,
    // The record's raw flag, so callers can tell the flag governs this plan
    // (`true` must never raise the renewal modal — including via a date timer).
    isPlanActive: recordFlagActive ? true : recordFlagInactive ? false : null,
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
