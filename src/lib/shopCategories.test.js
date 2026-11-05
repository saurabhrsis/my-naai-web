import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DEFAULT_SHOP_CATEGORIES,
  SHOP_CATEGORY_CACHE_KEY,
  categoryIdFromLabel,
  fetchShopCategories,
  normalizeCategory,
  normalizeCategoryList,
  readCachedCategories,
  shopCategoryLabel,
} from './shopCategories';
import { SHOP_CATEGORIES, categoryChipsFor } from './shopCatalog';

beforeEach(() => {
  localStorage.clear();
});

describe('the one product-category list', () => {
  it('is the same seed on the site, in the app and in the backend patch', () => {
    // The shop's legacy export and the canonical seed must not drift: the admin
    // panel, the website and the app all read these seven ids and labels.
    expect(SHOP_CATEGORIES).toEqual(DEFAULT_SHOP_CATEGORIES.map(({ id, label }) => ({ id, label })));
    expect(DEFAULT_SHOP_CATEGORIES.map(item => item.id)).toEqual([
      'hair-care', 'beard-grooming', 'skin-face', 'fragrance', 'hair-colour', 'tools-equipment', 'kits-sets',
    ]);
  });

  it('slugifies a label the way the admin panel does', () => {
    expect(categoryIdFromLabel('Tools & equipment')).toBe('tools-and-equipment');
    expect(categoryIdFromLabel('  Hair  care ')).toBe('hair-care');
    expect(categoryIdFromLabel('Skin & face')).toBe('skin-and-face');
  });

  it('reads whatever shape the API answers with', () => {
    const list = normalizeCategoryList([
      { categoryId: 'fragrance', name: 'Fragrance', displayOrder: 2 },
      { id: 'hair-care', label: 'Hair care', sortOrder: 1 },
      { title: 'Grooming kits', position: 0 },
      'Nail care',
      { id: 'hair-care', label: 'Duplicate id' },
    ]);
    // Ordered by the admin's position, and a duplicate id is dropped.
    expect(list.map(item => item.id)).toEqual(['grooming-kits', 'hair-care', 'fragrance', 'nail-care']);
    expect(normalizeCategory({ slug: 'x', title: 'X' })).toMatchObject({ id: 'x', label: 'X' });
    expect(normalizeCategory({})).toBeNull();
  });

  it('orders by the admin, not by the array', () => {
    const list = normalizeCategoryList([
      { id: 'z', label: 'Zed', sortOrder: 9 },
      { id: 'a', label: 'Aye', sortOrder: 1 },
    ]);
    expect(list.map(item => item.id)).toEqual(['a', 'z']);
  });

  it('reads the first door that answers and caches the answer', async () => {
    const partner = vi.fn().mockRejectedValue(new Error('404'));
    const open = vi.fn().mockResolvedValue({
      status: 'SUCCESS',
      data: { categories: [{ id: 'hair-care', label: 'Hair care', sortOrder: 0 }] },
    });
    const list = await fetchShopCategories([partner, open]);
    expect(list).toEqual([{ id: 'hair-care', label: 'Hair care' }]);
    expect(partner).toHaveBeenCalledTimes(1);
    // Cached, so the next open of the shop does not flash the seed list.
    expect(readCachedCategories()).toEqual([{ id: 'hair-care', label: 'Hair care' }]);
    expect(JSON.parse(localStorage.getItem(SHOP_CATEGORY_CACHE_KEY)).categories).toHaveLength(1);
  });

  it('refuses a response that is not a category list instead of caching HTML', async () => {
    const broken = vi.fn().mockResolvedValue({ status: 'SUCCESS', data: { products: [] } });
    await expect(fetchShopCategories([broken])).rejects.toThrow(/Unexpected category response/);
    expect(readCachedCategories()).toBeNull();
  });

  it('labels a category and keeps a retired one reachable', () => {
    const list = [{ id: 'hair-care', label: 'Hair care' }];
    expect(shopCategoryLabel(list, 'hair-care')).toBe('Hair care');
    // A product filed under a category the admin list no longer has still gets
    // its own filter (rather than silently landing in "All").
    const chips = categoryChipsFor([{ category: 'beard-grooming' }], list);
    expect(chips.map(item => item.id)).toEqual(['hair-care', 'beard-grooming']);
    expect(chips[1].label).toBe('Beard grooming');
  });
});
