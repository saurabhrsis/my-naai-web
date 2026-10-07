import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bookmark,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  ClipboardX,
  MapPin,
  Minus,
  Package,
  PackageCheck,
  Plus,
  RotateCcw,
  Search,
  Share2,
  ShoppingBag,
  ShoppingCart,
  Store,
  Tag,
  Trash2,
  Truck,
  Wallet,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import {
  SORT_OPTIONS,
  SHOP_CATEGORIES,
  cancelShopOrder,
  cartLineFromProduct,
  cartTotals,
  filterShopProducts,
  formatAddress,
  isLowStock,
  loadOrders,
  loadShopProducts,
  maxOrderQuantity,
  readCart,
  readSaved,
  reconcileCart,
  reconcileSaved,
  relatedShopProducts,
  salonAddressFromProfile,
  saveCart,
  saveSaved,
  shareShopProduct,
  sortShopProducts,
  submitOrder,
  validateAddress,
} from '../lib/shop';
import { useConfirm } from './ConfirmDialog';
import {
  Button,
  EmptyState,
  Field,
  ImageWithFallback,
  PageHeader,
  Rating,
  SkeletonCard,
  Spinner,
  StatusPill,
  cx,
  formatCurrency,
  formatDateTime,
  getErrorMessage,
} from './Shared';

const PRODUCT_PLACEHOLDER = '/assets/brand/product-placeholder.svg';

// The shop is one tab in the partner bottom bar, so its screens are one route
// with a `view` — /shop, /shop?view=cart, /shop?view=product&productId=… Every
// step is therefore a real history entry: the browser back button (and the
// phone gesture) walks back through the flow, and a shared deep link opens the
// exact step it names.
const VIEWS = ['browse', 'product', 'cart', 'checkout', 'orders', 'order'];

