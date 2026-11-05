// ONE product-category list, for the website, the app and the admin panel.
//
// The admin panel is where a category is created ("Hair care", "Tools &
// equipment", …) and where a product is filed under one. The storefront must
// show exactly those categories — the same labels, the same order — or a filter
// the admin sees in the panel cannot be found by a customer, and a product
// filed under a category nobody can select looks uncategorised.
//
// The list therefore lives on the SERVER (`shop_categories`, served by
// `POST /api/shop-categories/list` and its public twin) and this module is the
// web client's reader for it:
//
//   · `DEFAULT_SHOP_CATEGORIES` is the seed — the seven categories the shop has
//     always used. It is what the site shows before the endpoint answers, and
//     what the backend patch seeds the table with, so the two start identical.
//   · `normalizeCategoryList` accepts whatever shape the API answers with
//     (`{ id, label }`, `{ categoryId, name }`, a bare string…) and returns the
//     same shape everywhere, ordered by the admin's `sortOrder`.
//   · `fetchShopCategories` caches the answer so the shop's filter select does
//     not flash the seed list on every open.
//
// A deployment without the endpoint (or offline) keeps working: the seed list
// is used, and `inferCategory` in shopCatalog.js can still file a product whose
// category is free text.

import { useEffect, useState } from 'react';

export const DEFAULT_SHOP_CATEGORIES = [
  { id: 'hair-care', label: 'Hair care', sortOrder: 0 },
  { id: 'beard-grooming', label: 'Beard & grooming', sortOrder: 1 },
  { id: 'skin-face', label: 'Skin & face', sortOrder: 2 },
  { id: 'fragrance', label: 'Fragrance', sortOrder: 3 },
  { id: 'hair-colour', label: 'Hair colour', sortOrder: 4 },
  { id: 'tools-equipment', label: 'Tools & equipment', sortOrder: 5 },
  { id: 'kits-sets', label: 'Kits & sets', sortOrder: 6 },
];

export const SHOP_CATEGORY_CACHE_KEY = 'mynaai:shop-categories:v1';

// The slug a label becomes when the server sends a label but no id. The admin
// panel and this module agree on it, so "Tools & equipment" is
// `tools-equipment` on both sides without a lookup table.
export function categoryIdFromLabel(label = '') {
  return String(label)
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function pick(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return '';
}

export function normalizeCategory(row = {}, index = 0) {
  if (typeof row === 'string') {
    return { id: categoryIdFromLabel(row), label: row.trim(), sortOrder: index };
  }
  const label = String(pick(row, ['label', 'name', 'categoryName', 'title', 'category']) || '').trim();
  const id = String(pick(row, ['id', 'categoryId', 'slug', 'key']) || '').trim() || categoryIdFromLabel(label);
  if (!id && !label) return null;
  // 0 is a valid position (the first category), so the number is taken when it
  // parses rather than with `||`, which would push every "position: 0" row to
  // the end of the list.
  const rawOrder = pick(row, ['sortOrder', 'displayOrder', 'position', 'order']);
  const sortOrder = Number.isFinite(Number(rawOrder)) && rawOrder !== '' ? Number(rawOrder) : index;
  return {
    id: id || categoryIdFromLabel(label),
    label: label || id,
    sortOrder,
    active: pick(row, ['isActive', 'active']) === undefined ? true : Boolean(pick(row, ['isActive', 'active'])),
  };
}

export function normalizeCategoryList(rows) {
  if (!Array.isArray(rows)) return DEFAULT_SHOP_CATEGORIES.map(item => ({ ...item }));
  const seen = new Set();
  return rows
    .map((row, index) => normalizeCategory(row, index))
    .filter(item => {
      if (!item || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(({ id, label }) => ({ id, label }));
}

export function readCachedCategories() {
  try {
    const raw = localStorage.getItem(SHOP_CATEGORY_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const list = normalizeCategoryList(parsed?.categories);
    return list.length ? list : null;
  } catch {
    return null;
  }
}

function writeCachedCategories(categories) {
  try {
    localStorage.setItem(SHOP_CATEGORY_CACHE_KEY, JSON.stringify({ categories, savedAt: Date.now() }));
  } catch { /* storage blocked: the next load just asks again */ }
}

// Reads the admin's list. `endpoints` are tried in order (an account reads the
// authenticated door first, a visitor the public one), exactly like the shop's
// catalog doors; the first answer wins. Anything that is not a category list is
// a failure, so a proxy answering HTML cannot poison the cache.
export async function fetchShopCategories(endpoints = []) {
  let lastError = null;
  for (const endpoint of endpoints) {
    if (typeof endpoint !== 'function') continue;
    try {
      const response = await endpoint({});
      if (response?.status && response.status !== 'SUCCESS') throw new Error(response.message || 'Categories unavailable');
      const rows = Array.isArray(response?.data)
        ? response.data
        : response?.data?.categories || response?.data?.categoryList || response?.data?.list || response?.data?.items;
      if (!Array.isArray(rows)) throw new Error('Unexpected category response');
      const categories = normalizeCategoryList(rows);
      if (!categories.length) throw new Error('No categories configured');
      writeCachedCategories(categories);
      return categories;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Categories unavailable');
}

export const shopCategoryLabel = (categories, id) => (
  (categories || DEFAULT_SHOP_CATEGORIES).find(item => item.id === id)?.label || ''
);

// The storefront's reader: the cached list renders immediately (no flash of the
// seed), the server's list replaces it a moment later. A failure is silent on
// purpose — a shop must never show an error because a filter list could not be
// refreshed; the seed (or the cache) is good enough to browse with.
export function useShopCategories(api, guest = false) {
  const [categories, setCategories] = useState(() => readCachedCategories() || DEFAULT_SHOP_CATEGORIES.map(({ id, label }) => ({ id, label })));
  useEffect(() => {
    let cancelled = false;
    const doors = guest
      ? [api?.shopCategoriesListPublic, api?.shopCategoriesList]
      : [api?.shopCategoriesList, api?.shopCategoriesListPublic];
    fetchShopCategories(doors)
      .then(list => { if (!cancelled) setCategories(list); })
      .catch(() => { /* keep the cache or the seed */ });
    return () => { cancelled = true; };
  }, [api, guest]);
  return categories;
}
