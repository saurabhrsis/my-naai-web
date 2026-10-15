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
} from 'lucide-react';
import { getFileUrl } from '../lib/api';
import {
  describePaymentFailure,
  getRazorpayKeyId,
  loadRazorpayCheckout,
  openRazorpayOrderlessCheckout,
} from '../lib/razorpay';
import {
  FREE_DELIVERY_ABOVE,
  cartCount,
  cartTotals,
  clearCart,
  formatEta,
  freeDeliveryGap,
  getOrderStatus,
  placeOrder,
  readCart,
  removeCartLine,
  setCartQty,
} from '../lib/shopOrders';
import {
  Button,
  EmptyState,
  Field,
  ImageWithFallback,
  PageHeader,
  cx,
  formatCurrency,
} from './Shared';
import { useConfirm } from './ConfirmDialog';
import { ShopQuantityControl, shopOwnerId, shopSalonName } from './ShopScreen';

const PRODUCT_PLACEHOLDER = '/assets/brand/product-placeholder.svg';

/* ------------------------------------------------------------------ *\
 * Bill card — shared by the cart and the checkout summary.
 * ------------------------------------------------------------------ */
export function ShopBillCard({ lines, title = 'Bill details' }) {
  const totals = cartTotals(lines);
  return (
    <section className="shop-bill-card">
      <h3>{title}</h3>
      <div className="shop-bill-row"><span>Item total</span><span>{formatCurrency(totals.itemTotal)}</span></div>
      {totals.savings > 0 && <div className="shop-bill-row saving"><span>MRP savings</span><span>− {formatCurrency(totals.savings)}</span></div>}
      <div className="shop-bill-row">
        <span>Delivery fee</span>
        {totals.deliveryFee === 0 && lines.length > 0
          ? <span className="shop-bill-free">FREE</span>
          : <span>{totals.deliveryFee === 0 ? '—' : formatCurrency(totals.deliveryFee)}</span>}
      </div>
      <div className="shop-bill-row total"><span>To pay</span><strong>{formatCurrency(totals.total)}</strong></div>
      {totals.savings > 0 && <p className="shop-bill-saved">You saved {formatCurrency(totals.savings)} on this order</p>}
    </section>
  );
}

/* ------------------------------------------------------------------ *\
 * Cart
 * ------------------------------------------------------------------ */
export function ShopCartScreen({ session, navigate, notify }) {
  const ownerId = shopOwnerId(session);
  const [lines, setLines] = useState(() => readCart(ownerId));
  useEffect(() => { setLines(readCart(ownerId)); }, [ownerId]);

  const totals = cartTotals(lines);
  const gap = freeDeliveryGap(lines);
  const progress = Math.min(100, Math.round((totals.itemTotal / FREE_DELIVERY_ABOVE) * 100));

  const confirm = useConfirm();
  const setQty = (line, next) => setLines(setCartQty(ownerId, line.productId, next));
  const removeLine = line => setLines(removeCartLine(ownerId, line.productId));
  const clearAll = async () => {
    const ok = await confirm({
      title: 'Clear your cart?',
      message: 'Every item will be removed from this cart.',
      confirmLabel: 'Clear cart',
      tone: 'danger',
    });
    if (!ok) return;
    setLines(clearCart(ownerId));
    notify?.('info', 'Cart cleared.');
  };

  if (lines.length === 0) {
    return (
      <div className="screen shop-cart-screen">
        <PageHeader title="Your cart" subtitle="Everything you picked up from the Naai Shop." onBack={() => navigate('shop')} />
        <EmptyState
          icon={ShoppingBag}
          title="Your cart is empty"
          message="Fill it with shampoo, clippers and beard oil — delivered to your salon."
          action={<Button onClick={() => navigate('shop')}>Browse the shop <ChevronRight size={16} /></Button>}
        />
      </div>
    );
  }

  return (
    <div className="screen shop-cart-screen">
      <PageHeader title="Your cart" subtitle={`${cartCount(lines)} item${cartCount(lines) === 1 ? '' : 's'} from the Naai Shop`} onBack={() => navigate('shop')} />
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
              </p>
              <button type="button" className="shop-cart-remove" onClick={() => removeLine(line)}>
                <Trash2 size={13} /> Remove
              </button>
            </div>
            <div className="shop-cart-side">
              <strong className="shop-cart-line-total">{formatCurrency(line.price * line.qty)}</strong>
              <ShopQuantityControl qty={line.qty} onAdd={() => setQty(line, line.qty + 1)} onSet={next => setQty(line, next)} small />
            </div>
          </article>
        ))}
      </div>
      <ShopBillCard lines={lines} />
      <div className="shop-cart-footer">
        <div className="shop-cart-footer-amount">
          <small>To pay</small>
          <strong>{formatCurrency(totals.total)}</strong>
          <span>{cartCount(lines)} item{cartCount(lines) === 1 ? '' : 's'}</span>
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