export function SalonShopScreen({ session, navigate, notify, params = {} }) {
  const salonId = String(session?.userId || '');
  const requestedView = String(params?.view || 'browse');
  const view = VIEWS.includes(requestedView) ? requestedView : 'browse';
  const productId = String(params?.productId || '');
  const orderId = String(params?.orderId || '');

  const go = useCallback((next, extra = {}) => {
    navigate('shop', next === 'browse' ? extra : { view: next, ...extra });
  }, [navigate]);

  // ── Catalog ────────────────────────────────────────────────────────────────
  // `sort` is sent to the API as well as applied here, so a backend that can
  // sort returns an ordered page and one that cannot still reads right.
  const [filters, setFilters] = useState({ search: '', category: 'All', sort: 'relevance', inStockOnly: false });
  const [reloadTick, setReloadTick] = useState(0);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [catalogSource, setCatalogSource] = useState('api');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    // Typing in the search box must not fire one request per keystroke.
    const timer = window.setTimeout(async () => {
      try {
        const result = await loadShopProducts({ search: filters.search, category: filters.category, sort: filters.sort });
        if (!alive) return;
        setProducts(result.products);
        setCatalogSource(result.source);
        setLoadError('');
      } catch (error) {
        if (!alive) return;
        setProducts([]);
        setCatalogSource('api');
        setLoadError(getErrorMessage(error, 'Could not load the shop catalog.'));
      } finally {
        if (alive) setLoading(false);
      }
    }, filters.search ? 300 : 0);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [filters.search, filters.category, filters.sort, reloadTick]);

  // ── Cart ───────────────────────────────────────────────────────────────────
  const [cart, setCart] = useState(() => readCart(salonId));
  useEffect(() => { saveCart(salonId, cart); }, [salonId, cart]);

  // A cart restored from storage can hold something admin has since removed,
  // hidden or run out of. Re-check it when the catalog arrives — but only then,
  // so this never fights the partner's own edits. The cart is read from a ref
  // and is deliberately NOT a dependency here: listing it would re-run this on
  // every tap of a quantity stepper and immediately overwrite the change.
  const cartRef = useRef(cart);
  cartRef.current = cart;
  useEffect(() => {
    if (!products.length || !cartRef.current.length) return;
    const next = reconcileCart(cartRef.current, products);
    const changed = next.length !== cartRef.current.length
      || next.some((item, index) => item.quantity !== cartRef.current[index]?.quantity);
    if (changed) setCart(next);
  }, [products]);

  const totals = useMemo(() => cartTotals(cart), [cart]);
  const quantityOf = useCallback(id => cart.find(item => item.productId === id)?.quantity || 0, [cart]);

  // "Save for later" — parked lines that are never ordered and never counted in
  // the total. It lives beside the cart so a partner can set an item aside
  // instead of deleting it and hunting for it again.
  const [saved, setSaved] = useState(() => readSaved(salonId));
  useEffect(() => { saveSaved(salonId, saved); }, [salonId, saved]);
  const savedRef = useRef(saved);
  savedRef.current = saved;
  useEffect(() => {
    if (!products.length || !savedRef.current.length) return;
    const next = reconcileSaved(savedRef.current, products);
    if (next.length !== savedRef.current.length) setSaved(next);
  }, [products]);

  // Both moves are plain state updates, never nested inside an updater: React
  // may replay an updater, and a side effect in there would run twice.
  const saveForLater = useCallback(id => {
    const line = cart.find(item => item.productId === id);
    if (!line) return;
    setCart(current => current.filter(item => item.productId !== id));
    setSaved(current => (current.some(item => item.productId === id) ? current : [...current, line]));
    notify?.('success', 'Saved for later.');
  }, [cart, notify]);

  const moveToCart = useCallback(id => {
    const line = saved.find(item => item.productId === id);
    if (!line) return;
    const limit = Math.max(1, maxOrderQuantity(line));
    setSaved(current => current.filter(item => item.productId !== id));
    setCart(current => (current.some(item => item.productId === id)
      ? current
      : [...current, { ...line, quantity: Math.min(Math.max(1, Number(line.quantity) || 1), limit) }]));
  }, [saved]);

  const removeSaved = useCallback(id => setSaved(current => current.filter(item => item.productId !== id)), []);

  const addToCart = useCallback((product, quantity = 1) => {
    const limit = maxOrderQuantity(product);
    if (!limit) { notify?.('error', `${product.name} is out of stock.`); return; }
    let blocked = false;
    setCart(current => {
      const existing = current.find(item => item.productId === product.id);
      if (!existing) return [...current, cartLineFromProduct(product, quantity)];
      const next = Math.min(existing.quantity + quantity, limit);
      if (next === existing.quantity) { blocked = true; return current; }
      return current.map(item => (item.productId === product.id ? { ...item, quantity: next } : item));
    });
    if (blocked) notify?.('error', `Only ${limit} left in stock.`);
    else notify?.('success', `${product.name} added to the cart.`);
  }, [notify]);

  const setQuantity = useCallback((id, quantity) => {
    setCart(current => (quantity <= 0
      ? current.filter(item => item.productId !== id)
      : current.map(item => (item.productId === id ? { ...item, quantity } : item))));
  }, []);

  // ── Orders ─────────────────────────────────────────────────────────────────
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersSource, setOrdersSource] = useState('api');
  const [orderFilter, setOrderFilter] = useState('all');
  const [cancellingId, setCancellingId] = useState('');
  const confirm = useConfirm();

  const refreshOrders = useCallback(async () => {
    setOrdersLoading(true);
    try {
      const result = await loadOrders({ salonId });
      setOrders(result.orders);
      setOrdersSource(result.source);
    } catch (error) {
      notify?.('error', getErrorMessage(error, 'Could not load your orders.'));
    } finally {
      setOrdersLoading(false);
    }
  }, [notify, salonId]);

  useEffect(() => { refreshOrders(); }, [refreshOrders]);

  const cancelOrder = useCallback(async order => {
    const confirmed = await confirm({
      title: 'Cancel this order?',
      message: `Order ${order.orderNumber} will be cancelled. Nothing is charged for a cancelled order.`,
      confirmLabel: 'Yes, cancel order',
      cancelLabel: 'Keep my order',
      tone: 'danger',
      icon: ClipboardX,
    });
    if (!confirmed) return;
    setCancellingId(order.id);
    try {
      const result = await cancelShopOrder(order.id, '', { salonId });
      const updated = result.order;
      setOrders(current => current.map(item => (item.id === updated.id ? updated : item)));
      notify?.('success', `Order ${updated.orderNumber} cancelled.`);
    } catch (error) {
      notify?.('error', getErrorMessage(error, 'Could not cancel this order.'));
    } finally {
      setCancellingId('');
    }
  }, [confirm, notify, salonId]);

  // ── Delivery address (defaults to the salon's own address) ─────────────────
  const sessionProfile = useMemo(() => ({ ...(session?.user || {}), ...(session?.user?.salon || {}) }), [session]);
  const [profile, setProfile] = useState(sessionProfile);
  const [address, setAddress] = useState(() => salonAddressFromProfile(sessionProfile));
  const [addressErrors, setAddressErrors] = useState({});
  const [addressTouched, setAddressTouched] = useState(false);
  const [note, setNote] = useState('');
  const [placing, setPlacing] = useState(false);

  // The stored session can be as thin as `{ salon: { salonId } }`, and the
  // checkout needs a complete address (pincode included) before it can default
  // to one — so fetch the profile once. A partner who has already edited the
  // address (`addressTouched`) keeps their own copy.
  const addressTouchedRef = useRef(false);
  addressTouchedRef.current = addressTouched;
  useEffect(() => {
    let alive = true;
    if (!salonId) return undefined;
    (async () => {
      try {
        const response = await api.salonProfile({ salonId });
        if (!alive) return;
        const data = response?.data?.salon || response?.data || {};
        if (!data || !Object.keys(data).length) return;
        setProfile(current => ({ ...current, ...data }));
        if (!addressTouchedRef.current) setAddress(salonAddressFromProfile(data));
      } catch {
        // The session's own copy is enough to start from.
      }
    })();
    return () => { alive = false; };
  }, [salonId]);

  const salonAddress = useMemo(() => salonAddressFromProfile(profile), [profile]);
  const salonAddressText = formatAddress(salonAddress);
  // An address that is empty on both sides is not "your salon address" — the
  // note would promise a delivery to an address nobody has actually saved.
  const usingSalonAddress = Boolean(salonAddressText) && formatAddress(address) === salonAddressText;

  const placeOrder = useCallback(async () => {
    if (!cart.length) { notify?.('error', 'Your cart is empty.'); return; }
    const errors = validateAddress(address);
    setAddressErrors(errors);
    if (Object.keys(errors).length) {
      notify?.('error', 'Complete the delivery address to place your order.');
      return;
    }
    setPlacing(true);
    try {
      const result = await submitOrder({ items: cart, address, note }, { salonId });
      const order = result.order;
      setOrders(current => [order, ...current.filter(item => item.id !== order.id)]);
      setCart([]);
      setNote('');
      notify?.('success', result.source === 'local'
        ? 'Order saved on this device — the order service could not be reached.'
        : `Order ${order.orderNumber} placed.`);
      go('order', { orderId: order.id });
    } catch (error) {
      notify?.('error', getErrorMessage(error, 'Could not place your order. Please try again.'));
    } finally {
      setPlacing(false);
    }
  }, [address, cart, go, note, notify, salonId]);

  const reorder = useCallback(order => {
    const byId = new Map(products.map(product => [product.id, product]));
    const missing = [];
    const next = [...cart];
    order.items.forEach(line => {
      const product = byId.get(line.productId);
      if (!product || !product.available || !maxOrderQuantity(product)) { missing.push(line.name); return; }
      const quantity = Math.min(line.quantity, maxOrderQuantity(product));
      const existing = next.find(item => item.productId === line.productId);
      if (existing) existing.quantity = Math.min(existing.quantity + quantity, maxOrderQuantity(product));
      else next.push(cartLineFromProduct(product, quantity));
    });
    setCart(next);
    if (missing.length) notify?.('error', `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} no longer available.`);
    else notify?.('success', 'Added to your cart.');
    go('cart');
  }, [cart, go, notify, products]);

  // ── Current view ───────────────────────────────────────────────────────────
  const visibleProducts = useMemo(
    () => sortShopProducts(filterShopProducts(products, filters), filters.sort),
    [products, filters],
  );
  const product = view === 'product' ? products.find(item => item.id === productId) : null;
  const order = view === 'order' ? orders.find(item => item.id === orderId) : null;
  const activeOrders = orders.filter(item => !['DELIVERED', 'CANCELLED'].includes(item.status));
  const isFiltered = Boolean(filters.search) || filters.category !== 'All' || filters.inStockOnly;

  if (view === 'product') {
    if (!product && !loading) {
      return <div className="screen shop-screen">
        <PageHeader title="Product" onBack={() => go('browse')} />
        <EmptyState icon={Package} title="We could not find that product" message="It may have been removed from the catalog." action={<Button onClick={() => go('browse')}>Back to shop</Button>} />
      </div>;
    }
    if (!product) return <div className="screen shop-screen"><PageHeader title="Product" onBack={() => go('browse')} /><div className="shop-loading"><Spinner label="Loading product…" /></div></div>;
    return <ProductDetailView
      product={product}
      related={relatedShopProducts(products, product)}
      quantity={quantityOf(product.id)}
      totals={totals}
      onBack={() => go('browse')}
      onAdd={quantity => addToCart(product, quantity)}
      onSetQuantity={quantity => setQuantity(product.id, quantity)}
      onOpenCart={() => go('cart')}
      onOpenProduct={id => go('product', { productId: id })}
      onShare={() => shareShopProduct(product, notify)}
    />;
  }

  if (view === 'cart') {
    return <CartView
      items={cart}
      saved={saved}
      totals={totals}
      suggestions={relatedShopProducts(products, null, 4)}
      onBack={() => go('browse')}
      onSetQuantity={setQuantity}
      onRemove={id => setQuantity(id, 0)}
      onSaveForLater={saveForLater}
      onMoveToCart={moveToCart}
      onRemoveSaved={removeSaved}
      onClear={() => setCart([])}
      onCheckout={() => go('checkout')}
      onBrowse={() => go('browse')}
      onAddSuggestion={item => addToCart(item, 1)}
    />;
  }

  if (view === 'checkout') {
    return <CheckoutView
      items={cart}
      totals={totals}
      address={address}
      addressErrors={addressErrors}
      usingSalonAddress={usingSalonAddress}
      hasSalonAddress={Boolean(salonAddressText)}
      note={note}
      placing={placing}
      onChangeAddress={next => { setAddressTouched(true); setAddress(next); setAddressErrors({}); }}
      onResetAddress={() => { setAddress(salonAddress); setAddressTouched(false); setAddressErrors({}); }}
      onNote={setNote}
      onBack={() => go('cart')}
      onPlaceOrder={placeOrder}
    />;
  }

  if (view === 'orders') {
    const filtered = orderFilter === 'active' ? activeOrders
      : orderFilter === 'delivered' ? orders.filter(item => item.status === 'DELIVERED')
        : orderFilter === 'cancelled' ? orders.filter(item => item.status === 'CANCELLED')
          : orders;
    return <OrdersView
      orders={filtered}
      allCount={orders.length}
      activeCount={activeOrders.length}
      deliveredCount={orders.filter(item => item.status === 'DELIVERED').length}
      cancelledCount={orders.filter(item => item.status === 'CANCELLED').length}
      filter={orderFilter}
      onFilter={setOrderFilter}
      onBack={() => go('browse')}
      loading={ordersLoading}
      offline={ordersSource === 'local'}
      cancellingId={cancellingId}
      onOpen={id => go('order', { orderId: id })}
      onCancel={cancelOrder}
      onBrowse={() => go('browse')}
      onRefresh={refreshOrders}
    />;
  }

  if (view === 'order') {
    if (!order && !ordersLoading) {
      return <div className="screen shop-screen">
        <PageHeader title="Order" onBack={() => go('orders')} />
        <EmptyState icon={ClipboardList} title="We could not find that order" message="It may have been placed from another device." action={<Button onClick={() => go('orders')}>Back to orders</Button>} />
      </div>;
    }
    if (!order) return <div className="screen shop-screen"><PageHeader title="Order" onBack={() => go('orders')} /><div className="shop-loading"><Spinner label="Loading order…" /></div></div>;
    return <OrderDetailView
      order={order}
      cancelling={cancellingId === order.id}
      onBack={() => go('orders')}
      onCancel={() => cancelOrder(order)}
      onReorder={() => reorder(order)}
    />;
  }

  return <div className="screen shop-screen">
    <PageHeader
      title="Salon shop"
      subtitle="Colours, scrubs, scissors and consumables — delivered to your salon."
      action={<>
        {totals.itemCount > 0 && <button type="button" className="shop-cart-entry" onClick={() => go('cart')} aria-label={`Open cart, ${totals.itemCount} items`}>
          <ShoppingCart size={15} /> <span>{totals.itemCount}</span>
        </button>}
        <button type="button" className="shop-orders-entry" onClick={() => go('orders')}>
          <ClipboardList size={15} /> My orders{orders.length ? <span>{orders.length}</span> : null}
        </button>
      </>}
    />
    {catalogSource === 'sample' && <p className="shop-sample-notice" role="status"><Store size={14} /> Showing the sample catalog — the shop service could not be reached. Orders placed now are saved on this device.</p>}
    {loadError && <div className="shop-error-card" role="alert"><span>{loadError}</span><Button size="small" variant="secondary" onClick={() => setReloadTick(value => value + 1)}>Retry</Button></div>}
    <label className="search-field shop-search">
      <Search size={17} />
      <input value={filters.search} onChange={event => setFilters(current => ({ ...current, search: event.target.value }))} placeholder="Search scrubs, scissors, hair colour…" aria-label="Search shop products" />
      {filters.search ? <button type="button" onClick={() => setFilters(current => ({ ...current, search: '' }))} aria-label="Clear search"><X size={15} /></button> : null}
    </label>
    <div className="booking-tabs shop-tabs">
      {SHOP_CATEGORIES.map(category => <button key={category} type="button" className={filters.category === category ? 'active' : ''} onClick={() => setFilters(current => ({ ...current, category }))}>{category}</button>)}
    </div>
    <div className="shop-toolbar">
      <span className="shop-count" role="status">{loading ? 'Loading the shelf…' : `${visibleProducts.length} product${visibleProducts.length === 1 ? '' : 's'}`}</span>
      <div className="shop-toolbar-controls">
        <label className="shop-sort">
          <span>Sort</span>
          <select value={filters.sort} onChange={event => setFilters(current => ({ ...current, sort: event.target.value }))} aria-label="Sort products">
            {SORT_OPTIONS.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
          </select>
          <ChevronDown size={14} />
        </label>
        <button type="button" className={cx('shop-toggle-chip', filters.inStockOnly && 'active')} aria-pressed={filters.inStockOnly} onClick={() => setFilters(current => ({ ...current, inStockOnly: !current.inStockOnly }))}>
          <CheckCircle2 size={13} /> In stock only
        </button>
      </div>
    </div>
    {loading
      ? <div className="product-grid shop-grid">{[1, 2, 3, 4].map(item => <SkeletonCard key={item} />)}</div>
      : visibleProducts.length
        ? <div className="product-grid shop-grid">{visibleProducts.map(item => <ShopProductCard
          key={item.id}
          product={item}
          quantity={quantityOf(item.id)}
          onOpen={() => go('product', { productId: item.id })}
          onAdd={() => addToCart(item, 1)}
          onSetQuantity={quantity => setQuantity(item.id, quantity)}
        />)}</div>
        : <EmptyState
          icon={ShoppingBag}
          title="No products found"
          message={isFiltered ? 'Nothing matches those filters — try clearing them.' : 'Admin has not published the catalog yet.'}
          action={isFiltered ? <Button variant="secondary" onClick={() => setFilters({ search: '', category: 'All', sort: 'relevance', inStockOnly: false })}>Clear filters</Button> : null}
        />}
    {totals.itemCount > 0 && <div className="shop-cart-bar">
      <div className="shop-cart-bar-copy">
        <small>{totals.itemCount} item{totals.itemCount === 1 ? '' : 's'} in cart</small>
        <strong>{formatCurrency(totals.subtotal)}</strong>
      </div>
      <Button onClick={() => go('cart')}><ShoppingCart size={16} /> View cart</Button>
    </div>}
  </div>;
}

