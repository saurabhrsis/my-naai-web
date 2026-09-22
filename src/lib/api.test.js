import { describe, it, expect, vi, beforeEach } from 'vitest';

// Avoid importing the whole network chain; test the token helpers that back the
// service-worker auth mirror and the session shape used across the app.
import { api, ApiError, getFileUrl, getToken, isPlanExpiredResponse, isUnknownSalonResponse, setToken, getServerUrl, resetPlanExpiredAlert } from './api';

beforeEach(() => {
  localStorage.clear();
  window.indexedDB = { open: vi.fn() };
  resetPlanExpiredAlert();
  vi.unstubAllGlobals();
});

describe('token helpers', () => {
  it('starts empty', () => {
    expect(getToken()).toBe('');
  });

  it('setToken writes a JSON payload and getToken reads it back', () => {
    setToken('abc123');
    expect(getToken()).toBe('abc123');
    const stored = JSON.parse(localStorage.getItem('mynaai'));
    expect(stored.token).toBe('abc123');
  });

  it('getToken tolerates a raw (non-JSON) stored value', () => {
    localStorage.setItem('mynaai', 'raw-token');
    expect(getToken()).toBe('raw-token');
  });
});

describe('getServerUrl', () => {
  it('never throws and returns a string', () => {
    expect(typeof getServerUrl()).toBe('string');
  });
});

describe('getFileUrl', () => {
  it('builds the mobile app’s /getFiles path for a bare upload path', () => {
    expect(getFileUrl('ads/banner.jpg').endsWith('/getFiles/ads/banner.jpg')).toBe(true);
  });

  // Ads come back as `/public/uploads/<file>.jpg`. Prefixing only absolute-path
  // inputs used to hand back `https://backend.mynaai.in/public/uploads/…`, which
  // the backend does not serve, so every carousel image 404’d.
  it('routes a leading-slash upload path through /getFiles', () => {
    const url = getFileUrl('/public/uploads/1786449506315-698102274.jpg');
    expect(url.endsWith('/getFiles/public/uploads/1786449506315-698102274.jpg')).toBe(true);
    expect(url).not.toMatch(/getFiles\/+getFiles/);
    expect(url.replace(/^https?:\/\//, '')).not.toContain('//');
  });

  it('keeps the exact case-sensitive route spelling and never doubles it', () => {
    expect(getFileUrl('/getFiles/ads/one.jpg').endsWith('/getFiles/ads/one.jpg')).toBe(true);
    expect(getFileUrl('/getfiles/ads/one.jpg').endsWith('/getFiles/ads/one.jpg')).toBe(true);
    expect(getFileUrl('getFiles/ads/one.jpg').endsWith('/getFiles/ads/one.jpg')).toBe(true);
  });

  it('repairs an absolute backend URL that skipped the route', () => {
    expect(getFileUrl('https://backend.mynaai.in/public/uploads/1786449506315-698102274.jpg'))
      .toBe('https://backend.mynaai.in/getFiles/public/uploads/1786449506315-698102274.jpg');
    expect(getFileUrl('https://backend.mynaai.in/getFiles/public/uploads/a.jpg'))
      .toBe('https://backend.mynaai.in/getFiles/public/uploads/a.jpg');
  });

  it('keeps foreign absolute URLs and local asset paths unchanged', () => {
    expect(getFileUrl('https://cdn.example/ad.jpg')).toBe('https://cdn.example/ad.jpg');
    expect(getFileUrl('/assets/brand/naai-logo-dark.svg')).toBe('/assets/brand/naai-logo-dark.svg');
  });

  it('returns an empty string for empty or prefix-only values', () => {
    expect(getFileUrl('')).toBe('');
    expect(getFileUrl('   ')).toBe('');
    expect(getFileUrl('/getFiles/')).toBe('');
    expect(getFileUrl(null)).toBe('');
  });
});

describe('plan expiry response handling', () => {
  it('dispatches one global event when any API returns PLAN_EXPIRED', async () => {
    const expired = vi.fn();
    window.addEventListener('mynaai:plan-expired', expired);
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: false,
      status: 403,
      text: () => Promise.resolve(JSON.stringify({ error: 'PLAN_EXPIRED' })),
    })));

    await expect(api.customerList({ salonId: 'salon-1' })).rejects.toThrow();
    await expect(api.customerList({ salonId: 'salon-1' })).rejects.toThrow();

    expect(expired).toHaveBeenCalledTimes(1);
    expect(expired.mock.calls[0][0].detail.data.error).toBe('PLAN_EXPIRED');
    window.removeEventListener('mynaai:plan-expired', expired);
  });
});

