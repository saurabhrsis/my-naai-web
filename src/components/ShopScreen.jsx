import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowUpDown,
  Banknote,
  ChevronDown,
  ChevronRight,
  IndianRupee,
  Minus,
  Package,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingBag,
  Star,
  Tag,
  Truck,
  User,
  X,
  Zap,
} from 'lucide-react';
import { api, getFileUrl } from '../lib/api';
import {
  PRICE_RANGES,
  SHOP_GENDERS,
  SORT_OPTIONS,
  applyShopFilters,
  categoryChipsFor,
  categoryLabel,
  discountPercent,
  normalizeShopProduct,
} from '../lib/shopCatalog';
import { addToCart, cartTotals, readCart, removeCartLine, saveCart, setCartQty } from '../lib/shopOrders';
import { buyerName, isShopGuest, shopCopy, shopStorageOwnerId } from '../lib/shopBuyer';
import { useShopSettings } from '../lib/shopSettings';
import { fetchServerCart, pushCartAdd, pushCartRemove, pushCartSetQty } from '../lib/shopServerSync';
import {
  Button,
  EmptyState,
  ImageWithFallback,
  PageHeader,
  SkeletonCard,
  cx,
  formatCurrency,
  getErrorMessage,
} from './Shared';

const PRODUCT_PLACEHOLDER = '/assets/brand/product-placeholder.svg';

// One small helper all shop screens share: the account the cart and orders
// belong to. Salons keep their bare account id (their stored carts and history
// predate customers using the shop); customers get their own namespace, so a
// shared device never mixes a salon's stock order with a personal one.
export function shopOwnerId(session) {
  return shopStorageOwnerId(session);
}

// The buyer's display name (salon name, or the customer's own name) — written
// into the order snapshot so the admin and the delivery partner know who the
// parcel is for.
export function shopSalonName(session) {
  return buyerName(session) || 'My Naai customer';
}

// ── Quantity control (Blinkit's signature ADD ↔ stepper) ────────────────────
export function ShopQuantityControl({ qty, onAdd, onSet, disabled = false, small = false, large = false }) {
  const sizeClass = large ? 'large' : small ? 'small' : '';
  if (disabled) {
    return <span className={cx('shop-stock-chip', sizeClass)} >Out of stock</span>;
  }
  if (qty > 0) {
    return (
      <div className={cx('shop-stepper', sizeClass)} role="group" aria-label="Change quantity">
        <button type="button" aria-label="Decrease quantity" onClick={() => onSet(qty - 1)}>
          <Minus size={15} />
        </button>
        <span>{qty}</span>
        <button type="button" aria-label="Increase quantity" onClick={() => onSet(qty + 1)}>
          <Plus size={15} />
        </button>
      </div>
    );
  }
  return (
    <button type="button" className={cx('shop-add-button', sizeClass)} onClick={onAdd}>
      Add
    </button>
  );
}

// ── Product card ─────────────────────────────────────────────────────────────
// The card is the whole shop: photo, name, category, price and the ADD ↔
// stepper. The rating rides on the photo as a translucent pill so the body
// keeps exactly two lines for the things a shopper compares across a 2-up
// grid — the name and the price. The photo gets a soft bottom shade so the
// discount badge reads on a white product shot as well as a dark one.
export function ShopProductCard({ product, qty, onAdd, onSetQty, onOpen }) {
  const off = discountPercent(product);
  return (
    <article className={cx('shop-card', !product.available && 'out-of-stock')}>
      <button type="button" className="shop-card-media" onClick={() => onOpen?.(product)} aria-label={`View ${product.name}`}>
        <ImageWithFallback src={getFileUrl(product.image)} fallback={PRODUCT_PLACEHOLDER} alt={product.name} className="shop-card-image" />
        <span className="shop-card-shade" aria-hidden="true" />
        {off > 0 && <span className="shop-off-badge">{off}% off</span>}
        {product.rating > 0 && (
          <span className="shop-card-rating">
            <Star size={10} /> {Number(product.rating).toFixed(1)}
          </span>
        )}
        {!product.available && <span className="shop-stock-veil">Out of stock</span>}
      </button>
      <div className="shop-card-body">
        <h3 onClick={() => onOpen?.(product)}>{product.name}</h3>
        <p className="shop-card-salon">{categoryLabel(product.category)}{product.salonName ? ` · ${product.salonName}` : ''}</p>
        <div className="shop-card-price-row">
          <strong>{formatCurrency(product.price)}</strong>
          {product.mrp > 0 && <s>{formatCurrency(product.mrp)}</s>}
        </div>
        <div className="shop-card-action">
          <ShopQuantityControl qty={qty} onAdd={() => onAdd(product)} onSet={next => onSetQty(product, next)} disabled={!product.available} />
        </div>
      </div>
    </article>
  );
}