// ── Browse: one product tile ─────────────────────────────────────────────────

function ShopProductCard({ product, quantity, onOpen, onAdd, onSetQuantity }) {
  const limit = maxOrderQuantity(product);
  const inStock = product.available && limit > 0;
  const photoCount = product.images?.length || 0;
  const discount = product.mrp > product.price ? Math.round(((product.mrp - product.price) / product.mrp) * 100) : 0;
  return <article className="product-card shop-product-card">
    <button type="button" className="shop-product-open" onClick={onOpen} aria-label={`View ${product.name}`}>
      <div className="product-image-wrap">
        <ImageWithFallback src={product.images?.[0] || product.image} fallback={PRODUCT_PLACEHOLDER} alt={product.name} className="product-image" />
        {discount > 0 && <span className="shop-discount-label">-{discount}%</span>}
        {!inStock && <span className="stock-label out-stock">Out of stock</span>}
        {inStock && isLowStock(product) && <span className="stock-label low-stock">Only {product.stock} left</span>}
        {photoCount > 1 && <span className="shop-photo-count">{photoCount} photos</span>}
      </div>
      <div className="product-copy">
        <span className="product-salon">{product.brand || product.category}</span>
        <h3>{product.name}</h3>
        <div className="product-price-row">
          <strong>{formatCurrency(product.price)}</strong>
          {product.mrp > 0 && <s className="shop-mrp">{formatCurrency(product.mrp)}</s>}
        </div>
        {Number(product.rating) > 0 && <Rating value={product.rating} />}
        {product.unit && <small className="shop-unit">{product.unit}</small>}
      </div>
    </button>
    <div className="shop-card-actions">
      {quantity > 0
        ? <QuantityStepper value={quantity} max={limit} onChange={onSetQuantity} compact />
        : <Button size="small" variant={inStock ? 'primary' : 'secondary'} disabled={!inStock} onClick={onAdd}>{inStock ? <><Plus size={14} /> Add</> : 'Sold out'}</Button>}
    </div>
  </article>;
}

