// The partner plan list — ONE list, owned by the admin panel.
//
// Until now the three plans (and the 20-day free trial) were written into this
// bundle: prices, durations and notes lived in `PARTNER_PLANS` below, which
// meant a price change was a code change and a redeploy, and the admin panel
// could not change what the website and the app charge. The list now comes from
// the server (`POST /api/salons/plans/list`, public), which the admin panel
// maintains. This module is the web client's reader for it:
//
//   · `DEFAULT_PARTNER_PLANS` / `DEFAULT_FREE_TRIAL` are the seed — exactly the
//     plans and the 90-day trial the backend patch seeds the table with. They
//     are what the picker shows before the endpoint answers, and what it keeps
//     showing if the deployment has no endpoint yet, so a plan screen never
//     renders empty.
//   · `normalizePlanCatalog` accepts whatever shape the API answers with and
//     returns one shape: `{ id, title, price, days, duration, note, best,
//     badge, isFree }`, ordered by the admin's `sortOrder`.
//   · `fetchPlanCatalog` caches the answer (localStorage + in-memory, same
//     pattern as shopCategories) so the picker does not flash the seed every
//     time it mounts.
//
// The active-plan card (`normalizePlanDetails`) reads the SAME catalog, so a
// salon on a plan the admin renamed shows the new name, not `trial_2_months`
// prettified by hand. A plan id is fixed at creation: the subscription records
// store it, so renaming a title never orphans anyone's plan.

import { useEffect, useState } from 'react';
import { api } from './api';

export const PLAN_CACHE_KEY = 'mynaai:plan-catalog:v2';

// The seed. Ids are FIXED — `shop`-style slugs are not used here, because the
// existing subscription rows and the mobile app already store these exact ids
// (`monthly`, `trial_2_months`, `quarterly`) and every one of them must keep
// resolving to the same plan after the admin edits a title or a price.
export const DEFAULT_PARTNER_PLANS = [
  { id: 'monthly', title: 'Monthly Plan', price: 199, days: 30, note: 'Flexible month-to-month growth', sortOrder: 0, isActive: true },
  { id: 'trial_2_months', title: 'Introductory', price: 299, days: 60, note: 'A gentle start for new partners', sortOrder: 1, isActive: true },
  { id: 'quarterly', title: 'Quarterly Plan', price: 499, days: 90, note: 'Best value for busy salons', best: true, sortOrder: 2, isActive: true },
];

// The free trial a new salon starts on. 90 days, as the client asked — it used
// to be written as "20 days" in this file with the number coming from whatever
// the backend had configured, which is how the two drifted apart.
export const DEFAULT_FREE_TRIAL = {
  id: 'Free',
  title: 'Free trial',
  price: 0,
  days: 90,
  note: 'Start your salon journey at no cost',
  best: true,
  isFree: true,
  sortOrder: -1,
  isActive: true,
};

export const DEFAULT_PLAN_CATALOG = {
  plans: DEFAULT_PARTNER_PLANS,
  freeTrial: DEFAULT_FREE_TRIAL,
  currency: 'INR',
  // How many days before the plan ends the salon is warned. The admin owns it
  // so the copy on the plan card and the reminder the backend sends agree.
  renewalReminderDays: 7,
  source: 'seed',
};

