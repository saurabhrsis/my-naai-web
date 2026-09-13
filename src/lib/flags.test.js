import { describe, it, expect } from 'vitest';
import { flagIsTrue, flagIsFalse } from './flags';

describe('flagIsTrue', () => {
  it('reads every truthy spelling the API uses', () => {
    [true, 'true', 'TRUE', ' True ', 'yes', 'Y', 1, '1'].forEach(value => {
      expect(flagIsTrue(value), String(value)).toBe(true);
    });
  });

  it('is false for negations and for a flag the API never sent', () => {
    [false, 'false', 'FALSE', 'no', 0, '0', undefined, null, '', 'maybe', {}, []].forEach(value => {
      expect(flagIsTrue(value), String(value)).toBe(false);
    });
  });
});

describe('flagIsFalse', () => {
  it('reads every falsy spelling the API uses', () => {
    [false, 'false', 'FALSE', ' False ', 'no', 'N', 0, '0'].forEach(value => {
      expect(flagIsFalse(value), String(value)).toBe(true);
    });
  });

  // The guard this protects: `flagIsFalse(profile.profileCompleted)` must not
  // read a payload that simply omits the field as "profile incomplete", or every
  // session restored from an older API response gets pushed into onboarding.
  it('is false for an absent flag, not just for truthy values', () => {
    [undefined, null, '', true, 'true', 'yes', 1, 'maybe', {}].forEach(value => {
      expect(flagIsFalse(value), String(value)).toBe(false);
    });
  });

  it('never treats a value as both true and false', () => {
    [true, 'true', false, 'false', undefined, null, '', 'maybe', 1, 0].forEach(value => {
      expect(flagIsTrue(value) && flagIsFalse(value), String(value)).toBe(false);
    });
  });
});
