import { describe, expect, it } from 'vitest';
import { PARTNER_PLANS, RENEWAL_PLANS, getSubscriptionState, normalizePlanDetails } from './planDetails';

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

  it('does not infer subscription state from the salon account status', () => {
    const state = getSubscriptionState({ planType: 'monthly', status: 'CLOSED' });
    expect(state.known).toBe(false);
    expect(state.expired).toBe(false);
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