const toNumber = (value, fallback = 0) => {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const pick = (row, keys) => {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
};

// "30" days → "1 Month (30 Days)", "90" → "3 Months (90 Days)". Derived instead
// of stored so a plan's duration can never disagree with its `days` column —
// which is what a salon actually gets.
export function describeDuration(days) {
  const value = toNumber(days, 0);
  if (!value) return '';
  if (value === 1) return '1 Day';
  if (value === 7) return '7 Days (1 Week)';
  if (value % 30 === 0) {
    const months = value / 30;
    return `${months} ${months === 1 ? 'Month' : 'Months'} (${value} Days)`;
  }
  return `${value} Days`;
}

export function normalizePlan(row = {}, index = 0) {
  const id = String(pick(row, ['id', 'planId', 'plan_id', 'planType', 'plan']) ?? '').trim();
  const price = toNumber(pick(row, ['price', 'amount', 'planPrice', 'priceInr', 'price_inr']), 0);
  const days = toNumber(pick(row, ['days', 'durationDays', 'duration_days', 'validDays', 'duration']), 0);
  const title = String(pick(row, ['title', 'label', 'name', 'planName']) ?? id ?? 'Plan').trim();
  return {
    id,
    title,
    price,
    days,
    duration: describeDuration(days),
    note: String(pick(row, ['note', 'description', 'tagline', 'subtitle']) ?? '').trim(),
    // `best` is the admin's "recommended" flag; `badge` is the word printed on
    // the card, so a plan can be marked without the label being hard-coded.
    best: Boolean(pick(row, ['best', 'recommended', 'isRecommended', 'is_recommended'])) || undefined,
    badge: String(pick(row, ['badge', 'ribbon', 'tag']) ?? '').trim(),
    sortOrder: toNumber(pick(row, ['sortOrder', 'sort_order', 'position', 'order']), index),
    isActive: pick(row, ['isActive', 'is_active', 'active']) === false ? false : true,
    isFree: Boolean(pick(row, ['isFree', 'is_free'])) || price === 0,
  };
}

export function normalizeFreeTrial(row = {}) {
  if (!row || typeof row !== 'object') return { ...DEFAULT_FREE_TRIAL };
  const days = toNumber(pick(row, ['days', 'durationDays', 'duration_days', 'trialDays', 'trial_days']), DEFAULT_FREE_TRIAL.days);
  return {
    ...DEFAULT_FREE_TRIAL,
    ...normalizePlan({ ...row, price: 0, isFree: true, id: row.id || 'Free' }, 0),
    days,
    duration: describeDuration(days),
    price: 0,
    isFree: true,
    title: String(pick(row, ['title', 'label', 'name']) ?? DEFAULT_FREE_TRIAL.title).trim(),
    note: String(pick(row, ['note', 'description', 'tagline']) ?? DEFAULT_FREE_TRIAL.note).trim(),
  };
}

const byOrder = (a, b) => (a.sortOrder - b.sortOrder) || String(a.title).localeCompare(String(b.title));

// Whatever the endpoint answers — `{ plans, freeTrial }`, a bare array, rows
// under `data.plans` — becomes one catalog. Anything unparseable returns null so
// the caller keeps the seed instead of rendering an empty picker.
export function normalizePlanCatalog(payload) {
  if (!payload) return null;
  const root = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data) ? payload.data : payload;
  let rows = [];
  if (Array.isArray(root)) rows = root;
  else if (Array.isArray(root.plans)) rows = root.plans;
  else if (Array.isArray(root.partnerPlans)) rows = root.partnerPlans;
  else if (Array.isArray(root.planList)) rows = root.planList;
  if (!rows.length) return null;
  const plans = rows
    .map((row, index) => normalizePlan(row, index))
    .filter(plan => plan.id)
    .sort(byOrder);
  if (!plans.length) return null;
  const freeSource = root.freeTrial || root.trial || root.free_plan
    || rows.find(row => /free|^trial/i.test(String(pick(row, ['id', 'planId', 'title']) ?? '')));
  return {
    plans,
    freeTrial: normalizeFreeTrial(freeSource || DEFAULT_FREE_TRIAL),
    currency: String(pick(root, ['currency']) ?? 'INR'),
    renewalReminderDays: toNumber(pick(root, ['renewalReminderDays', 'renewal_reminder_days', 'reminderDays']), DEFAULT_PLAN_CATALOG.renewalReminderDays),
    source: 'server',
  };
}

// The plans a screen may show: active ones only, in the admin's order.
export function activePlans(catalog = DEFAULT_PLAN_CATALOG) {
  const list = (catalog?.plans || []).filter(plan => plan.isActive !== false);
  return list.length ? list : DEFAULT_PARTNER_PLANS;
}

