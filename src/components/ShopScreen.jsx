import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronRight,
  Clock3,
  Minus,
  Package,
  Plus,
  RefreshCw,
  Search,
  ShoppingBag,
  SlidersHorizontal,
  Star,
  Truck,
  X,
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
import { addToCart, cartTotals, readCart, setCartQty } from '../lib/shopOrders';
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
export function ShopQuantityControl({ qty, onAdd, onSet, disabled = false, small = false }) {
  if (disabled) {
    return <span className={cx('shop-stock-chip', small && 'small')}>Out of stock</span>;
  }
  if (qty > 0) {
    return (
      <div className={cx('shop-stepper', small && 'small')} role="group" aria-label="Change quantity">
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
    <button type="button" className={cx('shop-add-button', small && 'small')} onClick={onAdd}>
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

// ── The Shop tab ─────────────────────────────────────────────────────────────
export function ShopScreen({ session, navigate, notify }) {
  const ownerId = shopOwnerId(session);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cart, setCart] = useState(() => readCart(ownerId));
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [gender, setGender] = useState('all');
  const [priceRange, setPriceRange] = useState('all');
  const [sort, setSort] = useState('popular');
  const [detail, setDetail] = useState(null);

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
              <ShopProductCard key={product.id} product={product} qty={qtyFor(product.id)} onAdd={handleAdd} onSetQty={handleSetQty} onOpen={setDetail} />
            ))}
          </div>
        </>
      ) : (
        <EmptyState icon={Search} title="No products match" message="Try a different search, category or price range." action={<Button variant="secondary" onClick={resetFilters}>Clear filters</Button>} />
      )}

      {totals.itemCount > 0 && (
        <button type="button" className="shop-cart-bar" onClick={() => navigate('shopCart')}>
          <span className="shop-cart-bar-left">
            <ShoppingBag size={17} />
            <span><strong>{totals.itemCount} item{totals.itemCount === 1 ? '' : 's'}</strong> · {formatCurrency(totals.total)}</span>
          </span>
          <span className="shop-cart-bar-cta">View cart <ChevronRight size={16} /></span>
        </button>
      )}

      {detail && (
        <div className="shop-detail-backdrop" onClick={() => setDetail(null)} role="dialog" aria-modal="true" aria-label={detail.name}>
          <div className="shop-detail-sheet" onClick={event => event.stopPropagation()}>
            <div className="shop-detail-sheet-head">
              <h2>{detail.name}</h2>
              <button type="button" className="shop-detail-close" onClick={() => setDetail(null)} aria-label="Close product details">
                <X size={18} />
              </button>
            </div>
            <div className="shop-detail-media">
              <ImageWithFallback src={getFileUrl(detail.image)} fallback={PRODUCT_PLACEHOLDER} alt={detail.name} />
            </div>
            <div className="shop-detail-body">
              <div className="shop-card-price-row">
                <div>
                  <strong>{formatCurrency(detail.price)}</strong>
                  {detail.mrp > 0 && <s>{formatCurrency(detail.mrp)}</s>}
                  {discountPercent(detail) > 0 && <em className="shop-off-badge inline">{discountPercent(detail)}% off</em>}
                </div>
                {detail.rating > 0 && <span className="shop-rating"><Star size={12} /> {Number(detail.rating).toFixed(1)}</span>}
              </div>
              <p className="shop-detail-meta">{categoryLabel(detail.category)} · {SHOP_GENDERS.find(g => g.id === detail.gender)?.label || 'Unisex'}{detail.salonName ? ` · sold by ${detail.salonName}` : ' · supplied by My Naai'}</p>
              {detail.description && <p className="shop-detail-desc">{detail.description}</p>}
              <p className="shop-detail-note"><Truck size={14} /> {detail.price >= 499 ? 'Free delivery on this item' : `Add ${formatCurrency(Math.max(0, 499 - detail.price))} more for free delivery`}</p>
              <ShopQuantityControl qty={qtyFor(detail.id)} onAdd={() => handleAdd(detail)} onSet={next => handleSetQty(detail, next)} disabled={!detail.available} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