// The salon shell and the sign-in preflight classify raw API values with these
// two predicates. Both were referenced from src/App.jsx without existing, which
// is what crashed the signed-in shell, so their real behaviour is pinned here.
describe('isPlanExpiredResponse', () => {
  it('recognises PLAN_EXPIRED in every place the backend puts it', () => {
    expect(isPlanExpiredResponse({ status: 'PLAN_EXPIRED' })).toBe(true);
    expect(isPlanExpiredResponse({ code: 'plan_expired' })).toBe(true);
    expect(isPlanExpiredResponse({ data: { errorCode: 'PLAN_EXPIRED' } })).toBe(true);
    expect(isPlanExpiredResponse(new ApiError('Renew to continue', 403, { status: 'PLAN_EXPIRED' }))).toBe(true);
  });

  it('is false for any other failure, including network and JWT errors', () => {
    expect(isPlanExpiredResponse(null)).toBe(false);
    expect(isPlanExpiredResponse({ status: 'SUCCESS' })).toBe(false);
    expect(isPlanExpiredResponse({ status: 'JWT_FAILED' })).toBe(false);
    expect(isPlanExpiredResponse(new Error('Failed to fetch'))).toBe(false);
    expect(isPlanExpiredResponse(new ApiError('Server error', 500, null))).toBe(false);
  });
});

describe('isUnknownSalonResponse', () => {
  it('recognises a salon the login endpoint does not know', () => {
    expect(isUnknownSalonResponse({ status: 'SALON_NOT_FOUND' })).toBe(true);
    expect(isUnknownSalonResponse({ status: 'NOT_REGISTERED' })).toBe(true);
    expect(isUnknownSalonResponse({ data: { code: 'salon_not_found' } })).toBe(true);
    expect(isUnknownSalonResponse(new ApiError('Salon not found for this number', 404, null))).toBe(true);
    expect(isUnknownSalonResponse(new ApiError('No salon registered yet', 400, null))).toBe(true);
    expect(isUnknownSalonResponse(new ApiError('Request failed (404)', 404, null))).toBe(true);
  });

  // The dangerous false positive: a wrong OTP or an outage must not be read as
  // "this partner has no salon", which would push an existing salon into the
  // registration flow.
  it('is false for unrelated failures', () => {
    expect(isUnknownSalonResponse(null)).toBe(false);
    expect(isUnknownSalonResponse({ status: 'SUCCESS' })).toBe(false);
    expect(isUnknownSalonResponse({ message: 'OTP did not match' })).toBe(false);
    expect(isUnknownSalonResponse({ message: 'OTP not found or expired' })).toBe(false);
    expect(isUnknownSalonResponse(new ApiError('Too many requests', 429, null))).toBe(false);
    expect(isUnknownSalonResponse(new ApiError('Server error', 500, null))).toBe(false);
    expect(isUnknownSalonResponse(new Error('Failed to fetch'))).toBe(false);
  });
});

describe('request timeout and network failures', () => {
  it('turns a request that never answers into a retryable error instead of an endless loader', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('fetch', vi.fn((url, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      })));
      const pending = api.bookingRequestOwnerAction('req-1', { action: 'ACCEPT' });
      const settled = pending.then(() => 'resolved', error => error);
      await vi.advanceTimersByTimeAsync(26000);
      const error = await settled;
      expect(error).toBeInstanceOf(ApiError);
      expect(error.message).toMatch(/took too long/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it('names a dropped connection in plain words', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(api.bookingRequestOwnerAction('req-1', { action: 'REJECT' })).rejects.toThrow(/Could not reach My Naai/);
  });

  it('sends the owner action as an object, like the mobile app', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ status: 'SUCCESS' }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    await api.bookingRequestOwnerAction('req-9', { action: 'ACCEPT' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/bookingRequest/owner-action/req-9/');
    expect(JSON.parse(init.body)).toEqual({ action: 'ACCEPT' });
  });

  it('registers the browser device token on the authenticated endpoint', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ status: 'SUCCESS' }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    setToken('salon-jwt');
    await api.registerDevice({ deviceToken: 'fcm-web-token', platform: 'web' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/notifications/register-device');
    expect(init.headers.Authorization).toBe('Bearer salon-jwt');
    expect(JSON.parse(init.body)).toMatchObject({ deviceToken: 'fcm-web-token', platform: 'web' });
  });
});