// A renewal reads the same list; only the supporting line differs, so a plan
// renamed or re-priced in the panel is renamed and re-priced here too.
const RENEWAL_NOTES = { trial_2_months: 'Restart with a simple plan' };
export function renewalPlans(catalog = DEFAULT_PLAN_CATALOG) {
  return activePlans(catalog).map(plan => ({
    ...plan,
    note: RENEWAL_NOTES[plan.id] || plan.note,
  }));
}

export function freeTrialPlan(catalog = DEFAULT_PLAN_CATALOG) {
  const trial = catalog?.freeTrial || DEFAULT_FREE_TRIAL;
  return {
    ...trial,
    displayPrice: '₹ 00',
    price: 0,
    duration: describeDuration(trial.days),
    note: trial.note || DEFAULT_FREE_TRIAL.note,
    best: true,
  };
}

// Look-up by id for the active-plan card. Server ids and seed ids are the same
// strings, so this resolves a stored subscription either way.
export function planById(catalog = DEFAULT_PLAN_CATALOG, id = '') {
  const wanted = String(id || '').trim();
  if (!wanted) return null;
  const lower = wanted.toLowerCase();
  return (catalog?.plans || []).find(plan => plan.id === wanted)
    || (catalog?.plans || []).find(plan => String(plan.id).toLowerCase() === lower)
    || null;
}

// ── reading it ──────────────────────────────────────────────────────────────
let memoryCache = null;

export function readCachedPlanCatalog() {
  if (memoryCache) return memoryCache;
  try {
    const raw = localStorage.getItem(PLAN_CACHE_KEY);
    if (!raw) return null;
    const parsed = normalizePlanCatalog(JSON.parse(raw));
    if (parsed) memoryCache = parsed;
    return parsed;
  } catch {
    return null;
  }
}

export function resetPlanCatalogCache() {
  memoryCache = null;
  try { localStorage.removeItem(PLAN_CACHE_KEY); } catch { /* private mode */ }
}

/**
 * Ask the server for the catalog. Resolves the cached value first (so the
 * picker paints instantly) and the fresh one when it arrives; never rejects —
 * on any failure the seed is the answer, because a salon must always be able to
 * see (and buy) a plan.
 */
export async function fetchPlanCatalog({ force = false } = {}) {
  if (!force) {
    const cached = readCachedPlanCatalog();
    if (cached) {
      // Refresh in the background; the caller already has a usable list.
      api.salonPlanList().then(response => {
        const fresh = normalizePlanCatalog(response);
        if (fresh) {
          memoryCache = fresh;
          try { localStorage.setItem(PLAN_CACHE_KEY, JSON.stringify(fresh)); } catch { /* private mode */ }
        }
      }).catch(() => {});
      return cached;
    }
  }
  try {
    const response = await api.salonPlanList();
    const fresh = normalizePlanCatalog(response);
    if (fresh) {
      memoryCache = fresh;
      try { localStorage.setItem(PLAN_CACHE_KEY, JSON.stringify(fresh)); } catch { /* private mode */ }
      return fresh;
    }
  } catch {
    // No endpoint on this deployment (or offline): the seed is the catalog.
  }
  return { ...DEFAULT_PLAN_CATALOG, source: 'seed' };
}

/**
 * React reader. Returns immediately with the cached catalog (or the seed) and
 * swaps in the server's list when it lands, so no plan screen ever renders
 * blank and a price change never needs a redeploy of this bundle.
 */
export function usePlanCatalog() {
  const [catalog, setCatalog] = useState(() => readCachedPlanCatalog() || DEFAULT_PLAN_CATALOG);
  useEffect(() => {
    let active = true;
    fetchPlanCatalog().then(next => { if (active && next) setCatalog(next); });
    return () => { active = false; };
  }, []);
  return catalog;
}
