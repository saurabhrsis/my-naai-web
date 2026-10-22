import React, { useEffect, useMemo, useState } from 'react';
import {
  Banknote,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  LoaderCircle,
  MapPin,
  ShieldCheck,
  ShoppingBag,
  Trash2,
  Truck,
  XCircle,
} from 'lucide-react';
import { getFileUrl } from '../lib/api';
import {
  describePaymentFailure,
  getRazorpayKeyId,
  loadRazorpayCheckout,
  openRazorpayOrderlessCheckout,
} from '../lib/razorpay';
import {
  cartCount,
  cartTotals,
  clearCart,
  freeDeliveryGap,
  placeOrder,
  readCart,
  removeLocalOrder,
  setOrderSyncState,
} from '../lib/shopOrders';
import { useShopSettings } from '../lib/shopSettings';
import { normalizeStateName, stateOptionsWith } from '../lib/stateOptions';
import { shopCopy } from '../lib/shopBuyer';
import { formatCoordinates, mapsUrl, toPoint } from '../lib/geo';
import { clearServerCart, queuePendingOrder, registerServerOrder } from '../lib/shopServerSync';
import {
  Button,
  EmptyState,
  Field,
  ImageWithFallback,
  PageHeader,
  SelectField,
  cx,
  formatCurrency,
  getBrowserLocation,
} from './Shared';
import { LocationMap } from './LocationMap.jsx';
import { useConfirm } from './ConfirmDialog';
import { ShopQuantityControl, shopOwnerId, shopSalonName, useSyncedCart } from './ShopScreen';

const PRODUCT_PLACEHOLDER = '/assets/brand/product-placeholder.svg';
const SUPPORT_PHONE = '8380017393';

/* ------------------------------------------------------------------ *\
 * Bill card — shared by the cart, the checkout summary and the success
 * view. `settings` is the admin-managed shop rules; `method` adds the COD
 * charges when COD is the chosen payment; `amounts` (success view) freezes
 * the bill exactly as the order was billed — the settings may have moved
 * since.
 * ------------------------------------------------------------------ */
export function ShopBillCard({ lines, settings, method, title = 'Bill details', amounts, stage = 'checkout' }) {
  const totals = amounts || cartTotals(lines, settings, { method });
  // TWO STAGES, ON PURPOSE.
  //
  // `cart`   — the salon is still deciding. Only the products are on the bill:
  //            item total, the admin's item discount, MRP savings. Delivery is
  //            NOT added here, because it depends on the address, the payment
  //            method and the admin's free-delivery threshold, and charging it
  //            in the cart made a ₹99 item look like a ₹199 cart. The row says
  //            where the fee appears instead of quoting a number the salon has
  //            not agreed to yet.
  // `checkout` — the full bill, once the delivery details and payment method
  //            are known: delivery fee, COD charges and the real "To pay".
  const atCheckout = stage === 'checkout';
  return (
    <section className="shop-bill-card">
      <h3>{title}</h3>
      <div className="shop-bill-row"><span>Item total</span><span>{formatCurrency(totals.itemTotal)}</span></div>
      {totals.discount > 0 && (
        <div className="shop-bill-row saving">
          <span>Order discount{totals.discountPercent ? ` (${totals.discountPercent}%)` : ''}</span>
          <span>− {formatCurrency(totals.discount)}</span>
        </div>
      )}
      {totals.savings > 0 && <div className="shop-bill-row saving"><span>MRP savings</span><span>− {formatCurrency(totals.savings)}</span></div>}
      {atCheckout ? (
        <>
          <div className="shop-bill-row">
            <span>Delivery fee</span>
            {totals.deliveryFee === 0 && lines.length > 0
              ? <span className="shop-bill-free">FREE</span>
              : <span>{totals.deliveryFee === 0 ? '—' : formatCurrency(totals.deliveryFee)}</span>}
          </div>
          {totals.codFee > 0 && <div className="shop-bill-row"><span>COD charges</span><span>{formatCurrency(totals.codFee)}</span></div>}
          <div className="shop-bill-row total"><span>To pay</span><strong>{formatCurrency(totals.total)}</strong></div>
        </>
      ) : (
        <>
          <div className="shop-bill-row pending">
            <span>Delivery fee</span>
            <span>At checkout</span>
          </div>
          <div className="shop-bill-row total"><span>Items total</span><strong>{formatCurrency(totals.subtotal)}</strong></div>
          <p className="shop-bill-note">
            Product value only — delivery is calculated on the next step, once your address is confirmed.
            {totals.freeDeliveryAbove > 0 && totals.deliveryFee > 0
              ? ` Free delivery above ${formatCurrency(totals.freeDeliveryAbove)}.`
              : ''}
          </p>
        </>
      )}
      {totals.savings > 0 && <p className="shop-bill-saved">You saved {formatCurrency(totals.savings)} on this order</p>}
    </section>
  );
}

