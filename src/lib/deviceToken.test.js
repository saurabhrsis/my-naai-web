import { describe, it, expect, vi, beforeEach } from 'vitest';

const { registerDevice, updateSalonProfile, updateProfile, getPushToken, readNotificationPermission, isPushConfigured } = vi.hoisted(() => ({
  registerDevice: vi.fn(),
  updateSalonProfile: vi.fn(),
  updateProfile: vi.fn(),
  getPushToken: vi.fn(),
  readNotificationPermission: vi.fn(),
  isPushConfigured: vi.fn(() => true),
}));

vi.mock('./api', () => ({ api: { registerDevice, updateSalonProfile, updateProfile } }));
vi.mock('./push', () => ({ getPushToken, readNotificationPermission, isPushConfigured, PUSH_TOKEN_EVENT: 'mynaai:push-token' }));

import { clearDeviceTokenSync, keepDeviceTokenSynced, syncDeviceToken } from './deviceToken';

const session = { role: 'SALON', userId: 'salon-1' };
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  registerDevice.mockResolvedValue({ status: 'SUCCESS' });
  updateSalonProfile.mockResolvedValue({ status: 'SUCCESS' });
  updateProfile.mockResolvedValue({ status: 'SUCCESS' });
  getPushToken.mockResolvedValue('token-A');
  readNotificationPermission.mockResolvedValue('granted');
  isPushConfigured.mockReturnValue(true);
});

describe('syncDeviceToken', () => {
  it('posts the token for the signed-in account once, and not again for the same pair', async () => {
    expect(await syncDeviceToken(session, 'token-A')).toBe('synced');
    expect(registerDevice).toHaveBeenCalledWith(expect.objectContaining({ deviceToken: 'token-A', platform: 'web', userType: 'SALON', userId: 'salon-1' }));
    expect(await syncDeviceToken(session, 'token-A')).toBe('skipped');
    expect(registerDevice).toHaveBeenCalledTimes(1);
  });

  it('posts again when the token rotates or another account signs in on this browser', async () => {
    await syncDeviceToken(session, 'token-A');
    expect(await syncDeviceToken(session, 'token-B')).toBe('synced');
    expect(await syncDeviceToken({ role: 'USER', userId: 'user-7' }, 'token-B')).toBe('synced');
    expect(registerDevice).toHaveBeenCalledTimes(3);
  });

  it('falls back to the existing profile-update endpoints when register-device does not exist', async () => {
    registerDevice.mockRejectedValueOnce(Object.assign(new Error('Not found'), { status: 404 }));
    expect(await syncDeviceToken(session, 'token-A')).toBe('synced');
    expect(updateSalonProfile).toHaveBeenCalledWith({ salonId: 'salon-1', deviceToken: 'token-A' });
    // …and never knocks on the missing endpoint again this session.
    expect(await syncDeviceToken(session, 'token-B')).toBe('synced');
    expect(registerDevice).toHaveBeenCalledTimes(1);
    expect(updateSalonProfile).toHaveBeenCalledTimes(2);
  });

  it('uses the customer profile endpoint for a customer session', async () => {
    registerDevice.mockRejectedValueOnce(Object.assign(new Error('Not found'), { status: 404 }));
    expect(await syncDeviceToken({ role: 'USER', userId: 'user-7' }, 'token-A')).toBe('synced');
    expect(updateProfile).toHaveBeenCalledWith({ userId: 'user-7', deviceToken: 'token-A' });
  });

  it('reports a failure without throwing, so the UI never blocks on it', async () => {
    registerDevice.mockRejectedValueOnce(new Error('boom'));
    expect(await syncDeviceToken(session, 'token-A')).toBe('failed');
    registerDevice.mockRejectedValueOnce(Object.assign(new Error('Not found'), { status: 404 }));
    updateSalonProfile.mockRejectedValueOnce(new Error('boom'));
    expect(await syncDeviceToken(session, 'token-A')).toBe('failed');
  });

  it('forgets the sync on logout so the next account gets its own registration', async () => {
    await syncDeviceToken(session, 'token-A');
    clearDeviceTokenSync();
    expect(await syncDeviceToken(session, 'token-A')).toBe('synced');
  });
});

describe('keepDeviceTokenSynced', () => {
  it('mints and syncs on start when permission is already granted, then follows token events', async () => {
    const stop = keepDeviceTokenSynced(session);
    await flush();
    expect(registerDevice).toHaveBeenCalledWith(expect.objectContaining({ deviceToken: 'token-A' }));
    window.dispatchEvent(new CustomEvent('mynaai:push-token', { detail: { token: 'token-B' } }));
    await flush();
    expect(registerDevice).toHaveBeenCalledWith(expect.objectContaining({ deviceToken: 'token-B' }));
    stop();
    window.dispatchEvent(new CustomEvent('mynaai:push-token', { detail: { token: 'token-C' } }));
    await flush();
    expect(registerDevice).toHaveBeenCalledTimes(2);
  });

  it('does nothing while notifications are not yet allowed', async () => {
    readNotificationPermission.mockResolvedValue('default');
    const stop = keepDeviceTokenSynced(session);
    await flush();
    expect(getPushToken).not.toHaveBeenCalled();
    expect(registerDevice).not.toHaveBeenCalled();
    stop();
  });
});
