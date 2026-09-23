import { describe, expect, it } from 'vitest';
import { normalizeDeviceToken, withDeviceToken } from './apiPayload';

describe('device-token payloads', () => {
  it('trims a live Firebase token before sending it', () => {
    expect(normalizeDeviceToken('  live-fcm-token  ')).toBe('live-fcm-token');
    expect(withDeviceToken({ phoneNumber: '9876543210' }, '  live-fcm-token  ')).toEqual({
      phoneNumber: '9876543210',
      deviceToken: 'live-fcm-token',
    });
  });

  it('never sends an empty, non-string or stale-looking placeholder value', () => {
    expect(normalizeDeviceToken('')).toBe('');
    expect(normalizeDeviceToken('   ')).toBe('');
    expect(normalizeDeviceToken(null)).toBe('');
    expect(normalizeDeviceToken({ token: 'live-fcm-token' })).toBe('');
    expect(withDeviceToken({ otp: '123456' }, '')).toEqual({ otp: '123456' });
    expect(withDeviceToken({ otp: '123456' }, { token: 'live-fcm-token' })).toEqual({ otp: '123456' });
  });
});
