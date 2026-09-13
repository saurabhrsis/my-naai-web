import { describe, it, expect } from 'vitest';
import {
  getSalonSubscriptionProfile,
  getSalonSubscriptionState,
  hasCoordinate,
  salonProfileNeedsCompletion,
} from './salonProfile';

const completeProfile = {
  salonName: 'Glamour Studio',
  ownerName: 'Ravi',
  addressLine1: 'Sitabuldi, Nagpur',
  genderType: 'MALE',
  latitude: 21.12,
  longitude: 79.08,
  services: [{ serviceId: 's1', serviceName: 'Haircut', price: 250 }],
  businessHours: [{ openingTime: '10:00', closingTime: '20:00' }],
  profileCompleted: true,
};

describe('hasCoordinate', () => {
  it('accepts numbers and numeric strings', () => {
    expect(hasCoordinate(21.12)).toBe(true);
    expect(hasCoordinate('79.08')).toBe(true);
    expect(hasCoordinate(0)).toBe(true);
  });

  it('rejects the values that mean "no location yet"', () => {
    ['', null, undefined, 'abc', NaN, Infinity].forEach(value => {
      expect(hasCoordinate(value), String(value)).toBe(false);
    });
  });
});

describe('salonProfileNeedsCompletion', () => {
  it('is false for a complete profile', () => {
    expect(salonProfileNeedsCompletion(completeProfile)).toBe(false);
  });

  it('is true when the API flags the salon as new or incomplete', () => {
    expect(salonProfileNeedsCompletion({ ...completeProfile, profileCompleted: false })).toBe(true);
    // The API sends this as a string on some endpoints.
    expect(salonProfileNeedsCompletion({ ...completeProfile, profileCompleted: 'false' })).toBe(true);
    expect(salonProfileNeedsCompletion({ ...completeProfile, isNewSalon: true })).toBe(true);
    expect(salonProfileNeedsCompletion({ ...completeProfile, isNewSalon: 'true' })).toBe(true);
  });

  it('is true when a field a customer needs is missing', () => {
    expect(salonProfileNeedsCompletion({ ...completeProfile, salonName: '  ' })).toBe(true);
    expect(salonProfileNeedsCompletion({ ...completeProfile, ownerName: '' })).toBe(true);
    expect(salonProfileNeedsCompletion({ ...completeProfile, addressLine1: '' })).toBe(true);
    expect(salonProfileNeedsCompletion({ ...completeProfile, genderType: '' })).toBe(true);
    expect(salonProfileNeedsCompletion({ ...completeProfile, latitude: null })).toBe(true);
    expect(salonProfileNeedsCompletion({ ...completeProfile, services: [] })).toBe(true);
    expect(salonProfileNeedsCompletion({ ...completeProfile, businessHours: [] })).toBe(true);
    expect(salonProfileNeedsCompletion({ ...completeProfile, businessHours: [{ openingTime: '10:00' }] })).toBe(true);
  });

  it('is true for an empty or malformed payload rather than letting it through', () => {
    expect(salonProfileNeedsCompletion({})).toBe(true);
    expect(salonProfileNeedsCompletion(null)).toBe(true);
    expect(salonProfileNeedsCompletion(undefined)).toBe(true);
  });
});

describe('getSalonSubscriptionProfile', () => {
  it('reads plan fields flattened onto the session user', () => {
    const session = { user: { ...completeProfile, planType: 'monthly', expiryDate: '2030-01-01' } };
    expect(getSalonSubscriptionProfile(session).planType).toBe('monthly');
  });

  it('reads plan fields nested under user.salon, which wins over the user root', () => {
    const session = { user: { planType: 'monthly', salon: { ...completeProfile, planType: 'quarterly' } } };
    expect(getSalonSubscriptionProfile(session).planType).toBe('quarterly');
  });

  it('tolerates a session with no user object', () => {
    expect(getSalonSubscriptionProfile(null)).toEqual({});
    expect(getSalonSubscriptionProfile({})).toEqual({});
  });
});

describe('getSalonSubscriptionState', () => {
  it('reports an active plan as active', () => {
    const session = { user: { planType: 'monthly', expiryDate: new Date(Date.now() + 86400000).toISOString() } };
    const state = getSalonSubscriptionState(session);
    expect(state.expired).toBe(false);
    expect(state.active).toBe(true);
  });

  it('reports a past expiry date as expired', () => {
    const session = { user: { planType: 'monthly', expiryDate: '2020-01-01' } };
    expect(getSalonSubscriptionState(session).expired).toBe(true);
  });

  it('honours an explicit subscriptionExpired flag over a stale date', () => {
    // Right after a renewal the cached profile can still carry yesterday's
    // expiry date while the renewal response already says the plan is live.
    const session = { user: { planType: 'monthly', expiryDate: '2020-01-01', subscriptionExpired: false } };
    expect(getSalonSubscriptionState(session).expired).toBe(false);
  });

  // A payload that omits the plan entirely is "unknown", never "expired" —
  // otherwise a partner gets locked out of the dashboard by an old API response.
  it('does not treat a missing plan as expired', () => {
    const state = getSalonSubscriptionState({ user: { ...completeProfile } });
    expect(state.expired).toBe(false);
    expect(state.known).toBe(false);
  });
});