// ── Product detail ───────────────────────────────────────────────────────────

function ProductDetailView({ product, related = [], quantity, totals, onBack, onAdd, onSetQuantity, onOpenCart, onOpenProduct, onShare }) {
  const [draftQuantity, setDraftQuantity] = useState(1);
  // Admin can attach several photos to one product. They are shown as a main
  // image plus tappable thumbnails — no swipe gallery, nothing to get lost in.
  const photos = product.images?.length ? product.images : (product.image ? [product.image] : []);
  const [photoIndex, setPhotoIndex] = useState(0);
  useEffect(() => { setPhotoIndex(0); }, [product.id]);
  const limit = maxOrderQuantity(product);
  const inStock = product.available && limit > 0;
  const discount = product.mrp > product.price ? Math.round(((product.mrp - product.price) / product.mrp) * 100) : 0;
  const activePhoto = photos[Math.min(photoIndex, photos.length - 1)];
  return <div className="screen shop-screen shop-detail-screen">
    <PageHeader
      title="Product"
      onBack={onBack}
      compact
      action={<button type="button" className="shop-share-button" onClick={onShare} aria-label={`Share ${product.name}`}><Share2 size={15} /> Share</button>}
    />
    <div className="shop-detail">
      <div>
        <div className="shop-detail-media">
          <ImageWithFallback src={activePhoto} fallback={PRODUCT_PLACEHOLDER} alt={product.name} className="shop-detail-image" />
          {discount > 0 && <span className="shop-discount-label">-{discount}%</span>}
          {photos.length > 1 && <span className="shop-photo-count">{Math.min(photoIndex, photos.length - 1) + 1} / {photos.length}</span>}
        </div>
        {photos.length > 1 && <div className="shop-thumb-row">
          {photos.map((src, index) => <button
            key={`${src}-${index}`}
            type="button"
            className={cx('shop-thumb', index === Math.min(photoIndex, photos.length - 1) && 'active')}
            onClick={() => setPhotoIndex(index)}
            aria-label={`Show photo ${index + 1} of ${photos.length}`}
          >
            <ImageWithFallback src={src} fallback={PRODUCT_PLACEHOLDER} alt="" />
          </button>)}
        </div>}
      </div>
      <div className="shop-detail-copy">
        <span className="eyebrow">{product.brand || product.category}</span>
        <h2>{product.name}</h2>
        <div className="shop-detail-meta">
          {Number(product.rating) > 0 && <Rating value={product.rating} />}
          <span className="shop-chip"><Tag size={12} /> {product.category}</span>
        </div>
        <div className="shop-detail-price">
          <strong>{formatCurrency(product.price)}</strong>
          {product.mrp > 0 && <s>{formatCurrency(product.mrp)}</s>}
          {discount > 0 && <em>{discount}% off</em>}
        </div>
        <p className="shop-detail-note">{product.description || 'A My Naai partner essential for your salon.'}</p>
        <div className="shop-detail-facts">
          {product.unit ? <span><Package size={14} /> {product.unit}</span> : null}
          <span><ShoppingBag size={14} /> {product.brand || 'My Naai shop'}</span>
          <span className={inStock ? '' : 'is-out'}><Truck size={14} /> {inStock ? (isLowStock(product) ? `Only ${product.stock} left` : 'In stock') : 'Out of stock'}</span>
        </div>
        <div className="shop-detail-buy">
          {quantity > 0
            ? <>
              <QuantityStepper value={quantity} max={limit} onChange={onSetQuantity} />
              <Button variant="secondary" onClick={onOpenCart}><ShoppingCart size={16} /> Go to cart</Button>
            </>
            : <>
              <QuantityStepper value={draftQuantity} max={limit} onChange={value => setDraftQuantity(Math.max(1, value))} />
              <Button disabled={!inStock} onClick={() => onAdd(draftQuantity)}><ShoppingCart size={16} /> {inStock ? 'Add to cart' : 'Out of stock'}</Button>
            </>}
        </div>
        <p className="shop-detail-delivery"><Truck size={14} /> Free delivery — you pay only for the items. Delivered to your salon address.</p>
      </div>
    </div>
    {related.length > 0 && <section className="shop-related">
      <h3>More from {product.category || 'the shop'}</h3>
      <div className="shop-related-row">
        {related.map(item => <button key={item.id} type="button" className="shop-related-card" onClick={() => onOpenProduct(item.id)}>
          <ImageWithFallback src={item.images?.[0] || item.image} fallback={PRODUCT_PLACEHOLDER} alt={item.name} />
          <strong>{item.name}</strong>
          <b>{formatCurrency(item.price)}</b>
        </button>)}
      </div>
    </section>}
    {totals.itemCount > 0 && <div className="shop-cart-bar">
      <div className="shop-cart-bar-copy">
        <small>{totals.itemCount} item{totals.itemCount === 1 ? '' : 's'} in cart</small>
        <strong>{formatCurrency(totals.subtotal)}</strong>
      </div>
      <Button onClick={onOpenCart}><ShoppingCart size={16} /> View cart</Button>
    </div>}
  </div>;
}

