// The Naai Shop catalog rules — shared by the salon "Shop" screen so the
// filters always mean the same thing on the grid, in tests and (later) in the
// backend if the product record grows real category/gender fields.
//
// The product API (`/api/products/*`) today stores name, price, rating,
// availability and image — no category or gender. The shop therefore
// classifies every product with an ordered keyword inference, and honours an
// explicit `category` / `gender` field the moment the backend (or the salon
// product editor) starts persisting one. Inference is deliberately
// conservative: an unmatched product lands in the broadest sensible bucket
// instead of an empty shelf.

export const SHOP_CATEGORIES = [
  { id: 'hair-care', label: 'Hair care' },
  { id: 'beard-grooming', label: 'Beard & grooming' },
  { id: 'skin-face', label: 'Skin & face' },
  { id: 'fragrance', label: 'Fragrance' },
  { id: 'hair-colour', label: 'Hair colour' },
  { id: 'tools-equipment', label: 'Tools & equipment' },
  { id: 'kits-sets', label: 'Kits & sets' },
];

export const SHOP_GENDERS = [
  { id: 'men', label: 'Men' },
  { id: 'women', label: 'Women' },
  { id: 'unisex', label: 'Unisex' },
];

export const PRICE_RANGES = [
  { id: 'all', label: 'Any price' },
  { id: 'under500', label: 'Under ₹500' },
  { id: '500to1000', label: '₹500–₹1,000' },
  { id: 'over1000', label: '₹1,000+' },
];

export const SORT_OPTIONS = [
  { id: 'popular', label: 'Popular' },
  { id: 'price-asc', label: 'Price: Low to High' },
  { id: 'price-desc', label: 'Price: High to Low' },
];

const CATEGORY_LABELS = Object.fromEntries(SHOP_CATEGORIES.map(category => [category.id, category.label]));
export const GENDER_LABELS = Object.fromEntries(SHOP_GENDERS.map(gender => [gender.id, gender.label]));

// Ordered rules — the FIRST match wins, so specific gear beats generic
// "oil" and a "beard kit" files under kits-sets. Words are matched on
// boundaries so "balm" does not light up on "album".
// Rules may list plain strings (substring match) or RegExp for words that
// must stand alone — e.g. "set" in "setting spray" is a hair product, so the
// kits rule only counts "set/sets" when the word is not part of "setting".
const CATEGORY_RULES = [
  ['tools-equipment', ['clipper', 'trimmer', 'straight razor', 'razor', 'shaver', 'comb', 'cape', 'apron', 'towel', 'scissor', 'dryer', 'styler', 'straightener', 'curling iron', 'curler', 'mirror stand']],
  // "pack" stays out: "Colour Pack 100g" is a size descriptor, not a bundle.
  ['kits-sets', ['kit', 'combo', 'bundle', /(^|[^a-z])sets?([^a-z]|$)/i]],
  ['fragrance', ['perfume', 'deodorant', 'deo', 'cologne', 'attar']],
  ['hair-colour', ['colour', 'color', 'henna', 'dye', 'greys']],
  ['beard-grooming', ['beard', 'mustache', 'mustache', 'stubble', 'pomade']],
  ['skin-face', ['face', 'skin', 'sunscreen', 'spf', 'moisturiser', 'moisturizer', 'lotion', 'toner', 'cleanser', 'scrub', 'face mask', 'glow', 'brow', 'lashes', 'lip']],
  ['hair-care', ['shampoo', 'conditioner', 'serum', 'oil', 'spa', 'keratin', 'gel', 'hairspray', 'hair spray', 'hair mask', 'balm', 'butter', 'treatment', 'fall control', 'fall', 'scalp', 'hair']],
];

// A word in a gender rule may appear as a substring ("men" inside "grooming
// men" is fine; "for men" covers the marketing phrasing) — plain substring
// matching is the same rule the category inference uses.
const GENDER_MEN_RULES = ['beard', 'mustache', 'stubble', 'pomade', "men's", 'for men', 'groom', 'barber'];
const GENDER_WOMEN_RULES = ['women', 'woman', 'ladies', 'bridal', 'lashes', 'lipstick', "women's", 'for women'];

function words(value) {
  return String(value || '').toLowerCase();
}

// Explicit values the backend or the salon editor may send, normalised to the
// shop's ids. Anything unrecognised falls through to inference.
function readExplicitCategory(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return '';
  const direct = SHOP_CATEGORIES.find(category => category.id === text || category.label.toLowerCase() === text);
  if (direct) return direct.id;
  const rule = CATEGORY_RULES.find(([, keywords]) => keywords.some(keyword => text === keyword || text.includes(keyword)));
  return rule ? rule[0] : '';
}

function readExplicitGender(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return '';
  if (['men', 'male', 'm', "men's", 'for men'].includes(text)) return 'men';
  if (['women', 'woman', 'female', 'f', "women's", 'for women', 'ladies'].includes(text)) return 'women';
  if (['unisex', 'all', 'both', 'family'].includes(text)) return 'unisex';
  return '';
}

