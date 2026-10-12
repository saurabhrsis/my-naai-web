import { describe, expect, it } from 'vitest';
import { PARTNER_PLANS, RENEWAL_PLANS, getSubscriptionState, normalizePlanDetails } from './planDetails';

// The subscription record `renew-salon-plan` maintains on every renewal:
// planType / planStartDate / planEndDate / isPlanActive / createdAt /
// updatedAt. Built relative to now so the suite never goes stale.
const LIVE_RECORD = {
  planType: 'monthly',
  planStartDate: new Date(Date.now() - 3 * 86400000).toISOString(),
  planEndDate: new Date(Date.now() + 27 * 86400000).toISOString(),
  isPlanActive: true,
  createdAt: new Date(Date.now() - 31 * 86400000).toISOString(),
  updatedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
};

describe('subscription state', () => {
  it('marks a salon with a past expiry date as expired', () => {
    const plan = normalizePlanDetails({
      planType: 'monthly',
      planExpiryDate: new Date(Date.now() - 60_000).toISOString(),
    });

    expect(plan.expired).toBe(true);
    expect(getSubscriptionState({ planType: 'monthly', planExpiryDate: plan.expiryDate }).expired).toBe(true);
  });

  it('supports nested subscription status values', () => {
    expect(getSubscriptionState({ planType: 'quarterly', subscription: { status: 'EXPIRED' } }).expired).toBe(true);
    expect(getSubscriptionState({ planType: 'quarterly', subscription: { status: 'ACTIVE' } }).active).toBe(true);
  });

  it('lets an explicit active flag win over a stale cached expiry date', () => {
    const plan = normalizePlanDetails({
      planType: 'monthly',
      planExpiryDate: new Date(Date.now() - 60_000).toISOString(),
      subscriptionExpired: false,
    });

    expect(plan.expired).toBe(false);
    expect(plan.isActive).toBe(true);
  });

  it('trusts an explicit active plan status over an old expiry after renewal', () => {
    const state = getSubscriptionState({ planType: 'monthly', planExpiryDate: '2020-01-01', subscriptionStatus: 'ACTIVE' });
    expect(state.active).toBe(true);
  });

  it('does not infer subscription state from the salon account status', () => {
    const state = getSubscriptionState({ planType: 'monthly', status: 'CLOSED' });
    expect(state.known).toBe(false);
    expect(state.expired).toBe(false);
  });
});