// ── Cart ─────────────────────────────────────────────────────────────────────

function CartView({ items, saved = [], totals, suggestions = [], onBack, onSetQuantity, onRemove, onSaveForLater, onMoveToCart, onRemoveSaved, onClear, onCheckout, onBrowse, onAddSuggestion }) {
  return <div className="screen shop-screen">
    <PageHeader
      title="Your cart"
      subtitle={totals.itemCount ? `${totals.itemCount} item${totals.itemCount === 1 ? '' : 's'} ready to order.` : 'Nothing here yet.'}
      onBack={onBack}
      action={items.length ? <button type="button" className="refresh-text-button" onClick={onClear}><Trash2 size={15} /> Clear</button> : null}
    />
    {!items.length
      ? <>
        <EmptyState icon={ShoppingCart} title="Your cart is empty" message="Add the colours, scrubs and tools your salon needs." action={<Button onClick={onBrowse}><ShoppingBag size={16} /> Browse the shop</Button>} />
        {suggestions.length > 0 && <section className="shop-related">
          <h3>Popular in the shop</h3>
          <div className="shop-related-row">
            {suggestions.map(item => <button key={item.id} type="button" className="shop-related-card" onClick={() => onAddSuggestion(item)} aria-label={`Add ${item.name} to the cart`}>
              <ImageWithFallback src={item.images?.[0] || item.image} fallback={PRODUCT_PLACEHOLDER} alt={item.name} />
              <strong>{item.name}</strong>
              <b>{formatCurrency(item.price)}</b>
              <em>{item.available && maxOrderQuantity(item) ? 'Add' : 'Sold out'}</em>
            </button>)}
          </div>
        </section>}
      </>
      : <div className="shop-cart-layout">
        <div className="shop-cart-list">
          {items.map(item => <article className="shop-cart-row" key={item.productId}>
            <div className="shop-cart-thumb"><ImageWithFallback src={item.images?.[0] || item.image} fallback={PRODUCT_PLACEHOLDER} alt={item.name} /></div>
            <div className="shop-cart-copy">
              <strong>{item.name}</strong>
              <small>{item.unit || item.category || 'My Naai shop'}</small>
              <div className="shop-cart-line-price"><b>{formatCurrency(item.price * item.quantity)}</b>{item.mrp > item.price ? <s>{formatCurrency(item.mrp * item.quantity)}</s> : null}</div>
            </div>
            <div className="shop-cart-controls">
              <QuantityStepper value={item.quantity} max={item.stock ? Math.min(item.stock, 99) : 99} onChange={value => onSetQuantity(item.productId, value)} compact />
              <div className="shop-cart-row-actions">
                <button type="button" className="shop-save-line" onClick={() => onSaveForLater(item.productId)}><Bookmark size={13} /> Save for later</button>
                <button type="button" className="shop-cart-remove" onClick={() => onRemove(item.productId)} aria-label={`Remove ${item.name}`}><Trash2 size={14} /></button>
              </div>
            </div>
          </article>)}
        </div>
        <aside className="shop-summary-card">
          <h3>Order summary</h3>
          <SummaryRows totals={totals} />
          <Button className="shop-block-button" onClick={onCheckout}><PackageCheck size={16} /> Place order</Button>
          <p className="shop-summary-foot">No online payment — you pay on delivery.</p>
        </aside>
      </div>}
    {saved.length > 0 && <section className="shop-saved">
      <div className="shop-panel-head"><h3><Bookmark size={15} /> Saved for later ({saved.length})</h3></div>
      <div className="shop-cart-list">
        {saved.map(item => {
          const canOrder = item.available !== false && Number(item.stock || 0) !== 0;
          return <article className="shop-cart-row is-saved" key={item.productId}>
            <div className="shop-cart-thumb"><ImageWithFallback src={item.images?.[0] || item.image} fallback={PRODUCT_PLACEHOLDER} alt={item.name} /></div>
            <div className="shop-cart-copy">
              <strong>{item.name}</strong>
              <small>{item.unit || item.category || 'My Naai shop'}</small>
              <div className="shop-cart-line-price"><b>{formatCurrency(item.price)}</b>{canOrder ? null : <s>Out of stock</s>}</div>
            </div>
            <div className="shop-cart-controls">
              <Button size="small" variant="secondary" disabled={!canOrder} onClick={() => onMoveToCart(item.productId)}><ShoppingCart size={14} /> Move to cart</Button>
              <button type="button" className="shop-cart-remove" onClick={() => onRemoveSaved(item.productId)} aria-label={`Remove ${item.name} from saved items`}><Trash2 size={14} /></button>
            </div>
          </article>;
        })}
      </div>
      <p className="shop-summary-foot">Saved items are never ordered and are not counted in the total.</p>
    </section>}
  </div>;
}