// ── One labelled filter ─────────────────────────────────────────────────────
// Kept as native <select>s (the app's filter language) but with a leading icon
// and its own caret, so the strip reads as four tools rather than four boxes
// that happen to contain text. The icon is decorative: the accessible name is
// the visible label, and the screen-reader label is the short one.
function ShopFilterSelect({ label, ariaLabel, icon: Icon, value, onChange, children }) {
  return (
    <label className="shop-filter-select">
      <span className="shop-filter-label">{label}</span>
      <span className="shop-select-shell">
        <Icon size={13} className="shop-select-icon" aria-hidden="true" />
        <select value={value} onChange={onChange} aria-label={ariaLabel}>
          {children}
        </select>
        <ChevronDown size={13} className="shop-select-caret" aria-hidden="true" />
      </span>
    </label>
  );
}

// ── Floating "3 items · ₹1,240 → View cart" bar (shop + product page) ──────
//
// The number is the ITEM value (`subtotal`), never the checkout total. The bar
// used to quote `total`, so a ₹99 item read "₹199" the moment it was added —
// the ₹49 delivery fee (or a ₹100 one, depending on the admin's rules) sat in
// a line nobody had agreed to yet. Delivery is a checkout decision: it is
// billed on the checkout page, once the address and payment method are known.
export function ShopCartBar({ totals, onOpen }) {
  if (!totals.itemCount) return null;
  return (
    <button type="button" className="shop-cart-bar" onClick={onOpen}>
      <span className="shop-cart-bar-left">
        <ShoppingBag size={17} />
        <span>
          <strong>{totals.itemCount} item{totals.itemCount === 1 ? '' : 's'}</strong> · {formatCurrency(totals.subtotal)}
          <small className="shop-cart-bar-note">+ delivery at checkout</small>
        </span>
      </span>
      <span className="shop-cart-bar-cta">View cart <ChevronRight size={16} /></span>
    </button>
  );
}

// Loads the shop catalog the same way the grid does — the product details
// page needs the full list anyway (it powers "you may also like").
//
// Two doors, one catalog. A visitor on the public website asks the open
// `/api/shop-public/products/list` first (no token, cacheable, no partner
// middleware in the way); a signed-in account asks the usual endpoint first.
// If the first door is shut — the other deployment has not shipped yet — the
// second one gets a single try, so neither side of a rolling deploy can leave
// the shop empty. The grid shows the WHOLE catalog, not just page 1, so
// products added later still appear; at most 10 pages (200 products) are read.
export const SHOP_CATALOG_MAX_PAGES = 10;

async function loadShopCatalog(endpoint) {
  const readPage = async page => {
    const response = await endpoint({ page, searchString: '' });
    const body = response && typeof response === 'object' ? (response.data ?? {}) : null;
    const rows = body?.products || (Array.isArray(body) ? body : null);
    // A dev server / proxy that answers an unknown path with HTML (or any
    // shape that is not a catalog) must be treated as a failure, not as an
    // empty shop — otherwise the fallback door is never tried.
    if (!Array.isArray(rows)) throw new Error('Unexpected catalog response');
    return { rows, totalPages: body.pagination?.totalPages || 1 };
  };

  const first = await readPage(1);
  const pages = Math.min(first.totalPages, SHOP_CATALOG_MAX_PAGES);
  const rest = await Promise.all(
    Array.from({ length: pages - 1 }, (_, i) => readPage(i + 2).then(value => value.rows).catch(() => []))
  );
  const list = [...first.rows, ...rest.flat()];
  // Marker that identifies the deployed build (older builds called the
  // marketplace endpoint and silently showed the wrong — empty — list).
  console.debug(`[mynaai-web] Naai Shop: loaded ${list.length} product(s)`);
  return list;
}