describe('renewal record (planStartDate / planEndDate / isPlanActive)', () => {
  it('reads the record fields the renewal endpoint maintains', () => {
    const plan = normalizePlanDetails(LIVE_RECORD);
    expect(plan.expired).toBe(false);
    expect(plan.isActive).toBe(true);
    expect(plan.startDate).toBe(LIVE_RECORD.planStartDate);
    expect(plan.expiryDate).toBe(LIVE_RECORD.planEndDate);
    expect(plan.daysLeft).toBeGreaterThan(25);
  });

  it('keeps a renewed salon unlocked despite a stale cached subscriptionExpired flag', () => {
    // The flag this app writes had latched `true` before the renewal; the
    // record is live. The paywall must not force mode=RENEW&forceRenewal=true.
    const state = getSubscriptionState({ ...LIVE_RECORD, subscriptionExpired: true, planExpired: true });
    expect(state.expired).toBe(false);
    expect(state.active).toBe(true);
  });

  it('finds the record nested under subscription, plan or the salon object', () => {
    expect(getSubscriptionState({ salonName: 'Glamour Studio', subscription: LIVE_RECORD }).active).toBe(true);
    expect(getSubscriptionState({ salonName: 'Glamour Studio', plan: LIVE_RECORD }).active).toBe(true);
    expect(getSubscriptionState({ salon: LIVE_RECORD }).active).toBe(true);
    // Singleton-array form some releases return.
    expect(getSubscriptionState({ subscription: [LIVE_RECORD] }).active).toBe(true);
  });

  it('prefers the renewed record window over a stale legacy expiry alias', () => {
    const state = getSubscriptionState({
      ...LIVE_RECORD,
      planExpiryDate: new Date(Date.now() - 86400000).toISOString(),
    });
    expect(state.active).toBe(true);
  });

  it('prefers the backend record over a PLAN_EXPIRED status echoed in the same payload', () => {
    // The record fields are what the backend maintains (including purchases
    // made in the mobile app); a stale status code must not override them and
    // strand the partner on the paywall. The nested `status` here is one the
    // legacy chain would have trusted.
    expect(getSubscriptionState({ status: 'PLAN_EXPIRED', subscription: LIVE_RECORD }).active).toBe(true);
    expect(getSubscriptionState({ planType: 'monthly', subscription: { ...LIVE_RECORD, status: 'EXPIRED' } }).active).toBe(true);
  });

  it('locks only when the record itself is over', () => {
    const state = getSubscriptionState({
      planType: 'monthly',
      planStartDate: new Date(Date.now() - 60 * 86400000).toISOString(),
      planEndDate: new Date(Date.now() - 30 * 86400000).toISOString(),
      isPlanActive: false,
    });
    expect(state.expired).toBe(true);
  });

  it('never treats a plan with isPlanActive: true as expired — no renewal modal, even past planEndDate', () => {
    // The flag is the switch the backend maintains. While it is true the
    // renewal modal must not show — not for a passed planEndDate, and not for
    // stale expiry flags cached before the renewal.
    const state = getSubscriptionState({
      planType: 'monthly',
      planStartDate: new Date(Date.now() - 60 * 86400000).toISOString(),
      planEndDate: new Date(Date.now() - 60_000).toISOString(),
      isPlanActive: true,
      subscriptionExpired: true,
    });
    expect(state.expired).toBe(false);
    expect(state.active).toBe(true);
    expect(state.plan.isPlanActive).toBe(true);
  });

  it('treats a future planEndDate as active even when the flag is missing or falsy-but-stale', () => {
    expect(getSubscriptionState({ planType: 'monthly', planEndDate: LIVE_RECORD.planEndDate }).active).toBe(true);
    expect(getSubscriptionState({ planType: 'monthly', planEndDate: LIVE_RECORD.planEndDate, isPlanActive: false }).active).toBe(true);
  });

  it('treats isPlanActive as a veto when the record carries no window', () => {
    expect(getSubscriptionState({ planType: 'monthly', isPlanActive: false }).expired).toBe(true);
    expect(getSubscriptionState({ planType: 'monthly', isPlanActive: true }).active).toBe(true);
  });
});

describe('plan catalog', () => {
  it('prices the monthly, 2-month and 3-month plans at 199 / 299 / 499', () => {
    expect(PARTNER_PLANS.map(plan => [plan.id, plan.price])).toEqual([
      ['monthly', 199],
      ['trial_2_months', 299],
      ['quarterly', 499],
    ]);
  });

  it('charges the same for a renewal as for a new purchase', () => {
    // The two lists had drifted (renewals were still 99 / 179 / 249), so a
    // partner saw one price on the card and was charged another.
    expect(RENEWAL_PLANS.map(plan => plan.price)).toEqual(PARTNER_PLANS.map(plan => plan.price));
    expect(RENEWAL_PLANS.map(plan => plan.id)).toEqual(PARTNER_PLANS.map(plan => plan.id));
    expect(RENEWAL_PLANS.map(plan => plan.duration)).toEqual(PARTNER_PLANS.map(plan => plan.duration));
  });

  it('labels an active plan with its catalog price and duration', () => {
    const plan = normalizePlanDetails({ planType: 'quarterly', planExpiryDate: new Date(Date.now() + 86_400_000).toISOString() });
    expect(plan.title).toBe('Quarterly Plan');
    expect(plan.price).toBe(499);
    expect(plan.duration).toBe('3 Months (90 Days)');
  });
});