// ── Checkout ─────────────────────────────────────────────────────────────────

function CheckoutView({ items, totals, address, addressErrors, usingSalonAddress, hasSalonAddress, note, placing, onChangeAddress, onResetAddress, onNote, onBack, onPlaceOrder }) {
  const set = key => event => onChangeAddress({ ...address, [key]: event.target.value });
  if (!items.length) {
    return <div className="screen shop-screen">
      <PageHeader title="Checkout" onBack={onBack} />
      <EmptyState icon={ShoppingCart} title="Your cart is empty" message="Add products before checking out." action={<Button onClick={onBack}><ShoppingBag size={16} /> Back to shop</Button>} />
    </div>;
  }
  return <div className="screen shop-screen">
    <PageHeader title="Checkout" subtitle="One last look before your order goes to the store." onBack={onBack} />
    <div className="shop-checkout-layout">
      <div className="shop-checkout-main">
        <section className="shop-panel">
          <div className="shop-panel-head">
            <h3><MapPin size={15} /> Delivery address</h3>
            {hasSalonAddress && !usingSalonAddress && <button type="button" className="shop-reset-address" onClick={onResetAddress}><RotateCcw size={13} /> Use salon address</button>}
          </div>
          {usingSalonAddress && <p className="shop-panel-note">Delivering to your salon address — change any field for a one-off delivery.</p>}
          <div className="shop-form-grid">
            <Field label="Contact name" error={addressErrors.name} required><input value={address.name || ''} onChange={set('name')} placeholder="Salon owner or manager" /></Field>
            <Field label="Mobile number" error={addressErrors.phone} required><input value={address.phone || ''} onChange={set('phone')} inputMode="numeric" placeholder="10-digit mobile" /></Field>
            <Field label="Address" error={addressErrors.line1} required className="shop-form-wide"><input value={address.line1 || ''} onChange={set('line1')} placeholder="Shop no., building, street" /></Field>
            <Field label="Landmark / area" className="shop-form-wide"><input value={address.line2 || ''} onChange={set('line2')} placeholder="Optional" /></Field>
            <Field label="City" error={addressErrors.city} required><input value={address.city || ''} onChange={set('city')} placeholder="City" /></Field>
            <Field label="State"><input value={address.state || ''} onChange={set('state')} placeholder="State" /></Field>
            <Field label="Pincode" error={addressErrors.pincode} required><input value={address.pincode || ''} onChange={set('pincode')} inputMode="numeric" placeholder="440001" /></Field>
          </div>
        </section>
        <section className="shop-panel">
          <div className="shop-panel-head"><h3><ShoppingBag size={15} /> {totals.itemCount} item{totals.itemCount === 1 ? '' : 's'}</h3></div>
          <div className="shop-checkout-items">
            {items.map(item => <div className="shop-checkout-item" key={item.productId}>
              <div className="shop-cart-thumb small"><ImageWithFallback src={item.image} fallback={PRODUCT_PLACEHOLDER} alt={item.name} /></div>
              <div><strong>{item.name}</strong><small>{item.unit ? `${item.unit} · ` : ''}Qty {item.quantity}</small></div>
              <b>{formatCurrency(item.price * item.quantity)}</b>
            </div>)}
          </div>
          <Field label="Note for the store" hint="Optional — anything the packer should know."><input value={note} onChange={event => onNote(event.target.value)} placeholder="e.g. ring the bell, leave with the guard" /></Field>
        </section>
        <section className="shop-panel">
          <div className="shop-panel-head"><h3><Wallet size={15} /> Payment</h3></div>
          <label className="shop-payment-option is-selected">
            <input type="radio" name="shopPaymentMethod" checked readOnly />
            <span><strong>Cash on delivery</strong><small>Pay the courier when the parcel reaches your salon. Online payment is not switched on yet.</small></span>
            <CheckCircle2 size={17} />
          </label>
        </section>
      </div>
      <aside className="shop-summary-card">
        <h3>Order summary</h3>
        <SummaryRows totals={totals} />
        <Button className="shop-block-button" onClick={onPlaceOrder} loading={placing}><PackageCheck size={16} /> Place order</Button>
        <p className="shop-summary-foot">Payment is offline — nothing is charged now.</p>
      </aside>
    </div>
  </div>;
}

