import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHOP_FILTERS,
  PRICE_RANGES,
  applyShopFilters,
  categoryChipsFor,
  discountPercent,
  inferCategory,
  inferGender,
  matchesPriceRange,
  normalizeShopProduct,
  parseProductImages,
} from './shopCatalog';

describe('inferCategory', () => {
  it('files products into the obvious buckets', () => {
    expect(inferCategory('Keratin Shampoo 200ml')).toBe('hair-care');
    expect(inferCategory('Beard Oil 30ml')).toBe('beard-grooming');
    expect(inferCategory('Electric Hair Clipper Pro')).toBe('tools-equipment');
    expect(inferCategory('Sandalwood Perfume 50ml')).toBe('fragrance');
    expect(inferCategory('Henna Hair Colour Pack')).toBe('hair-colour');
    expect(inferCategory('Face Cleanser for Oily Skin')).toBe('skin-face');
    expect(inferCategory('Starter Kit with 5 Items')).toBe('kits-sets');
  });

  it('does not mistake "setting spray" for a kit', () => {
    expect(inferCategory('Hair Setting Spray')).toBe('hair-care');
    expect(inferCategory('Grooming Set for Men')).toBe('kits-sets');
  });

  it('defaults to hair care for an unmatched salon shelf item', () => {
    expect(inferCategory('Mystery Ritual')).toBe('hair-care');
  });
});

describe('inferGender', () => {
  it('reads gender from common product words', () => {
    expect(inferGender('Beard Wax for Men')).toBe('men');
    expect(inferGender('Bridal Hair Oil for Women')).toBe('women');
    expect(inferGender('Unisex Family Shampoo')).toBe('unisex');
    expect(inferGender('Plain Shampoo')).toBe('');
  });
});

describe('parseProductImages', () => {
  it('parses the comma-joined multi-image field the editor saves', () => {
    expect(parseProductImages({ productImage: 'a.jpg, b.jpg, c.jpg' })).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
  });

  it('accepts single paths, pipe lists, JSON arrays and real arrays', () => {
    expect(parseProductImages({ productImage: '/uploads/one.jpg' })).toEqual(['/uploads/one.jpg']);
    expect(parseProductImages({ productImage: 'a.jpg|b.jpg' })).toEqual(['a.jpg', 'b.jpg']);
    expect(parseProductImages({ productImage: '["a.jpg","b.jpg"]' })).toEqual(['a.jpg', 'b.jpg']);
    expect(parseProductImages({ images: ['a.jpg', 'b.jpg'] })).toEqual(['a.jpg', 'b.jpg']);
    expect(parseProductImages({ productImages: ['a.jpg'] })).toEqual(['a.jpg']);
  });

  it('dedupes, trims and drops empties — first image stays the cover', () => {
    expect(parseProductImages({ productImage: ' a.jpg , , a.jpg ,b.jpg ' })).toEqual(['a.jpg', 'b.jpg']);
    expect(parseProductImages({ productImage: '' })).toEqual([]);
    expect(parseProductImages({})).toEqual([]);
  });

  it('exposes the first image as product.image for the card and cart', () => {
    const product = normalizeShopProduct({ productId: 'p9', productName: 'Twin', price: 99, productImage: 'cover.jpg, back.jpg' });
    expect(product.image).toBe('cover.jpg');
    expect(product.images).toEqual(['cover.jpg', 'back.jpg']);
  });
});