// The seller's salon type is the last resort for gender: a product listed by
// a FEMALE salon with no other signal is most likely a women's product.
function sellerGender(product) {
  const type = String(product?.salon?.genderType || product?.salonGenderType || '').trim().toUpperCase();
  if (type === 'MALE') return 'men';
  if (type === 'FEMALE') return 'women';
  return '';
}

export function inferCategory(name) {
  const text = words(name);
  for (const [category, keywords] of CATEGORY_RULES) {
    if (keywords.some(keyword => (keyword instanceof RegExp ? keyword.test(text) : text.includes(keyword)))) return category;
  }
  return 'hair-care';
}

export function inferGender(name) {
  const text = words(name);
  if (text.includes('unisex') || text.includes('family')) return 'unisex';
  const men = GENDER_MEN_RULES.some(word => text.includes(word));
  const women = GENDER_WOMEN_RULES.some(word => text.includes(word));
  if (men && !women) return 'men';
  if (women && !men) return 'women';
  if (men && women) return 'unisex';
  return '';
}

// One shape for every product no matter which endpoint it came from: the
// customer shelf (`get-all-salons-products-list`), a salon's own catalog
// (`/api/products/list`) or a future shop-only endpoint.
export function normalizeShopProduct(item = {}, index = 0) {
  const id = item.productId || item.id || `shop-product-${index}`;
  const name = item.productName || item.name || 'Untitled product';
  const price = Math.max(0, Number(item.price) || 0);
  const rawMrp = Number(item.mrp ?? item.marketPrice ?? item.mrpPrice ?? 0);
  const mrp = rawMrp > price ? rawMrp : 0;
  const salon = item.salon || {};
  return {
    id,
    name,
    price,
    mrp,
    rating: Number(item.rating || 0),
    reviews: item.reviews ?? item.reviewCount ?? '',
    available: item.isAvailable ?? item.available ?? true,
    image: item.productImage || item.image || '',
    description: item.description || item.productDescription || '',
    salonName: salon.salonName || item.salonName || '',
    salonGenderType: String(salon.genderType || item.salonGenderType || '').toUpperCase(),
    category: readExplicitCategory(item.category || item.categoryName) || inferCategory(name),
    gender: readExplicitGender(item.gender || item.genderType) || inferGender(name) || sellerGender(item) || 'unisex',
  };
}

export function categoryLabel(id) {
  return CATEGORY_LABELS[id] || id;
}

// The fixed chips first, then any category the live catalog uses that is not
// in the fixed list (a backend-driven category must never disappear from the
// filter row just because it is new).
export function categoryChipsFor(products) {
  const seen = new Set(SHOP_CATEGORIES.map(category => category.id));
  const extra = [];
  for (const product of products || []) {
    if (product?.category && !seen.has(product.category)) {
      seen.add(product.category);
      extra.push({ id: product.category, label: product.category.charAt(0).toUpperCase() + product.category.slice(1).replace(/[-_]/g, ' ') });
    }
  }
  return [...SHOP_CATEGORIES, ...extra];
}

export function matchesPriceRange(price, rangeId) {
  switch (rangeId) {
    case 'under500': return price < 500;
    case '500to1000': return price >= 500 && price <= 1000;
    case 'over1000': return price > 1000;
    default: return true;
  }
}

export const DEFAULT_SHOP_FILTERS = Object.freeze({
  search: '',
  category: 'all',
  gender: 'all',
  priceRange: 'all',
  sort: 'popular',
});

// Pure + synchronous so the grid can re-filter on every keystroke without a
// network round-trip (the catalog endpoint does not accept these facets).
export function applyShopFilters(products, filters = DEFAULT_SHOP_FILTERS) {
  const list = Array.isArray(products) ? products : [];
  const search = String(filters.search || '').trim().toLowerCase();
  const filtered = list.filter(product => {
    if (!product?.available) return false;
    if (search && !`${product.name} ${product.salonName} ${product.description}`.toLowerCase().includes(search)) return false;
    if (filters.category && filters.category !== 'all' && product.category !== filters.category) return false;
    if (filters.gender && filters.gender !== 'all' && product.gender !== filters.gender) return false;
    if (!matchesPriceRange(product.price, filters.priceRange)) return false;
    return true;
  });
  const sort = filters.sort || 'popular';
  filtered.sort((a, b) => {
    if (sort === 'price-asc') return a.price - b.price || a.name.localeCompare(b.name);
    if (sort === 'price-desc') return b.price - a.price || a.name.localeCompare(b.name);
    return b.rating - a.rating || a.name.localeCompare(b.name);
  });
  return filtered;
}

// "% off" for the price badge; 0 when there is no MRP to compare against.
export function discountPercent(product) {
  if (!product?.mrp || product.mrp <= product.price) return 0;
  return Math.round(((product.mrp - product.price) / product.mrp) * 100);
}