// ── Orders ───────────────────────────────────────────────────────────────────

function OrdersView({ orders, allCount, activeCount, deliveredCount, cancelledCount, filter, onFilter, onBack, loading, offline, cancellingId, onOpen, onCancel, onBrowse, onRefresh }) {
  const tabs = [
    { key: 'all', label: 'All', count: allCount },
    { key: 'active', label: 'Active', count: activeCount },
    { key: 'delivered', label: 'Delivered', count: deliveredCount },
    { key: 'cancelled', label: 'Cancelled', count: cancelledCount },
  ];
  return <div className="screen shop-screen">
    <PageHeader
      title="My orders"
      subtitle="Everything your salon has ordered from the shop."
      onBack={onBack}
      action={<button type="button" className="refresh-text-button" onClick={onRefresh}><RotateCcw size={15} /> Refresh</button>}
    />
    {offline && <p className="shop-sample-notice" role="status"><Store size={14} /> The order service could not be reached — these orders are saved on this device.</p>}
    <div className="booking-tabs shop-tabs">
      {tabs.map(tab => <button key={tab.key} type="button" className={filter === tab.key ? 'active' : ''} onClick={() => onFilter(tab.key)}>{tab.label} <span>{tab.count}</span></button>)}
    </div>
    {loading
      ? <div className="list-stack">{[1, 2, 3].map(item => <SkeletonCard key={item} />)}</div>
      : orders.length
        ? <div className="shop-order-list">{orders.map(item => <OrderCard key={item.id} order={item} cancelling={cancellingId === item.id} onOpen={() => onOpen(item.id)} onCancel={() => onCancel(item)} />)}</div>
        : <EmptyState icon={ClipboardList} title="No orders yet" message="Order your salon supplies and they will show up here." action={<Button onClick={onBrowse}><ShoppingBag size={16} /> Start shopping</Button>} />}
  </div>;
}

