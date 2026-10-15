import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Banknote,
  ChevronRight,
  Clock3,
  Minus,
  Package,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Star,
  Truck,
  Zap,
} from 'lucide-react';
import { api, getFileUrl } from '../lib/api';
import {
  PRICE_RANGES,
  SORT_OPTIONS,
  SHOP_GENDERS,
  applyShopFilters,
  categoryChipsFor,
  categoryLabel,
  discountPercent,
  normalizeShopProduct,
} from '../lib/shopCatalog';
import { FREE_DELIVERY_ABOVE, addToCart, cartTotals, readCart, setCartQty } from '../lib/shopOrders';
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
      const response = await api.userProductList({ page: 1, searchString: '' });
      const list = response?.data?.products || (Array.isArray(response?.data) ? response.data : []);
      setProducts(list.map(normalizeShopProduct));
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

// ── The Shop tab ─────────────────────────────────────────────────────────────
export function ShopScreen({ session, navigate, notify }) {
  const ownerId = shopOwnerId(session);
  const { products, loading, error, load } = useShopCatalog(notify);
  const [cart, setCart] = useState(() => readCart(ownerId));
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [gender, setGender] = useState('all');
  const [priceRange, setPriceRange] = useState('all');
  const [sort, setSort] = useState('popular');

  // The cart belongs to the signed-in salon account; re-key it when the
  // session changes (a second salon signing in on the same device).
  useEffect(() => { setCart(readCart(ownerId)); }, [ownerId]);

  const categories = useMemo(() => categoryChipsFor(products), [products]);
  const visible = useMemo(
    () => applyShopFilters(products, { search, category, gender, priceRange, sort }),
    [products, search, category, gender, priceRange, sort],
  );
  const totals = useMemo(() => cartTotals(cart), [cart]);
  const qtyFor = id => cart.find(line => line.productId === String(id))?.qty || 0;

  const handleAdd = product => {
    setCart(addToCart(ownerId, product, 1));
  };
  const handleSetQty = (product, next) => {
    setCart(setCartQty(ownerId, product.id, next));
  };
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
      <PageHeader
        title="Naai Shop"
        subtitle="Grooming stock for your salon, supplied by My Naai."
        action={<button className="refresh-text-button" onClick={() => navigate('shopOrders')}><Package size={15} /> My orders</button>}
      />
      <div className="shop-hero-strip" role="note">
        <span><Zap size={15} /> <strong>Next-day delivery</strong> in your city</span>
        <span><Truck size={15} /> Free above {formatCurrency(499)}</span>
        <span><Clock3 size={15} /> Order by 10 pm</span>
      </div>
      <label className="search-field shop-search">
        <Search size={17} />
        <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search shampoo, clippers, beard oil…" aria-label="Search shop products" />
      </label>

      <div className="shop-chip-row" role="list" aria-label="Categories">
        <button type="button" role="listitem" className={cx('shop-chip', category === 'all' && 'active')} onClick={() => setCategory('all')}>All</button>
        {categories.map(item => (
          <button key={item.id} type="button" role="listitem" className={cx('shop-chip', category === item.id && 'active')} onClick={() => setCategory(item.id)}>{item.label}</button>
        ))}
      </div>

      <div className="shop-filter-row">
        <div className="shop-chip-group" role="group" aria-label="Gender">
          <button type="button" className={cx('shop-chip small', gender === 'all' && 'active')} onClick={() => setGender('all')}>All</button>
          {SHOP_GENDERS.map(item => (
            <button key={item.id} type="button" className={cx('shop-chip small', gender === item.id && 'active')} onClick={() => setGender(item.id)}>{item.label}</button>
          ))}
        </div>
        <label className="shop-sort">
          <SlidersHorizontal size={13} />
          <select value={sort} onChange={event => setSort(event.target.value)} aria-label="Sort products">
            {SORT_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
      </div>
      <div className="shop-chip-row shop-price-row" role="group" aria-label="Price range">
        {PRICE_RANGES.map(item => (
          <button key={item.id} type="button" className={cx('shop-chip small', priceRange === item.id && 'active')} onClick={() => setPriceRange(item.id)}>{item.label}</button>
        ))}
      </div>

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
  const [cart, setCart] = useState(() => readCart(ownerId));

  useEffect(() => { setCart(readCart(ownerId)); }, [ownerId]);

  const totals = useMemo(() => cartTotals(cart), [cart]);
  const product = useMemo(() => products.find(value => String(value.id) === productId) || null, [products, productId]);
  const similar = useMemo(() => (
    product
      ? products
        .filter(value => value.available && value.category === product.category && String(value.id) !== String(product.id))
        .sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name))
        .slice(0, 6)
      : []
  ), [products, product]);
  const qtyFor = id => cart.find(line => line.productId === String(id))?.qty || 0;

  const handleAdd = value => setCart(addToCart(ownerId, value, 1));
  const handleSetQty = (value, next) => setCart(setCartQty(ownerId, value.id, next));
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
        <ImageWithFallback src={getFileUrl(product.image)} fallback={PRODUCT_PLACEHOLDER} alt={product.name} className="shop-detail-hero-image" />
        {!product.available && <span className="shop-stock-veil">Out of stock</span>}
        {off > 0 && <span className="shop-off-badge shop-off-badge-hero">{off}% off</span>}
      </div>

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
