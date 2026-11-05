import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DEFAULT_FREE_TRIAL,
  DEFAULT_PARTNER_PLANS,
  PLAN_CACHE_KEY,
  activePlans,
  describeDuration,
  fetchPlanCatalog,
  freeTrialPlan,
  normalizePlanCatalog,
  planById,
  readCachedPlanCatalog,
  renewalPlans,
  resetPlanCatalogCache,
  usePlanCatalog,
} from './planCatalog';
import { FREE_ONBOARDING_PLAN, PARTNER_PLANS, PLAN_PRICES, plansForScreen, setLivePlanCatalog, normalizePlanDetails } from './planDetails';

const { salonPlanList } = vi.hoisted(() => ({ salonPlanList: vi.fn() }));

vi.mock('./api', async () => {
  const actual = await vi.importActual('./api');
  return { ...actual, api: { ...actual.api, salonPlanList } };
});

beforeEach(() => {
  resetPlanCatalogCache();
  salonPlanList.mockReset();
  salonPlanList.mockRejectedValue(new Error('Not Found'));
});

describe('the seeded catalog', () => {
  it('is the plan list the portal already charged', () => {
    expect(DEFAULT_PARTNER_PLANS.map(plan => plan.id)).toEqual(['monthly', 'trial_2_months', 'quarterly']);
    expect(PLAN_PRICES).toEqual({ monthly: 199, trial_2_months: 299, quarterly: 499 });
    // Ids are fixed: subscription rows and the mobile app store them.
    expect(PARTNER_PLANS.map(plan => plan.id)).toEqual(DEFAULT_PARTNER_PLANS.map(plan => plan.id));
  });

  it('starts a new salon on a 90-day free trial', () => {
    // The client asked for 90 days; the bundle used to say 20.
    expect(DEFAULT_FREE_TRIAL.days).toBe(90);
    expect(FREE_ONBOARDING_PLAN.duration).toBe('3 Months (90 Days)');
    expect(FREE_ONBOARDING_PLAN.price).toBe(0);
  });

  it('describes a duration from its days, never from a stored string', () => {
    expect(describeDuration(30)).toBe('1 Month (30 Days)');
    expect(describeDuration(60)).toBe('2 Months (60 Days)');
    expect(describeDuration(90)).toBe('3 Months (90 Days)');
    expect(describeDuration(45)).toBe('45 Days');
    expect(describeDuration(0)).toBe('');
  });
});

describe('reading the admin panel’s catalog', () => {
  it('accepts the documented shape', () => {
    const catalog = normalizePlanCatalog({
      status: 'SUCCESS',
      data: {
        plans: [
          { id: 'quarterly', title: 'Quarterly Plan', price: 599, days: 90, sortOrder: 2, best: true },
          { id: 'monthly', title: 'Monthly Plan', price: 249, days: 30, sortOrder: 0 },
        ],
        freeTrial: { days: 90, title: 'Free trial' },
      },
    });
    expect(catalog.source).toBe('server');
    // The admin's order, not the payload's.
    expect(catalog.plans.map(plan => plan.id)).toEqual(['monthly', 'quarterly']);
    // The admin's NEW price and the derived duration.
    expect(catalog.plans[0]).toMatchObject({ price: 249, days: 30, duration: '1 Month (30 Days)' });
    expect(catalog.freeTrial.days).toBe(90);
  });

  it('accepts a bare array, a nested list and a decimal price', () => {
    expect(normalizePlanCatalog([{ planId: 'monthly', price: '249.00', durationDays: 30 }]).plans[0])
      .toMatchObject({ id: 'monthly', price: 249, days: 30 });
    expect(normalizePlanCatalog({ data: { planList: [{ plan_id: 'quarterly', amount: 499, duration: 90 }] } }).plans[0])
      .toMatchObject({ id: 'quarterly', price: 499, days: 90 });
  });

  it('refuses an answer with no plans instead of blanking the picker', () => {
    expect(normalizePlanCatalog({ status: 'SUCCESS', data: {} })).toBeNull();
    expect(normalizePlanCatalog(null)).toBeNull();
  });

  it('keeps the seed when the endpoint is not deployed', async () => {
    const catalog = await fetchPlanCatalog();
    expect(catalog.source).toBe('seed');
    expect(catalog.plans.map(plan => plan.id)).toEqual(DEFAULT_PARTNER_PLANS.map(plan => plan.id));
    expect(activePlans(catalog).length).toBe(3);
  });

  it('serves the server list, then remembers it', async () => {
    salonPlanList.mockResolvedValue({
      status: 'SUCCESS',
      data: { plans: [{ id: 'monthly', title: 'Monthly', price: 349, days: 30 }, { id: 'quarterly', title: 'Quarterly', price: 899, days: 90 }] },
    });
    const catalog = await fetchPlanCatalog();
    expect(catalog.source).toBe('server');
    expect(catalog.plans.find(plan => plan.id === 'monthly').price).toBe(349);

    // Cached: a second read (a remount, a second tab) needs no request.
    expect(readCachedPlanCatalog().plans.find(plan => plan.id === 'monthly').price).toBe(349);
    expect(JSON.parse(localStorage.getItem(PLAN_CACHE_KEY)).plans.length).toBe(2);
  });

  it('hides a plan the admin switched off, and never renders an empty picker', () => {
    const catalog = normalizePlanCatalog({
      plans: [
        { id: 'monthly', price: 199, days: 30, isActive: true },
        { id: 'quarterly', price: 499, days: 90, isActive: false },
      ],
    });
    expect(activePlans(catalog).map(plan => plan.id)).toEqual(['monthly']);
    const allOff = normalizePlanCatalog({ plans: [{ id: 'quarterly', price: 499, days: 90, isActive: false }] });
    // Everything off = the seed, because a salon must always be able to buy.
    expect(activePlans(allOff).map(plan => plan.id)).toEqual(DEFAULT_PARTNER_PLANS.map(plan => plan.id));
  });

  it('charges a renewal the catalog price, not the old ladder', () => {
    const catalog = normalizePlanCatalog({ plans: [{ id: 'monthly', price: 349, days: 30, note: 'Fresh note' }] });
    expect(renewalPlans(catalog)[0].price).toBe(349);
    expect(plansForScreen(catalog, { isUpgrade: true })[0].price).toBe(349);
    expect(freeTrialPlan(catalog).price).toBe(0);
  });

  it('names an active subscription with the admin’s title', () => {
    const catalog = normalizePlanCatalog({ plans: [{ id: 'quarterly', title: 'Salon Growth Quarterly', price: 899, days: 90 }] });
    setLivePlanCatalog(catalog);
    const plan = normalizePlanDetails({ planType: 'quarterly', planEndDate: new Date(Date.now() + 86400000).toISOString() });
    expect(plan.title).toBe('Salon Growth Quarterly');
    expect(plan.price).toBe(899);
    expect(plan.duration).toBe('3 Months (90 Days)');
    // A stored id the catalog no longer lists still resolves to something.
    expect(planById(catalog, 'quarterly').title).toBe('Salon Growth Quarterly');
    expect(planById(catalog, 'retired-plan')).toBeNull();
    setLivePlanCatalog(null);
    expect(normalizePlanDetails({ planType: 'quarterly' }).title).toBe('Quarterly Plan');
  });

  it('exposes a hook that starts from the seed and swaps in the server list', async () => {
    expect(typeof usePlanCatalog).toBe('function');
  });
});