// The delivery address defaults to the salon's own record (this is a B2B
// shop — stock lands at the salon) but every field stays editable.
function initialAddressFromSession(session) {
  const user = session?.user || {};
  const profile = { ...user, ...(user.salon || {}) };
  return {
    name: profile.ownerName || profile.fullName || profile.name || '',
    phone: profile.phoneNumber || profile.phone || '',
    line1: profile.addressLine1 || profile.address || `${profile.salonName || 'Salon'}, ` + [profile.addressLine1, profile.city].filter(Boolean).join(', '),
    city: profile.city || '',
    state: profile.state || '',
    pincode: profile.pincode || '',
  };
}

export function ShopCheckoutScreen({ session, navigate, notify }) {
  const ownerId = shopOwnerId(session);
  const [lines, setLines] = useState(() => readCart(ownerId));
  const [address, setAddress] = useState(() => initialAddressFromSession(session));
  const [payment, setPayment] = useState('online');
  const [busy, setBusy] = useState(false);
  const [payState, setPayState] = useState('idle'); // idle | opening | in-checkout | app-switched | confirming
  const [placed, setPlaced] = useState(null);

  const totals = cartTotals(lines);
  const razorpayKey = useMemo(() => getRazorpayKeyId(), []);

  const setAddressField = (key, value) => setAddress(current => ({ ...current, [key]: value }));

  const validate = () => {
    if (!address.name.trim()) return 'Add the recipient\u2019s name.';
    if (!/^\d{10}$/.test(address.phone.trim())) return 'Add a 10-digit contact number.';
    if (!address.line1.trim()) return 'Add the delivery address.';
    if (!address.city.trim()) return 'Add the city.';
    if (!/^\d{6}$/.test(address.pincode.trim())) return 'Add a 6-digit pincode.';
    return '';
  };

  const finalizeOrder = (paymentInfo) => {
    const order = placeOrder(ownerId, {
      items: lines,
      address,
      payment: paymentInfo,
      amounts: totals,
      salonName: shopSalonName(session),
    });
    setLines(clearCart(ownerId));
    setPlaced(order);
    setPayState('idle');
    notify?.('success', `Order ${order.id} placed.`);
    return order;
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
      notes: { flow: 'shop-order', salonId: ownerId, items: String(cartCount(lines)) },
      onEvent: event => {
        if (event.type === 'app-switch') setPayState('app-switched');
        else if (event.type === 'returned') setPayState('confirming');
      },
    });
    if (result.status === 'success') {
      setPayState('confirming');
      finalizeOrder({ method: 'ONLINE', status: 'PAID', paymentId: result.payment?.paymentId || '', amount: totals.total });
      return;
    }
    setPayState('idle');
    if (result.status === 'cancelled') {
      notify?.('info', 'Payment cancelled. No amount was charged — your cart is still waiting.');
      return;
    }
    notify?.('error', describePaymentFailure(result.error));
  };

  const placeCod = () => {
    finalizeOrder({ method: 'COD', status: 'PENDING', paymentId: '', amount: totals.total });
  };

  const onlineAvailable = Boolean(razorpayKey);

  const submit = async event => {
    event?.preventDefault();
    if (busy) return;
    const problem = validate();
    if (problem) return notify?.('error', problem);
    if (lines.length === 0) return notify?.('error', 'Your cart is empty.');
    if (payment === 'online' && !onlineAvailable) return notify?.('error', 'Online payment is not configured on this device — use Cash on Delivery.');
    setBusy(true);
    try {
      if (payment === 'online') await payOnline();
      else placeCod();
    } finally {
      setBusy(false);
    }
  };

  // ── Success view ──────────────────────────────────────────────────────────
  if (placed) {
    const etaText = formatEta(getOrderStatus(placed).eta);
    return (
      <div className="screen shop-checkout-screen">
        <div className="shop-success">
          <CheckCircle2 size={56} className="shop-success-icon" />
          <h2>Order placed</h2>
          <p className="shop-success-id">Order {placed.id}</p>
          <p className="shop-success-eta">
            <Truck size={16} /> Arriving by <strong>{etaText || 'the next working day'}</strong> at {placed.address.line1 || 'your salon'}, {placed.address.city}
          </p>
          <div className="shop-success-bill">
            <ShopBillCard lines={placed.items} title="Order bill" />
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

  const payLabel = payState === 'opening' ? 'Contacting payment gateway…'
    : payState === 'in-checkout' ? 'Complete the payment in the Razorpay window'
    : payState === 'app-switched' ? 'Waiting for your payment app…'
    : payState === 'confirming' ? 'Confirming your payment…'
    : payment === 'online' ? `Pay ${formatCurrency(totals.total)} online` : `Place order · pay ${formatCurrency(totals.total)} on delivery`;

  return (
    <div className="screen shop-checkout-screen">
      <PageHeader title="Checkout" subtitle="Delivery to your salon" onBack={() => navigate('shopCart')} />
      <section className="shop-address-card">
        <h3><MapPin size={15} /> Delivery address</h3>
        <form onSubmit={submit}>
          <div className="form-two-col">
            <Field label="Recipient name" required><input value={address.name} onChange={event => setAddressField('name', event.target.value)} placeholder="e.g. Ramesh Kumar" autoFocus /></Field>
            <Field label="Contact number" required><input inputMode="numeric" maxLength={10} value={address.phone} onChange={event => setAddressField('phone', event.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="10-digit mobile" /></Field>
          </div>
          <Field label="Address" required><input value={address.line1} onChange={event => setAddressField('line1', event.target.value)} placeholder="Shop / salon address" /></Field>
          <div className="form-two-col">
            <Field label="City" required><input value={address.city} onChange={event => setAddressField('city', event.target.value)} placeholder="City" /></Field>
            <div className="form-two-col">
              <Field label="State"><input value={address.state} onChange={event => setAddressField('state', event.target.value)} placeholder="State" /></Field>
              <Field label="Pincode" required><input inputMode="numeric" maxLength={6} value={address.pincode} onChange={event => setAddressField('pincode', event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6-digit pincode" /></Field>
            </div>
          </div>
          <div className="shop-checkout-summary">
            <ShopBillCard lines={lines} />
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
            <label className={cx('shop-pay-option', payment === 'cod' && 'active')}>
              <input type="radio" name="shop-payment" value="cod" checked={payment === 'cod'} onChange={() => setPayment('cod')} />
              <Banknote size={19} className="shop-pay-icon" />
              <span className="shop-pay-copy">
                <strong>Cash on delivery</strong>
                <small>Pay in cash when the order reaches your salon</small>
              </span>
              <span className={cx('shop-pay-tick', payment === 'cod' && 'on')}><CheckCircle2 size={18} /></span>
            </label>
          </section>
          {payState !== 'idle' && (
            <div className="shop-pay-status" role="status">
              <LoaderCircle size={15} className="spin" /> {payLabel}
            </div>
          )}
          <Button type="submit" size="large" loading={busy || payState !== 'idle'} className="shop-proceed-button">
            {payLabel} {payment === 'online' ? <CreditCard size={16} /> : <Banknote size={16} />}
          </Button>
          <p className="shop-checkout-terms"><ShieldCheck size={13} /> Orders can be cancelled free of charge until they go out for delivery. Online refunds return to the source within 5–7 working days.</p>
        </form>
      </section>
    </div>
  );
}
