import { describe, expect, it, vi, beforeEach } from 'vitest';

const { shopSettingsGet } = vi.hoisted(() => ({ shopSettingsGet: vi.fn() }));

vi.mock('./api', async () => {
  const actual = await vi.importActual('./api');
  return { ...actual, api: { ...actual.api, shopSettingsGet } };
});

// Import AFTER vi.mock so the mocked api is what the module sees.
import { fetchShopSettings, normalizeShopSettings, resetShopSettingsCache } from './shopSettings';
import { DEFAULT_SHOP_SETTINGS } from './shopOrders';

beforeEach(() => {
  resetShopSettingsCache();
  shopSettingsGet.mockReset();
});

describe('normalizeShopSettings', () => {
  it('passes clean values through', () => {
    expect(normalizeShopSettings({ freeDeliveryAbove: 500, deliveryFee: 40, discountPercent: 10, codThreshold: 1000, codCharges: 25 }))
      .toEqual({ freeDeliveryAbove: 500, deliveryFee: 40, discountPercent: 10, codThreshold: 1000, codCharges: 25 });
  });

  it('falls back field-by-field for missing, negative or NaN values', () => {
    const settings = normalizeShopSettings({ freeDeliveryAbove: -5, deliveryFee: 'abc', discountPercent: 250 });
    expect(settings.freeDeliveryAbove).toBe(DEFAULT_SHOP_SETTINGS.freeDeliveryAbove);
    expect(settings.deliveryFee).toBe(DEFAULT_SHOP_SETTINGS.deliveryFee);
    expect(settings.discountPercent).toBe(100); // clamped, not 250
    expect(settings.codThreshold).toBe(0);
    expect(settings.codCharges).toBe(0);
  });

  it('accepts an empty response (brand-new settings row shape)', () => {
    expect(normalizeShopSettings(undefined)).toEqual(DEFAULT_SHOP_SETTINGS);
  });
});

describe('fetchShopSettings', () => {
  it('fetches once per session and reuses the cache', async () => {
    shopSettingsGet.mockResolvedValue({
      status: 'SUCCESS',
      data: { freeDeliveryAbove: 600, deliveryFee: 30, discountPercent: 5, codThreshold: 0, codCharges: 10 },
    });
    const first = await fetchShopSettings();
    const second = await fetchShopSettings();
    expect(first).toBe(second);
    expect(shopSettingsGet).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({ freeDeliveryAbove: 600, deliveryFee: 30 });
  });

  it('dedupes concurrent fetches', async () => {
    shopSettingsGet.mockResolvedValue({
      status: 'SUCCESS',
      data: { freeDeliveryAbove: 600, deliveryFee: 30, discountPercent: 0, codThreshold: 0, codCharges: 0 },
    });
    const [a, b] = await Promise.all([fetchShopSettings(), fetchShopSettings()]);
    expect(a).toBe(b);
    expect(shopSettingsGet).toHaveBeenCalledTimes(1);
  });

  it('falls back to the shipped defaults when the endpoint is unreachable', async () => {
    shopSettingsGet.mockRejectedValue(new Error('offline'));
    await expect(fetchShopSettings()).resolves.toEqual(DEFAULT_SHOP_SETTINGS);
  });
});