describe('normalizeShopProduct', () => {
  it('maps the API shape and honours explicit category/gender first', () => {
    const product = normalizeShopProduct({
      productId: 'p1',
      productName: 'Beard Oil',
      price: '199',
      rating: '4.6',
      isAvailable: true,
      productImage: '/uploads/x.jpg',
      category: 'fragrance',
      gender: 'FEMALE',
      salon: { salonName: 'Golden Scissors', genderType: 'MALE' },
    });
    expect(product.id).toBe('p1');
    expect(product.name).toBe('Beard Oil');
    expect(product.price).toBe(199);
    expect(product.category).toBe('fragrance');
    expect(product.gender).toBe('women');
    expect(product.salonName).toBe('Golden Scissors');
  });

  it('normalises free-text backend categories that reach the RegExp rule (the production crash)', () => {
    // The exact category the admin panel created in production. It matches no
    // keyword in tools-equipment, then "kit"/"combo"/"bundle" miss and the
    // kits-sets RegExp used to be passed to String.prototype.includes, which
    // threw "The first argument to String.prototype.includes must not be a
    // regular expression" and blanked the WHOLE shop tab.
    const product = normalizeShopProduct({
      productId: 'sp-live',
      productName: 'Herbal Oil',
      price: '950.00',
      mrp: '1050.00',
      category: 'Hair Colour and Chemical Products',
      gender: 'MALE',
      isAvailable: true,
    });
    expect(product.category).toBe('hair-colour');
    expect(product.gender).toBe('men');
    expect(product.price).toBe(950);

    // …and a category that actually hits the RegExp rule still classifies.
    const sets = normalizeShopProduct({ id: 'p-sets', name: 'Bundle', price: 100, category: 'Grooming Kits and Sets' });
    expect(sets.category).toBe('kits-sets');

    // "Setting spray" in a category must NOT light up the whole-word sets rule.
    const spray = normalizeShopProduct({ id: 'p-spray', name: 'Spray', price: 100, category: 'Hair Setting Sprays' });
    expect(spray.category).toBe('hair-care');
  });

  it('infers when the backend sends no facets and uses the seller salon last', () => {
    const inferred = normalizeShopProduct({ id: 'p2', name: 'Trim Kit', price: 499 });
    expect(inferred.category).toBe('kits-sets');
    expect(inferred.gender).toBe('unisex');

    const fromSeller = normalizeShopProduct({ id: 'p3', name: 'Signature Ritual', price: 299, salon: { genderType: 'FEMALE' } });
    expect(fromSeller.gender).toBe('women');
  });

  it('drops an MRP that is below the selling price', () => {
    expect(normalizeShopProduct({ id: 'p4', name: 'Oil', price: 200, mrp: 150 }).mrp).toBe(0);
    expect(discountPercent(normalizeShopProduct({ id: 'p5', name: 'Oil', price: 160, mrp: 200 }))).toBe(20);
  });
});

describe('applyShopFilters', () => {
  const products = [
    { id: 'a', name: 'Beard Oil', price: 199, mrp: 0, rating: 4, available: true, category: 'beard-grooming', gender: 'men' },
    { id: 'b', name: 'Shampoo', price: 499, mrp: 600, rating: 5, available: true, category: 'hair-care', gender: 'unisex' },
    { id: 'c', name: 'Clipper', price: 1499, mrp: 0, rating: 4.5, available: true, category: 'tools-equipment', gender: 'unisex' },
    { id: 'd', name: 'Face Scrub', price: 399, mrp: 0, rating: 3, available: true, category: 'skin-face', gender: 'women' },
    { id: 'e', name: 'Out of stock item', price: 99, mrp: 0, rating: 5, available: false, category: 'hair-care', gender: 'men' },
  ];

  it('filters by category, gender, price range and search', () => {
    expect(applyShopFilters(products, { ...DEFAULT_SHOP_FILTERS, category: 'beard-grooming' }).map(p => p.id)).toEqual(['a']);
    expect(applyShopFilters(products, { ...DEFAULT_SHOP_FILTERS, gender: 'women' }).map(p => p.id)).toEqual(['d']);
    // The default sort (popular) reorders even a price-filtered result.
    expect(applyShopFilters(products, { ...DEFAULT_SHOP_FILTERS, priceRange: 'under500' }).map(p => p.id)).toEqual(['b', 'a', 'd']);
    expect(applyShopFilters(products, { ...DEFAULT_SHOP_FILTERS, search: 'oil' }).map(p => p.id)).toEqual(['a']);
    // Out-of-stock products never reach the grid.
    expect(applyShopFilters(products, DEFAULT_SHOP_FILTERS).map(p => p.id)).not.toContain('e');
  });

  it('sorts by price both ways and by popularity by default', () => {
    expect(applyShopFilters(products, { ...DEFAULT_SHOP_FILTERS, sort: 'price-asc' }).map(p => p.id)).toEqual(['a', 'd', 'b', 'c']);
    expect(applyShopFilters(products, { ...DEFAULT_SHOP_FILTERS, sort: 'price-desc' }).map(p => p.id)).toEqual(['c', 'b', 'd', 'a']);
    expect(applyShopFilters(products, { ...DEFAULT_SHOP_FILTERS, sort: 'popular' }).map(p => p.id)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('price range boundaries are inclusive', () => {
    expect(matchesPriceRange(500, '500to1000')).toBe(true);
    expect(matchesPriceRange(1000, '500to1000')).toBe(true);
    expect(matchesPriceRange(1000, 'over1000')).toBe(false);
    expect(PRICE_RANGES).toHaveLength(4);
  });
});

describe('categoryChipsFor', () => {
  it('keeps the fixed chips and appends new backend categories once', () => {
    const chips = categoryChipsFor([
      { category: 'hair-care' },
      { category: 'hair-care' },
      { category: 'wax-hair' },
    ]);
    expect(chips.map(chip => chip.id)).toContain('hair-care');
    expect(chips.filter(chip => chip.id === 'wax-hair')).toHaveLength(1);
    expect(chips.find(chip => chip.id === 'wax-hair').label).toBe('Wax hair');
  });
});