function OrderCard({ order, cancelling, onOpen, onCancel }) {
  const status = order.statusMeta;
  return <article className="shop-order-card">
    <button type="button" className="shop-order-open" onClick={onOpen} aria-label={`Open order ${order.orderNumber}`}>
      <div className="shop-order-thumbs">
        {(order.items.slice(0, 3) || []).map((item, index) => <span key={`${item.productId}-${index}`}><ImageWithFallback src={item.image} fallback={PRODUCT_PLACEHOLDER} alt="" /></span>)}
        {order.items.length > 3 && <em>+{order.items.length - 3}</em>}
      </div>
      <div className="shop-order-copy">
        <div className="shop-order-title-row">
          <div><span className="eyebrow">ORDER</span><h3>#{order.orderNumber}</h3></div>
          <StatusPill tone={status.tone} dot>{status.label}</StatusPill>
        </div>
        <p>{formatDateTime(order.createdAt)} · {order.itemCount} item{order.itemCount === 1 ? '' : 's'} · {order.paymentMethod === 'COD' ? 'Cash on delivery' : order.paymentMethod}</p>
        <strong className="shop-order-total">{formatCurrency(order.totalAmount)}</strong>
      </div>
      <ChevronRight size={17} />
    </button>
    {order.canCancel && <button type="button" className="shop-order-cancel" onClick={onCancel} disabled={cancelling}>{cancelling ? <Spinner size={13} /> : <><X size={13} /> Cancel order</>}</button>}
  </article>;
}

const TRACKER_STEPS = [
  { key: 'PLACED', label: 'Placed' },
  { key: 'CONFIRMED', label: 'Confirmed' },
  { key: 'PACKED', label: 'Packed' },
  { key: 'SHIPPED', label: 'Shipped' },
  { key: 'OUT_FOR_DELIVERY', label: 'Out for delivery' },
  { key: 'DELIVERED', label: 'Delivered' },
];

function OrderDetailView({ order, cancelling, onBack, onCancel, onReorder }) {
  const status = order.statusMeta;
  const reached = TRACKER_STEPS.findIndex(step => step.key === status.key);
  return <div className="screen shop-screen">
    <PageHeader title={`Order #${order.orderNumber}`} subtitle={`Placed ${formatDateTime(order.createdAt)}`} onBack={onBack} action={<StatusPill tone={status.tone} dot>{status.label}</StatusPill>} />
    {status.key === 'CANCELLED'
      ? <div className="shop-cancelled-banner" role="status"><X size={15} /> This order was cancelled.</div>
      : <div className="shop-tracker">
        {TRACKER_STEPS.map((step, index) => <div key={step.key} className={cx('shop-tracker-step', index <= reached && 'done', index === reached && 'current')}>
          <span className="shop-tracker-dot">{index < reached ? <CheckCircle2 size={13} /> : null}</span>
          <small>{step.label}</small>
        </div>)}
      </div>}
    {status.note ? <p className="shop-status-note">{status.note}</p> : null}
    <section className="shop-panel">
      <div className="shop-panel-head"><h3><ShoppingBag size={15} /> Items</h3></div>
      <div className="shop-checkout-items">
        {order.items.map((item, index) => <div className="shop-checkout-item" key={`${item.productId}-${index}`}>
          <div className="shop-cart-thumb small"><ImageWithFallback src={item.image} fallback={PRODUCT_PLACEHOLDER} alt={item.name} /></div>
          <div><strong>{item.name}</strong><small>{item.unit ? `${item.unit} · ` : ''}Qty {item.quantity}</small></div>
          <b>{formatCurrency(item.lineTotal || item.price * item.quantity)}</b>
        </div>)}
      </div>
    </section>
    <section className="shop-panel">
      <div className="shop-panel-head"><h3><MapPin size={15} /> Delivering to</h3></div>
      <p className="shop-address-line">{order.address?.name || 'Salon'}{order.address?.phone ? ` · ${order.address.phone}` : ''}</p>
      <p className="shop-address-line muted">{formatAddress(order.address) || 'Address not recorded'}</p>
    </section>
    <aside className="shop-summary-card">
      <h3>Payment summary</h3>
      <div className="shop-summary-row"><span>Items total</span><b>{formatCurrency(order.subtotal)}</b></div>
      <div className="shop-summary-row total"><span>Total</span><b>{formatCurrency(order.totalAmount)}</b></div>
      <p className="shop-summary-foot">{order.paymentMethod === 'COD' ? 'Cash on delivery — pay when the parcel arrives.' : order.paymentMethod}{order.note ? ` · “${order.note}”` : ''}</p>
    </aside>
    <div className="shop-detail-actions">
      {order.canCancel && <Button variant="secondary" onClick={onCancel} disabled={cancelling}>{cancelling ? <Spinner size={16} /> : <><X size={15} /> Cancel order</>}</Button>}
      <Button variant="secondary" onClick={onReorder}><RotateCcw size={15} /> Reorder</Button>
    </div>
  </div>;
}

// ── Shared pieces ────────────────────────────────────────────────────────────

function QuantityStepper({ value, max, onChange, compact = false }) {
  const atMax = max > 0 && value >= max;
  return <div className={cx('shop-qty', compact && 'compact')}>
    <button type="button" onClick={() => onChange(value - 1)} aria-label="Decrease quantity" disabled={value <= 1 && !compact}><Minus size={13} /></button>
    <span aria-live="polite">{value}</span>
    <button type="button" onClick={() => onChange(value + 1)} aria-label="Increase quantity" disabled={atMax}><Plus size={13} /></button>
  </div>;
}

function SummaryRows({ totals }) {
  return <>
    <div className="shop-summary-row"><span>Items total</span><b>{formatCurrency(totals.subtotal)}</b></div>
    {totals.savings > 0 ? <div className="shop-summary-row"><span>You save</span><b className="is-good">-{formatCurrency(totals.savings)}</b></div> : null}
    <div className="shop-summary-row"><span>Delivery</span><b>Free</b></div>
    <div className="shop-summary-row total"><span>Total</span><b>{formatCurrency(totals.total)}</b></div>
  </>;
}

export { VIEWS };