export function useShopCatalog(notify, { guest = false } = {}) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const first = guest ? api.shopProductListPublic : api.shopProductList;
    const second = guest ? api.shopProductList : api.shopProductListPublic;
    try {
      let list;
      try {
        list = await loadShopCatalog(first);
      } catch (firstError) {
        // Anonymous browse must survive either deployment order: fall through
        // to the other door once, then report the original failure.
        try {
          list = await loadShopCatalog(second);
        } catch {
          throw firstError;
        }
      }
      setProducts(list.map(normalizeShopProduct));
    } catch (err) {
      setProducts([]);
      setError(getErrorMessage(err, 'The shop list could not be loaded.'));
      notify?.('error', 'The shop list could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [notify, guest]);
  useEffect(() => { load(); }, [load]);
  return { products, loading, error, load };
}

// Cart that stays with the ACCOUNT, not the browser. The local copy (and the
// in-session UI) updates instantly — the shop keeps working offline and for
// guests — but for a signed-in salon the backend (shop_carts) is the
// durable truth: on mount the server copy wins, and every mutation is
// pushed fire-and-forget so the same cart (and orders) follow the account
// across the web portal and the mobile app.
export function useSyncedCart(ownerId) {
  const [cart, setCartState] = useState(() => readCart(ownerId));

  useEffect(() => {
    setCartState(readCart(ownerId));
    let cancelled = false;
    fetchServerCart().then(lines => {
      if (cancelled || lines === null) return; // guest / offline: keep local
      saveCart(ownerId, lines);
      setCartState(lines);
    });
    return () => { cancelled = true; };
  }, [ownerId]);

  const add = useCallback((product, qty = 1) => {
    const next = addToCart(ownerId, product, qty);
    setCartState(next);
    pushCartAdd(String(product?.id || product?.productId || ''), qty);
  }, [ownerId]);

  const setQty = useCallback((productId, next) => {
    const lines = setCartQty(ownerId, productId, next);
    setCartState(lines);
    // qty <= 0 is a remove in the local model too — mirror it as such.
    if (next <= 0) pushCartRemove(String(productId));
    else pushCartSetQty(String(productId), next);
  }, [ownerId]);

  // Accepts a productId or a whole cart line (the cart screen passes lines).
  const removeLine = useCallback(target => {
    const productId = String(target?.productId || target || '');
    const lines = removeCartLine(ownerId, productId);
    setCartState(lines);
    pushCartRemove(productId);
  }, [ownerId]);

  return { cart, add, setQty, removeLine };
}

// ── The Shop tab ─────────────────────────────────────────────────────────────
export function ShopScreen({ session, navigate, notify }) {
  const ownerId = shopOwnerId(session);
  const copy = shopCopy(session);
  const guest = isShopGuest(session);
  const { products, loading, error, load } = useShopCatalog(notify, { guest });
  const { cart, add, setQty } = useSyncedCart(ownerId);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [gender, setGender] = useState('all');
  const [priceRange, setPriceRange] = useState('all');
  const [sort, setSort] = useState('popular');

  const shopSettings = useShopSettings();
  const categories = useMemo(() => categoryChipsFor(products), [products]);
  const visible = useMemo(
    () => applyShopFilters(products, { search, category, gender, priceRange, sort }),
    [products, search, category, gender, priceRange, sort],
  );
  // Any facet other than the default sort counts as an active filter — that is
  // when the "Clear" action earns its place on the results line.
  const filtersActive = Boolean(search) || category !== 'all' || gender !== 'all' || priceRange !== 'all' || sort !== 'popular';
  const totals = useMemo(() => cartTotals(cart, shopSettings), [cart, shopSettings]);
  const qtyFor = id => cart.find(line => line.productId === String(id))?.qty || 0;

  // A visitor may browse the whole catalog; the cart belongs to an account
  // (that is what makes it follow the person to the app), so the first ADD on
  // the public website asks them to sign in and returns them here.
  const needAccount = () => {
    if (!guest) return false;
    notify?.('info', copy.signInToBuy);
    navigate('login', { returnTo: '/shop' });
    return true;
  };
  const openCart = () => (guest ? needAccount() : navigate('shopCart'));
  const openOrders = () => (guest ? needAccount() : navigate('shopOrders'));

  const handleAdd = product => { if (needAccount()) return; add(product, 1); };
  const handleSetQty = (product, next) => setQty(product.id, next);
  // Tapping a product opens its full details page (deep-linkable, back button,
  // similar products) instead of an inline sheet.
  const openProduct = product => navigate('shopProduct', { productId: product.id });

  const resetFilters = () => {
    setSearch('');
    setCategory('all');
    setGender('all');
    setPriceRange('all');
    setSort('popular');
  };

  return (
    <div className="screen shop-screen">
      {/* Cart and orders sit on the HEADING's line at every width and are
          vertically centred with it. Phones keep the two icons only (the cart
          count rides as a badge) so "Naai Shop" is never squeezed or pushed
          onto a second row — that is the whole mobile budget of this header. */}
      <PageHeader
        title={copy.title}
        subtitle={copy.subtitle}
        subtitleBelow
        action={
          <div className="shop-header-actions">
            <button type="button" className="refresh-text-button shop-header-action" onClick={openCart} aria-label={`My cart${totals.itemCount > 0 ? `, ${totals.itemCount} item${totals.itemCount === 1 ? '' : 's'}` : ''}`}>
              <ShoppingBag size={15} />
              <span className="shop-header-action-label">My cart</span>
              {totals.itemCount > 0 && <em className="shop-header-count">{totals.itemCount}</em>}
            </button>
            <button type="button" className="refresh-text-button shop-header-action" onClick={openOrders} aria-label="My orders">
              <Package size={15} />
              <span className="shop-header-action-label">My orders</span>
            </button>
          </div>
        }
      />
      {/* Search + four filters in one block, with the clear action inside the
          field it clears: an empty search shows no ✕, a term shows one. */}
      <div className="shop-toolbar">
        <div className="search-field shop-search">
          <Search size={17} />
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search shampoo, clippers, beard oil…" aria-label="Search shop products" />
          {search && (
            <button type="button" className="shop-search-clear" onClick={() => setSearch('')} aria-label="Clear search">
              <X size={15} />
            </button>
          )}
        </div>

        <section className="shop-filters-selects" aria-label="Filter products">
          <ShopFilterSelect label="Category" ariaLabel="Category" icon={Tag} value={category} onChange={event => setCategory(event.target.value)}>
            <option value="all">All categories</option>
            {categories.map(item => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </ShopFilterSelect>
          <ShopFilterSelect label="For" ariaLabel="Gender" icon={User} value={gender} onChange={event => setGender(event.target.value)}>
            <option value="all">All</option>
            {SHOP_GENDERS.map(item => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </ShopFilterSelect>
          <ShopFilterSelect label="Price" ariaLabel="Price" icon={IndianRupee} value={priceRange} onChange={event => setPriceRange(event.target.value)}>
            {PRICE_RANGES.map(item => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </ShopFilterSelect>
          <ShopFilterSelect label="Sort" ariaLabel="Sort products" icon={ArrowUpDown} value={sort} onChange={event => setSort(event.target.value)}>
            {SORT_OPTIONS.map(item => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </ShopFilterSelect>
        </section>
      </div>

      {loading ? (
        <div className="shop-grid">{[1, 2, 3, 4, 5, 6].map(item => <SkeletonCard key={item} className="shop-skeleton" />)}</div>
      ) : error ? (
        <EmptyState icon={ShoppingBag} title="The shop is out of reach" message={`${error} Check your connection and try again.`} action={<Button onClick={load}><RefreshCw size={15} /> Retry</Button>} />
      ) : visible.length ? (
        <>
          <div className="shop-count-line">
            <span className="shop-count-text"><strong>{visible.length}</strong> {visible.length === 1 ? 'product' : 'products'}</span>
            {filtersActive && (
              <button type="button" className="shop-clear-filters" onClick={resetFilters}>Clear filters</button>
            )}
          </div>
          <div className="shop-grid">
            {visible.map(product => (
              <ShopProductCard key={product.id} product={product} qty={qtyFor(product.id)} onAdd={handleAdd} onSetQty={handleSetQty} onOpen={openProduct} />
            ))}
          </div>
        </>
      ) : (
        <EmptyState
          icon={Search}
          title="Nothing here yet"
          message={category === 'all'
            ? 'No product matches this search and price. Try a broader filter.'
            : `The ${categories.find(item => item.id === category)?.label || 'selected'} shelf is empty right now — try another category.`}
          action={<Button variant="secondary" onClick={resetFilters}>Show all products</Button>}
        />
      )}

      <ShopCartBar totals={totals} onOpen={openCart} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Product details page — the full-page view a product card opens:
 * hero image, price + savings, seller, category/gender tags, delivery
 * facts, description, add-to-cart, and same-category suggestions.
 * ------------------------------------------------------------------ */
export function ShopProductDetailScreen({ session, params, navigate, notify }) {
  const ownerId = shopOwnerId(session);
  const copy = shopCopy(session);
  const guest = isShopGuest(session);
  const productId = String(params?.productId || '');
  const { products, loading, error, load } = useShopCatalog(notify, { guest });
  const { cart, add, setQty } = useSyncedCart(ownerId);
  const shopSettings = useShopSettings();

  // A different product resets the gallery to its cover photo.
  useEffect(() => { setActiveImage(0); }, [productId]);

  const totals = useMemo(() => cartTotals(cart, shopSettings), [cart, shopSettings]);
  const product = useMemo(() => products.find(value => String(value.id) === productId) || null, [products, productId]);
  const images = useMemo(() => (product?.images?.length ? product.images : product?.image ? [product.image] : []), [product]);
  const [activeImage, setActiveImage] = useState(0);
  const similar = useMemo(() => (
    product
      ? products
        .filter(value => value.available && value.category === product.category && String(value.id) !== String(product.id))
        .sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name))
        .slice(0, 6)
      : []
  ), [products, product]);
  const qtyFor = id => cart.find(line => line.productId === String(id))?.qty || 0;

  const needAccount = () => {
    if (!guest) return false;
    notify?.('info', copy.signInToBuy);
    navigate('login', { returnTo: `/shopProduct?productId=${encodeURIComponent(productId)}` });
    return true;
  };
  const openCart = () => (guest ? needAccount() : navigate('shopCart'));

  const handleAdd = value => { if (needAccount()) return; add(value, 1); };
  const handleSetQty = (value, next) => setQty(value.id, next);
  const openProduct = value => navigate('shopProduct', { productId: value.id });

  if (loading) {
    return (
      <div className="screen shop-detail-page">
        <PageHeader title="Product details" onBack={() => navigate('shop')} />
        <SkeletonCard className="shop-detail-skeleton" />
        <div className="shop-grid">{[1, 2].map(item => <SkeletonCard key={item} className="shop-skeleton" />)}</div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="screen shop-detail-page">
        <PageHeader title="Product details" onBack={() => navigate('shop')} />
        <EmptyState icon={ShoppingBag} title="The shop is out of reach" message={`${error} Check your connection and try again.`} action={<Button onClick={load}><RefreshCw size={15} /> Retry</Button>} />
      </div>
    );
  }
  if (!product) {
    return (
      <div className="screen shop-detail-page">
        <PageHeader title="Product details" onBack={() => navigate('shop')} />
        <EmptyState icon={Package} title="Product not available" message="It may have been removed from the catalog. Browse the shop for something similar." action={<Button onClick={() => navigate('shop')}>Back to shop <ChevronRight size={16} /></Button>} />
      </div>
    );
  }

  const off = discountPercent(product);
  const genderLabel = SHOP_GENDERS.find(g => g.id === product.gender)?.label || 'Unisex';
  const city = session?.user?.salon?.city || session?.user?.city || '';

  return (
    <div className="screen shop-detail-page">
      <PageHeader title="Product details" onBack={() => navigate('shop')} />
      <div className="shop-detail-hero">
        <ImageWithFallback src={getFileUrl(images[Math.min(activeImage, images.length - 1)] || '')} fallback={PRODUCT_PLACEHOLDER} alt={product.name} className="shop-detail-hero-image" />
        {!product.available && <span className="shop-stock-veil">Out of stock</span>}
        {off > 0 && <span className="shop-off-badge shop-off-badge-hero">{off}% off</span>}
      </div>
      {images.length > 1 && (
        <div className="shop-detail-thumbs" role="group" aria-label="Product images">
          {images.map((image, index) => (
            <button key={image} type="button" className={cx('shop-detail-thumb', index === Math.min(activeImage, images.length - 1) && 'active')} onClick={() => setActiveImage(index)} aria-label={`Show image ${index + 1} of ${images.length}`}>
              <ImageWithFallback src={getFileUrl(image)} fallback={PRODUCT_PLACEHOLDER} alt="" />
            </button>
          ))}
        </div>
      )}

      <div className="shop-detail-tags">
        <span className="shop-detail-tag">{categoryLabel(product.category)}</span>
        <span className="shop-detail-tag">{genderLabel}</span>
        {product.available ? <span className="shop-detail-tag in-stock">In stock</span> : <span className="shop-detail-tag out-stock">Out of stock</span>}
      </div>
      <h2 className="shop-detail-name">{product.name}</h2>
      <p className="shop-detail-seller">{product.salonName ? `Sold by ${product.salonName}` : copy.sellerFallback}</p>

      <div className="shop-detail-price-row">
        <div>
          <strong>{formatCurrency(product.price)}</strong>
          {product.mrp > 0 && <s>{formatCurrency(product.mrp)}</s>}
        </div>
        {product.rating > 0 && <span className="shop-rating"><Star size={13} /> {Number(product.rating).toFixed(1)}</span>}
      </div>
      <div className="shop-detail-action">
        <ShopQuantityControl qty={qtyFor(product.id)} onAdd={() => handleAdd(product)} onSet={next => handleSetQty(product, next)} disabled={!product.available} large />
      </div>

      <section className="shop-detail-card">
        <h3>About this product</h3>
        <p>{product.description || `${categoryLabel(product.category)} pick${product.salonName ? ` from ${product.salonName}` : ' from the Naai Shop catalog'} — ${copy.deliveryLine}.`}</p>
      </section>

      {/* Delivery facts sit AFTER the description so the terms are read with
          the product they belong to (never a surprise at checkout). Every
          line is driven by the admin-managed shop settings, so the page can
          not promise what the bill will not honour. */}
      <section className="shop-detail-card" aria-label="Delivery information">
        <h3><Truck size={15} /> Delivery</h3>
        <p><Zap size={13} /> Next-day delivery{city ? ` to ${city}` : ` to ${copy.deliveryTarget}`}{product.price >= shopSettings.freeDeliveryAbove ? ' · FREE on this item' : ` · free above ${formatCurrency(shopSettings.freeDeliveryAbove)}`}</p>
        <p><Banknote size={13} /> {shopSettings.codThreshold > 0 && product.price > shopSettings.codThreshold
          ? 'Online payment via UPI, cards & netbanking'
          : 'Cash on delivery available · online payment via UPI, cards & netbanking'}</p>
        <p><ShieldCheck size={13} /> Free cancellation until the order goes out for delivery</p>
      </section>

      {similar.length > 0 && (
        <section>
          <h2 className="shop-detail-similar-title">You may also like</h2>
          <div className="shop-grid">
            {similar.map(value => (
              <ShopProductCard key={value.id} product={value} qty={qtyFor(value.id)} onAdd={handleAdd} onSetQty={handleSetQty} onOpen={openProduct} />
            ))}
          </div>
        </section>
      )}

      <ShopCartBar totals={totals} onOpen={openCart} />
    </div>
  );
}