/* ------------------------------------------------------------------ *\
 * Cart
 * ------------------------------------------------------------------ */
export function ShopCartScreen({ session, navigate, notify }) {
  const ownerId = shopOwnerId(session);
  const copy = shopCopy(session);
  const { cart: lines, setQty, removeLine } = useSyncedCart(ownerId);
  const shopSettings = useShopSettings();

  const totals = cartTotals(lines, shopSettings);
  const gap = freeDeliveryGap(lines, shopSettings);
  // Progress runs on the AFTER-DISCOUNT subtotal — the same number the
  // server bills against, so the bar never oversells the free-delivery rule.
  const progress = shopSettings.freeDeliveryAbove > 0
    ? Math.min(100, Math.round((totals.subtotal / shopSettings.freeDeliveryAbove) * 100))
    : 100;

  const confirm = useConfirm();
  const clearAll = async () => {
    const ok = await confirm({
      title: 'Clear your cart?',
      message: 'Every item will be removed from this cart.',
      confirmLabel: 'Clear cart',
      tone: 'danger',
    });
    if (!ok) return;
    // Clear every line locally (instant) and on the server (durable).
    lines.forEach(line => removeLine(line.productId));
    clearServerCart();
    notify?.('info', 'Cart cleared.');
  };

  if (lines.length === 0) {
    return (
      <div className="screen shop-cart-screen">
        <PageHeader title="Your cart" subtitle="Everything you picked up from the Naai Shop." onBack={() => navigate('shop')} />
        <EmptyState
          icon={ShoppingBag}
          title="Your cart is empty"
          message={copy.cartEmptyHint}
          action={<Button onClick={() => navigate('shop')}>Browse the shop <ChevronRight size={16} /></Button>}
        />
      </div>
    );
  }

  return (
    <div className="screen shop-cart-screen">
      <PageHeader title="Your cart" subtitle={`${cartCount(lines)} item${cartCount(lines) === 1 ? '' : 's'} from the Naai Shop`} onBack={() => navigate('shop')} />
      <div className="shop-cart-layout">
        <div className="shop-cart-main">
          <div className={cx('shop-delivery-note', gap === 0 && 'unlocked')} role="status">
            <Truck size={17} />
            <div className="shop-delivery-note-body">
              {gap > 0 ? (
                <>
                  <p>Add items worth <strong>{formatCurrency(gap)}</strong> more to unlock <strong>FREE delivery</strong></p>
                  <div className="shop-delivery-progress" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
                </>
              ) : (
                <p>You have unlocked <strong>FREE delivery</strong> on this order 🎉</p>
              )}
            </div>
          </div>
          <div className="shop-cart-list-head">
            <span>Items in cart · <strong>{cartCount(lines)}</strong></span>
            <button type="button" className="shop-cart-clear" onClick={clearAll}>Clear cart</button>
          </div>
          <div className="shop-cart-list">
            {lines.map(line => (
              <article className="shop-cart-item" key={line.productId}>
                <ImageWithFallback src={getFileUrl(line.image)} fallback={PRODUCT_PLACEHOLDER} alt={line.name} className="shop-cart-image" />
                <div className="shop-cart-copy">
                  <h3>{line.name}</h3>
                  <p className="shop-cart-price-line">
                    <strong>{formatCurrency(line.price)}</strong>
                    <span>each</span>
                    {line.mrp > 0 && <s>MRP {formatCurrency(line.mrp)}</s>}
                    <button type="button" className="shop-cart-remove" onClick={() => removeLine(line)}>
                      <Trash2 size={13} /> Remove
                    </button>
                  </p>
                  <div className="shop-cart-item-row">
                    <ShopQuantityControl qty={line.qty} onAdd={() => setQty(line.productId, line.qty + 1)} onSet={next => setQty(line.productId, next)} small />
                    <strong className="shop-cart-line-total">{formatCurrency(line.price * line.qty)}</strong>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
        <aside className="shop-cart-aside">
          {/* Cart stage: products only. Delivery is billed at checkout. */}
          <ShopBillCard lines={lines} settings={shopSettings} stage="cart" />
        </aside>
      </div>
      <div className="shop-cart-footer">
        <div className="shop-cart-footer-amount">
          {/* The cart figure is the product value. It is NOT the amount that
              will be charged: delivery (and any COD charge) is added on the
              checkout page, and quoting a bigger number here — a ₹99 product
              showing as ₹199 with a delivery fee nobody chose — read as a
              hidden charge. */}
          <small>Items total</small>
          <strong>{formatCurrency(totals.subtotal)}</strong>
          <span>{cartCount(lines)} item{cartCount(lines) === 1 ? '' : 's'} · delivery at checkout</span>
        </div>
        <Button size="large" onClick={() => navigate('shopCheckout')}>
          Proceed to checkout <ChevronRight size={17} />
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *\
 * Checkout — address + payment (online / COD) + success
 * ------------------------------------------------------------------ */

// The delivery address defaults to the buyer's own record — the salon's for a
// partner (stock lands at the shop), the customer's profile for a person — but
// every field stays editable. The two roles keep their details in different
// shapes, so each is read from where that account actually stores it.
export function initialAddressFromSession(session) {
  const user = session?.user || {};
  const salon = user.salon || {};
  const isSalon = String(session?.role || '').toUpperCase() === 'SALON';
  const profile = isSalon ? { ...user, ...salon } : { ...user };
  // The pin: the buyer's saved GPS point, editable here so a delivery to a
  // different gate still has somewhere to send the partner.
  const point = toPoint(profile) || toPoint(salon) || toPoint(user);
  return {
    name: profile.ownerName || profile.fullName || profile.name || '',
    phone: profile.phoneNumber || profile.phone || profile.mobile || '',
    line1: profile.addressLine1 || profile.address || '',
    city: profile.city || '',
    // A dropdown only displays a value it knows: `MH`, `Orissa` or
    // `Pondicherry` saved by an older form is mapped onto the canonical name
    // here, so the saved address never looks unset at checkout.
    state: normalizeStateName(profile.state),
    pincode: profile.pincode || '',
    ...(point || { latitude: null, longitude: null }),
  };
}

export function ShopCheckoutScreen({ session, navigate, notify }) {
  const ownerId = shopOwnerId(session);
  const copy = shopCopy(session);
  const [lines, setLines] = useState(() => readCart(ownerId));
  const [address, setAddress] = useState(() => initialAddressFromSession(session));
  const [payment, setPayment] = useState('online');
  const [busy, setBusy] = useState(false);
  const [payState, setPayState] = useState('idle'); // idle | opening | in-checkout | app-switched | confirming
  const [placed, setPlaced] = useState(null);
  // A rejected registration is a real outcome the salon must see — not a
  // console line. `orderError` is shown above the pay button, with Retry.
  const [orderError, setOrderError] = useState('');
  const [retrying, setRetrying] = useState(false);
  const shopSettings = useShopSettings();
  // Cash on delivery is confirmed through the app's own sheet (never
  // window.confirm, which installed PWAs can suppress).
  const confirm = useConfirm();

  // The bill is payment-aware: choosing COD adds the admin-set COD charges,
  // so the "To pay" figure and the Razorpay amount always match what the
  // server will bill (it recomputes the identical numbers on registration).
  const totals = cartTotals(lines, shopSettings, { method: payment === 'cod' ? 'COD' : 'ONLINE' });
  const razorpayKey = useMemo(() => getRazorpayKeyId(), []);

  // The admin's COD limit: above it, COD is offered nowhere — the server
  // enforces the same rule, so this only keeps the UI honest and up-front.
  const codLocked = shopSettings.codThreshold > 0 && totals.itemTotal > shopSettings.codThreshold;
  useEffect(() => {
    if (payment === 'cod' && codLocked) setPayment('online');
  }, [payment, codLocked]);

  const setAddressField = (key, value) => setAddress(current => ({ ...current, [key]: value }));

  // The delivery pin. Browser GPS is asked from this tap (gesture-safe) and the
  // result is stored on the address, so the order carries the exact point the
  // admin panel and the delivery partner will navigate to.
  const deliveryPoint = toPoint(address);
  const [locating, setLocating] = useState(false);
  const useMyLocationForDelivery = async () => {
    setLocating(true);
    try {
      const fix = await getBrowserLocation();
      if (!fix) {
        notify?.('error', 'Could not read this device\u2019s location. Allow location access and try again.');
        return;
      }
      setAddress(current => ({ ...current, latitude: fix.latitude, longitude: fix.longitude }));
      notify?.('success', 'Delivery pin set to your current location.');
    } finally {
      setLocating(false);
    }
  };

  const validate = () => {
    if (!address.name.trim()) return 'Add the recipient\u2019s name.';
    if (!/^\d{10}$/.test(address.phone.trim())) return 'Add a 10-digit contact number.';
    if (!address.line1.trim()) return 'Add the delivery address.';
    if (!address.city.trim()) return 'Add the city.';
    if (!/^\d{6}$/.test(address.pincode.trim())) return 'Add a 6-digit pincode.';
    return '';
  };

  /**
   * Place the order ON THE SERVER, then show it.
   *
   * The id is generated locally so the flow has one identity, but the browser
   * copy is only a cache: the success screen appears once
   * `POST /api/shop-orders/create` has accepted the order — that is the row the
   * admin dashboard and the distributor work from.
   *
   * Cash on delivery: nothing was charged, so a rejection is a clean failure —
   * the draft is removed, the cart stays untouched and the salon can retry.
   * Online: the money has been taken, so the order is kept, queued for retry
   * and shown with an honest "confirming" state.
   */
  const finalizeOrder = async (paymentInfo) => {
    const order = placeOrder(ownerId, {
      items: lines,
      address,
      payment: paymentInfo,
      amounts: totals,
      salonName: shopSalonName(session),
    });
    setOrderError('');
    setPayState('saving');
    const result = await registerServerOrder(order);
    setPayState('idle');

    if (result.ok) {
      const confirmed = setOrderSyncState(ownerId, order.id, 'synced', result.order ? {
        // The server is the authority on the money and the status.
        amounts: { ...order.amounts, ...(result.order.amounts || {}) },
        payment: { ...order.payment, ...(result.order.payment || {}) },
        placedAt: result.order.placedAt || order.placedAt,
        serverStatus: result.order.serverStatus || null,
      } : {}) || order;
      setLines(clearCart(ownerId));
      setPlaced(confirmed);
      notify?.('success', `Order ${order.id} placed.`);
      // The placed cart is done for — clear it on the server too so another
      // device cannot buy it again.
      clearServerCart();
      return { ok: true, order: confirmed };
    }

    if (paymentInfo.method === 'ONLINE') {
      // Paid but not registered: never lose it. Keep the order, mark it
      // pending and let the retry queue take over.
      queuePendingOrder(order);
      const pending = setOrderSyncState(ownerId, order.id, 'pending') || order;
      setLines(clearCart(ownerId));
      setPlaced(pending);
      clearServerCart();
      notify?.('error', `Payment received, but My Naai could not confirm the order yet — ${result.message} We will keep retrying.`);
      return { ok: false, order: pending, message: result.message };
    }

    // COD: roll the draft back. An order the salon can see while the company
    // cannot is exactly the bug this replaces.
    removeLocalOrder(ownerId, order.id);
    setOrderError(result.message || 'My Naai could not accept this order.');
    notify?.('error', result.message || 'My Naai could not accept this order.');
    return { ok: false, message: result.message };
  };

  const payOnline = async () => {
    setPayState('opening');
    const ready = await loadRazorpayCheckout();
    if (!ready) {
      setPayState('idle');
      notify?.('error', 'Razorpay Checkout could not load on this network. Retry, or choose Cash on Delivery.');
      return;
    }
    setPayState('in-checkout');
    const result = await openRazorpayOrderlessCheckout({
      key: razorpayKey,
      amount: Math.round(totals.total * 100),
      currency: 'INR',
      name: 'My Naai',
      description: `Naai Shop order · ${cartCount(lines)} item${cartCount(lines) === 1 ? '' : 's'}`,
      prefill: { name: address.name, contact: address.phone },
      // The Razorpay notes identify the BUYER so the signed webhook can find
      // the order. A salon keeps the `salonId` key it has always sent (the
      // existing webhook matches on it); every buyer also gets `buyerId` +
      // `buyerType`, which is what a customer order is matched on.
      notes: {
        flow: 'shop-order',
        ...(copy.isSalon ? { salonId: String(session?.userId || '') } : {}),
        buyerId: String(session?.userId || ''),
        buyerType: copy.audience,
        items: String(cartCount(lines)),
      },
      onEvent: event => {
        if (event.type === 'app-switch') setPayState('app-switched');
        else if (event.type === 'returned') setPayState('confirming');
      },
    });
    if (result.status === 'success') {
      setPayState('confirming');
      await finalizeOrder({ method: 'ONLINE', status: 'PAID', paymentId: result.payment?.paymentId || '', amount: totals.total });
      return;
    }
    setPayState('idle');
    if (result.status === 'cancelled') {
      notify?.('info', 'Payment cancelled. No amount was charged — your cart is still waiting.');
      return;
    }
    notify?.('error', describePaymentFailure(result.error));
  };

  const placeCod = () => finalizeOrder({ method: 'COD', status: 'PENDING', paymentId: '', amount: totals.total });

  // Retry the same placement after a rejected registration — the cart and the
  // address are still exactly as the salon left them.
  const retryPlaceOrder = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      const problem = validate();
      if (problem) {
        setOrderError(problem);
        return;
      }
      await finalizeOrder({
        method: payment === 'online' ? 'ONLINE' : 'COD',
        status: 'PENDING',
        paymentId: '',
        amount: totals.total,
      });
    } finally {
      setRetrying(false);
    }
  };

  // Cash on delivery is a commitment to receive (and pay for) the parcel, so
  // it gets an explicit confirmation box before anything is written — the
  // same in-app sheet the rest of the portal uses for irreversible actions.
  // The order is only created when the partner taps "Place order"; "Go back"
  // leaves the cart and the address exactly as they were.
  const confirmCod = () => confirm({
    title: 'Place this order with cash on delivery?',
    message: `${formatCurrency(totals.total)} will be collected in cash when the order reaches your salon. Place it only if you are ready to receive it — the order can be cancelled until it goes out for delivery.`,
    confirmLabel: 'Place order',
    cancelLabel: 'Go back',
    tone: 'info',
    icon: Banknote,
    defaultAction: 'confirm',
  });

  const onlineAvailable = Boolean(razorpayKey);

  const submit = async event => {
    event?.preventDefault();
    if (busy || retrying) return;
    const problem = validate();
    if (problem) return notify?.('error', problem);
    if (lines.length === 0) return notify?.('error', 'Your cart is empty.');
    if (payment === 'cod' && codLocked) return notify?.('error', `Cash on delivery is only available for orders up to ${formatCurrency(shopSettings.codThreshold)} — please pay online.`);
    if (payment === 'online' && !onlineAvailable) return notify?.('error', 'Online payment is not configured on this device — use Cash on Delivery.');
    // Ask BEFORE the button goes into its loading state, so the sheet is not
    // sitting on top of a spinner that can never finish.
    if (payment === 'cod' && !(await confirmCod())) return;
    setBusy(true);
    try {
      if (payment === 'online') await payOnline();
      else await placeCod();
    } finally {
      setBusy(false);
    }
  };

  // ── Success view ──────────────────────────────────────────────────────────
  if (placed) {
    return (
      <div className="screen shop-checkout-screen">
        <div className="shop-success">
          <CheckCircle2 size={56} className="shop-success-icon" />
          <h2>Order placed</h2>
          <p className="shop-success-id">Order {placed.id}</p>
          {/* Address only — no invented arrival time. An exact "Arriving by
              Tomorrow, 08:51 pm" used to be calculated from the placement
              clock, which read as a delivery promise the platform never made.
              The street and the city are one flex child so the gap between
              children does not land before the comma. */}
          <p className="shop-success-eta">
            <Truck size={16} />{' '}
            <span>
              Delivering to <strong>{placed.address.line1 || copy.deliveryTarget}</strong>
              {placed.address.city ? `, ${placed.address.city}` : ''}
            </span>
          </p>
          <div className="shop-success-bill">
            {/* Frozen bill: exactly what this order was billed for, even if
                the shop settings change before the customer sees this page. */}
            <ShopBillCard lines={placed.items} amounts={placed.amounts} title="Order bill" />
          </div>
          <p className="shop-success-payment">
            {placed.payment.method === 'ONLINE'
              ? <><ShieldCheck size={14} /> Paid {formatCurrency(placed.payment.amount)} online{placed.payment.paymentId ? ` · ${placed.payment.paymentId}` : ''}</>
              : <><Banknote size={14} /> Pay {formatCurrency(placed.payment.amount)} in cash on delivery</>}
          </p>
          <div className="shop-success-actions">
            <Button onClick={() => navigate('shopOrder', { orderId: placed.id })}>Track order <ChevronRight size={16} /></Button>
            <Button variant="secondary" onClick={() => navigate('shop')}>Continue shopping</Button>
          </div>
        </div>
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <div className="screen shop-checkout-screen">
        <PageHeader title="Checkout" onBack={() => navigate('shopCart')} />
        <EmptyState icon={ShoppingBag} title="Nothing to check out" message="Your cart is empty." action={<Button onClick={() => navigate('shop')}>Browse the shop</Button>} />
      </div>
    );
  }

  const payLabel = payState === 'saving' ? 'Placing your order with My Naai…'
    : payState === 'opening' ? 'Contacting payment gateway…'
    : payState === 'in-checkout' ? 'Complete the payment in the Razorpay window'
    : payState === 'app-switched' ? 'Waiting for your payment app…'
    : payState === 'confirming' ? 'Confirming your payment…'
    : payment === 'online' ? `Pay ${formatCurrency(totals.total)} online` : `Place order · pay ${formatCurrency(totals.total)} on delivery`;

  return (
    <div className="screen shop-checkout-screen">
      <PageHeader title="Checkout" subtitle={copy.checkoutSubtitle} onBack={() => navigate('shopCart')} />
      <section className="shop-address-card">
        <h3><MapPin size={15} /> Delivery address</h3>
        <form onSubmit={submit}>
          {/* Every field group is a direct child of one column with a real gap.
              Address fields used to be block elements with no spacing between
              them (only the two-column grids had a gap), which put each label
              flush against the input above it — on a phone that read as one
              long run of text. */}
          <div className="checkout-fields">
            <div className="form-two-col">
              <Field label="Recipient name" required><input autoComplete="name" value={address.name} onChange={event => setAddressField('name', event.target.value)} placeholder="e.g. Ramesh Kumar" autoFocus /></Field>
              <Field label="Contact number" required><input autoComplete="tel" inputMode="numeric" maxLength={10} value={address.phone} onChange={event => setAddressField('phone', event.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="10-digit mobile" /></Field>
            </div>
            <Field label={copy.addressFieldLabel} required><input autoComplete="street-address" value={address.line1} onChange={event => setAddressField('line1', event.target.value)} placeholder="Building, street, landmark" /></Field>
            {/* City · State · Pincode share one even row on a wide screen and
                stack on a phone — no nested grid, so the columns line up. */}
            <div className="form-three-even">
              <Field label="City" required><input autoComplete="address-level2" value={address.city} onChange={event => setAddressField('city', event.target.value)} placeholder="City" /></Field>
              {/* State is a fixed list — a dropdown avoids the typos a free
                  text field produced ("MH", "maharastra", "Orissa") and the
                  value we send is always one the platform understands. An
                  unrecognised saved value stays visible as its own option
                  rather than silently disappearing. */}
              <SelectField
                label="State"
                value={address.state}
                onChange={event => setAddressField('state', event.target.value)}
                options={stateOptionsWith(address.state)}
                placeholder="Select state"
                autoComplete="address-level1"
              />
              <Field label="Pincode" required><input autoComplete="postal-code" inputMode="numeric" maxLength={6} value={address.pincode} onChange={event => setAddressField('pincode', event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6-digit pincode" /></Field>
            </div>
          </div>
          {/* Delivery location — the point the admin and the delivery partner
              see on their map. Prefilled from the salon profile; adjustable
              here because a delivery may go to a different gate. */}
          <div className="checkout-location">
            <h3><MapPin size={15} /> Delivery location</h3>
            <p className="location-preview-coords">
              {deliveryPoint ? formatCoordinates(deliveryPoint) : 'No delivery pin yet'}
            </p>
            <p className="location-preview-caption">{copy.locationCaption}</p>
            <LocationMap value={deliveryPoint} height={160} ariaLabel="Delivery location map" />
            <div className="checkout-location-actions">
              <Button type="button" variant="secondary" size="small" onClick={useMyLocationForDelivery} loading={locating}>
                <MapPin size={14} /> {locating ? 'Locating…' : 'Use my current location'}
              </Button>
              {deliveryPoint && (
                <a className="location-preview-link" href={mapsUrl(deliveryPoint)} target="_blank" rel="noopener noreferrer">
                  Open in Maps
                </a>
              )}
            </div>
          </div>
          <div className="shop-checkout-summary">
            <ShopBillCard lines={lines} settings={shopSettings} method={payment === 'cod' ? 'COD' : 'ONLINE'} />
          </div>
          <section className="shop-pay-options" aria-label="Payment method">
            <label className={cx('shop-pay-option', payment === 'online' && 'active', !onlineAvailable && 'disabled')}>
              <input type="radio" name="shop-payment" value="online" checked={payment === 'online'} disabled={!onlineAvailable} onChange={() => setPayment('online')} />
              <CreditCard size={19} className="shop-pay-icon" />
              <span className="shop-pay-copy">
                <strong>Pay online</strong>
                <small>{onlineAvailable ? 'UPI, cards, netbanking via Razorpay' : 'Not configured on this device — use COD'}</small>
              </span>
              <span className={cx('shop-pay-tick', payment === 'online' && 'on')}><CheckCircle2 size={18} /></span>
            </label>
            <label className={cx('shop-pay-option', payment === 'cod' && 'active', codLocked && 'disabled')} aria-disabled={codLocked}>
              <input type="radio" name="shop-payment" value="cod" checked={payment === 'cod'} disabled={codLocked} onChange={() => setPayment('cod')} />
              <Banknote size={19} className="shop-pay-icon" />
              <span className="shop-pay-copy">
                <strong>Cash on delivery</strong>
                <small>
                  {codLocked
                    ? `Only for orders up to ${formatCurrency(shopSettings.codThreshold)} — this one is ${formatCurrency(totals.itemTotal)}, so please pay online`
                    : shopSettings.codCharges > 0
                      ? `Pay in cash ${copy.codLine} · ${formatCurrency(shopSettings.codCharges)} COD charges`
                      : `Pay in cash ${copy.codLine}`}
                </small>
              </span>
              <span className={cx('shop-pay-tick', payment === 'cod' && 'on')}><CheckCircle2 size={18} /></span>
            </label>
          </section>
          {payState !== 'idle' && (
            <div className="shop-pay-status" role="status">
              <LoaderCircle size={15} className="spin" /> {payLabel}
            </div>
          )}
          {orderError && (
            <div className="shop-order-error" role="alert">
              <XCircle size={16} />
              <div>
                <strong>Order not placed</strong>
                <p>{orderError}</p>
                <p className="shop-order-error-help">
                  Nothing has been charged and your cart is still here. Check the details above and try again,
                  or call {SUPPORT_PHONE} if it keeps failing.
                </p>
                <div className="shop-order-error-actions">
                  <Button type="button" size="small" loading={retrying} onClick={retryPlaceOrder}>
                    Try again
                  </Button>
                  <Button type="button" size="small" variant="secondary" onClick={() => setOrderError('')}>
                    Dismiss
                  </Button>
                </div>
              </div>
            </div>
          )}
          <Button type="submit" size="large" loading={busy || retrying || payState !== 'idle'} className="shop-proceed-button">
            {payLabel} {payment === 'online' ? <CreditCard size={16} /> : <Banknote size={16} />}
          </Button>
          <p className="shop-checkout-terms"><ShieldCheck size={13} /> Orders can be cancelled free of charge until they go out for delivery. Online refunds return to the source within 5–7 working days.</p>
        </form>
      </section>
    </div>
  );
}
