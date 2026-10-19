import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Banknote,
  ChevronRight,
  Minus,
  Package,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingBag,
  Star,
  Truck,
  Zap,
} from 'lucide-react';
import { api, getFileUrl } from '../lib/api';
import {
  PRICE_RANGES,
  SHOP_GENDERS,
  applyShopFilters,
  categoryChipsFor,
  categoryLabel,
  discountPercent,
  normalizeShopProduct,
} from '../lib/shopCatalog';
import { FREE_DELIVERY_ABOVE, addToCart, cartTotals, readCart, removeCartLine, saveCart, setCartQty } from '../lib/shopOrders';
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

// One small helper all shop screens share: the current salon account the cart
// and orders belong to.
export function shopOwnerId(session) {
  return session?.userId || 'guest';
}

export function shopSalonName(session) {
  const user = session?.user || {};
  return user?.salon?.salonName || user?.salonName || user?.fullName || 'My Naai salon';
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
export function ShopProductCard({ product, qty, onAdd, onSetQty, onOpen }) {
  const off = discountPercent(product);
  return (
    <article className={cx('shop-card', !product.available && 'out-of-stock')}>
      {off > 0 && <span className="shop-off-badge">{off}% off</span>}
      <button type="button" className="shop-card-media" onClick={() => onOpen?.(product)} aria-label={`View ${product.name}`}>
        <ImageWithFallback src={getFileUrl(product.image)} fallback={PRODUCT_PLACEHOLDER} alt={product.name} className="shop-card-image" />
        {!product.available && <span className="shop-stock-veil">Out of stock</span>}
      </button>
      <div className="shop-card-body">
        <h3 onClick={() => onOpen?.(product)}>{product.name}</h3>
        <p className="shop-card-salon">{categoryLabel(product.category)}{product.salonName ? ` · ${product.salonName}` : ''}</p>
        <div className="shop-card-price-row">
          <div>
            <strong>{formatCurrency(product.price)}</strong>
            {product.mrp > 0 && <s>{formatCurrency(product.mrp)}</s>}
            {off > 0 && <em className="shop-off-badge inline">{off}% off</em>}
          </div>
          {product.rating > 0 && (
            <span className="shop-rating">
              <Star size={11} /> {Number(product.rating).toFixed(1)}
            </span>
          )}
        </div>
        <div className="shop-card-action">
          <ShopQuantityControl qty={qty} onAdd={() => onAdd(product)} onSet={next => onSetQty(product, next)} disabled={!product.available} />
        </div>
      </div>
    </article>
  );
}

// ── Floating "3 items · ₹1,240 → View cart" bar (shop + product page) ──────
export function ShopCartBar({ totals, onOpen }) {
  if (!totals.itemCount) return null;
  return (
    <button type="button" className="shop-cart-bar" onClick={onOpen}>
      <span className="shop-cart-bar-left">
        <ShoppingBag size={17} />
        <span><strong>{totals.itemCount} item{totals.itemCount === 1 ? '' : 's'}</strong> · {formatCurrency(totals.total)}</span>
      </span>
      <span className="shop-cart-bar-cta">View cart <ChevronRight size={16} /></span>
    </button>
  );
}

// Loads the shop catalog the same way the grid does — the product details
// page needs the full list anyway (it powers "you may also like").
export function useShopCatalog(notify) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // The shop browses the COMPANY catalog (shop_products) — separate from
      // the salons' customer-facing products the app lists under /api/products.
      // The grid shows the WHOLE catalog, not just page 1, so products added
      // later still appear; at most 10 pages (200 products) are fetched, the
      // remaining pages in parallel.
      const first = await api.shopProductList({ page: 1, searchString: '' });
      const firstBody = first?.data || {};
      const rows = firstBody.products || (Array.isArray(firstBody) ? firstBody : []);
      const totalPages = firstBody.pagination?.totalPages || 1;
      const pages = Math.min(totalPages, 10);
      const rest = await Promise.all(
        Array.from({ length: pages - 1 }, (_, i) =>
          api.shopProductList({ page: i + 2, searchString: '' })
            .then(r => r?.data?.products || (Array.isArray(r?.data) ? r.data : []))
            .catch(() => [])
        )
      );
      const list = [...rows, ...rest.flat()];
      setProducts(list.map(normalizeShopProduct));
      // Marker that identifies the deployed build (older builds called the
      // marketplace endpoint and silently showed the wrong — empty — list).
      console.debug(`[mynaai-web] Naai Shop: loaded ${list.length} product(s) from /api/shop-products/list`);
    } catch (err) {
      setProducts([]);
      setError(getErrorMessage(err, 'The shop list could not be loaded.'));
      notify?.('error', 'The shop list could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [notify]);
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
  const { products, loading, error, load } = useShopCatalog(notify);
  const { cart, add, setQty } = useSyncedCart(ownerId);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [gender, setGender] = useState('all');
  const [priceRange, setPriceRange] = useState('all');

  const categories = useMemo(() => categoryChipsFor(products), [products]);
  const visible = useMemo(
    () => applyShopFilters(products, { search, category, gender, priceRange }),
    [products, search, category, gender, priceRange],
  );
  const totals = useMemo(() => cartTotals(cart), [cart]);
  const qtyFor = id => cart.find(line => line.productId === String(id))?.qty || 0;

  const handleAdd = product => add(product, 1);
  const handleSetQty = (product, next) => setQty(product.id, next);
  // Tapping a product opens its full details page (deep-linkable, back button,
  // similar products) instead of an inline sheet.
  const openProduct = product => navigate('shopProduct', { productId: product.id });

  const resetFilters = () => {
    setSearch('');
    setCategory('all');
    setGender('all');
    setPriceRange('all');
  };

  return (
    <div className="screen shop-screen">
      <PageHeader
        title="Naai Shop"
        subtitle="Grooming stock for your salon, supplied by My Naai."
        action={
          <div className="shop-header-actions">
            <button type="button" className="refresh-text-button" onClick={() => navigate('shopCart')}><ShoppingBag size={15} /> My cart{totals.itemCount > 0 ? ` · ${totals.itemCount}` : ''}</button>
            <button type="button" className="refresh-text-button" onClick={() => navigate('shopOrders')}><Package size={15} /> My orders</button>
          </div>
        }
      />
      <label className="search-field shop-search">
        <Search size={17} />
        <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search shampoo, clippers, beard oil…" aria-label="Search shop products" />
      </label>

      <section className="shop-filters-selects" aria-label="Filter products">
        <label className="shop-filter-select">
          <span>Category</span>
          <select value={category} onChange={event => setCategory(event.target.value)} aria-label="Category">
            <option value="all">All categories</option>
            {categories.map(item => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </label>
        <label className="shop-filter-select">
          <span>For</span>
          <select value={gender} onChange={event => setGender(event.target.value)} aria-label="Gender">
            <option value="all">All</option>
            {SHOP_GENDERS.map(item => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </label>
        <label className="shop-filter-select">
          <span>Price</span>
          <select value={priceRange} onChange={event => setPriceRange(event.target.value)} aria-label="Price">
            {PRICE_RANGES.map(item => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </label>
      </section>

      {loading ? (
        <div className="shop-grid">{[1, 2, 3, 4, 5, 6].map(item => <SkeletonCard key={item} className="shop-skeleton" />)}</div>
      ) : error ? (
        <EmptyState icon={ShoppingBag} title="The shop is out of reach" message={`${error} Check your connection and try again.`} action={<Button onClick={load}><RefreshCw size={15} /> Retry</Button>} />
      ) : visible.length ? (
        <>
          <div className="shop-count-line"><strong>{visible.length}</strong> {visible.length === 1 ? 'product' : 'products'}{(category !== 'all' || gender !== 'all' || priceRange !== 'all' || search) && <button type="button" className="shop-clear-filters" onClick={resetFilters}>Clear filters</button>}</div>
          <div className="shop-grid">
            {visible.map(product => (
              <ShopProductCard key={product.id} product={product} qty={qtyFor(product.id)} onAdd={handleAdd} onSetQty={handleSetQty} onOpen={openProduct} />
            ))}
          </div>
        </>
      ) : (
        <EmptyState icon={Search} title="No products match" message="Try a different search, category or price range." action={<Button variant="secondary" onClick={resetFilters}>Clear filters</Button>} />
      )}

      <ShopCartBar totals={totals} onOpen={() => navigate('shopCart')} />
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
  const productId = String(params?.productId || '');
  const { products, loading, error, load } = useShopCatalog(notify);
  const { cart, add, setQty } = useSyncedCart(ownerId);

  // A different product resets the gallery to its cover photo.
  useEffect(() => { setActiveImage(0); }, [productId]);

  const totals = useMemo(() => cartTotals(cart), [cart]);
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

  const handleAdd = value => add(value, 1);
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
      <p className="shop-detail-seller">{product.salonName ? `Sold by ${product.salonName}` : 'Supplied by My Naai'}</p>

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
        <h3><Truck size={15} /> Delivery</h3>
        <p><Zap size={13} /> Next-day delivery{city ? ` to ${city}` : ' to your salon'}{product.price >= FREE_DELIVERY_ABOVE ? ' · FREE on this item' : ` · free above ${formatCurrency(FREE_DELIVERY_ABOVE)}`}</p>
        <p><Banknote size={13} /> Cash on delivery available · online payment via UPI, cards &amp; netbanking</p>
        <p><ShieldCheck size={13} /> Free cancellation until the order goes out for delivery</p>
      </section>

      <section className="shop-detail-card">
        <h3>About this product</h3>
        <p>{product.description || `${categoryLabel(product.category)} pick${product.salonName ? ` from ${product.salonName}` : ' from the Naai Shop catalog'} — delivered to your salon in 1–2 days.`}</p>
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

      <ShopCartBar totals={totals} onOpen={() => navigate('shopCart')} />
    </div>
  );
}
