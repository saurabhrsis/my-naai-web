import { useEffect, useState } from 'react';
import { api } from './api';
import { DEFAULT_SHOP_SETTINGS } from './shopOrders';

// The shop's commerce rules (free-delivery threshold, delivery charges,
// discount %, COD limit + COD charges) are one row on the backend
// (`shop_settings`), edited by the company admin in the Shop Settings tab.
// The web shop needs them for honest copy: "free above ₹X", the discount
// line on the bill, and whether COD is even offered for the current order.
//
// One fetch per session, shared by every shop screen (list, product, cart,
// checkout). If the fetch fails — offline, or a deployment that has not
// taken the backend update yet — the defaults win, which is exactly the
// bill the server computes for an untouched settings row, so the cart can
// never show a different number than the order will be billed for.

let cached = null;
let inFlight = null;

const asNonNegative = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export function normalizeShopSettings(data) {
  return {
    freeDeliveryAbove: asNonNegative(data?.freeDeliveryAbove, DEFAULT_SHOP_SETTINGS.freeDeliveryAbove),
    deliveryFee: asNonNegative(data?.deliveryFee, DEFAULT_SHOP_SETTINGS.deliveryFee),
    discountPercent: Math.min(100, asNonNegative(data?.discountPercent, DEFAULT_SHOP_SETTINGS.discountPercent)),
    codThreshold: asNonNegative(data?.codThreshold, DEFAULT_SHOP_SETTINGS.codThreshold),
    codCharges: asNonNegative(data?.codCharges, DEFAULT_SHOP_SETTINGS.codCharges),
  };
}

export function fetchShopSettings({ force = false } = {}) {
  if (cached && !force) return Promise.resolve(cached);
  if (inFlight) return inFlight;
  inFlight = api.shopSettingsGet()
    .then(response => {
      cached = normalizeShopSettings(response?.data);
      return cached;
    })
    .catch(() => {
      cached = { ...DEFAULT_SHOP_SETTINGS };
      return cached;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

// Test-only: clear the session cache so each test starts unseeded.
// Production code never calls this.
export function resetShopSettingsCache() {
  cached = null;
  inFlight = null;
}

// React binding — starts on the cached value (or the defaults) and upgrades
// in place once the fetch resolves, so no screen ever flashes a wrong bill.
export function useShopSettings() {
  const [settings, setSettings] = useState(() => cached || { ...DEFAULT_SHOP_SETTINGS });
  useEffect(() => {
    let live = true;
    fetchShopSettings().then(value => {
      if (live) setSettings(value);
    });
    return () => {
      live = false;
    };
  }, []);
  return settings;
}
