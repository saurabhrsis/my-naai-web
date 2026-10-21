import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Banknote,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  MapPin,
  Package,
  PackageCheck,
  Phone,
  ShieldCheck,
  Truck,
  XCircle,
} from 'lucide-react';
import { getFileUrl } from '../lib/api';
import {
  STATUS_TIMELINE,
  canCancelOrder,
  cancelOrder,
  findOrder,
  getOrderStatus,
  readOrders,
  saveOrders,
  upsertLocalOrder,
} from '../lib/shopOrders';
import { cancelServerOrder, fetchAllServerOrders, fetchServerOrderById } from '../lib/shopServerSync';
import { Button, EmptyState, ImageWithFallback, PageHeader, StatusPill, cx, formatCurrency, formatDate, getErrorMessage } from './Shared';
import { shopOwnerId } from './ShopScreen';
import { useConfirm } from './ConfirmDialog';
import { LocationPreview } from './LocationMap.jsx';
import { deliveryPointOf } from '../lib/geo';

// Server history wins over the local copy on a shared id (the backend is the
// account-level truth); local-only orders (placed offline / before sign-in)
// are kept so nothing the salon can see disappears. Sorted newest first, the
// same way readOrders orders them.
function mergeOrders(localOrders, serverOrders) {
  const byId = new Map();
  (localOrders || []).forEach(order => { if (order?.id) byId.set(order.id, order); });
  (serverOrders || []).forEach(order => { if (order?.id) byId.set(order.id, order); });
  return [...byId.values()].sort((a, b) => String(b.placedAt).localeCompare(String(a.placedAt)));
}

const PRODUCT_PLACEHOLDER = '/assets/brand/product-placeholder.svg';
const SUPPORT_PHONE = '8380017393';

// Re-renders the tracker every 30 s while the screen is open so a "packed"
// order walks forward to "shipped" without a manual refresh.
function useNow(intervalMs = 30000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

// Tones map onto the app's existing status-pill palette (gold = waiting,
// green = going well, red = ended/cancelled).
const STATUS_TONE = { placed: 'pending', packed: 'pending', shipped: 'open', delivered: 'open', cancelled: 'cancelled' };
const STATUS_ICON = { placed: Package, packed: PackageCheck, shipped: Truck, delivered: CheckCircle2, cancelled: XCircle };

function statusPill(status) {
  return <StatusPill tone={STATUS_TONE[status.key] || 'neutral'} dot>{status.label}</StatusPill>;
}

/* ------------------------------------------------------------------ *\
 * My orders — the list
 * ------------------------------------------------------------------ */
export function ShopOrdersScreen({ session, navigate, notify }) {
  const ownerId = shopOwnerId(session);
  const [orders, setOrders] = useState(() => readOrders(ownerId));
  const [filter, setFilter] = useState('active');

  // Local copy first (instant + offline), then the account-level server
  // history merged over it and persisted, so the local cache carries the
  // live server status for offline visits and the detail screen. A fetch
  // failure leaves the local copy as-is.
  const load = useCallback(() => {
    const local = readOrders(ownerId);
    setOrders(local);
    fetchAllServerOrders().then(server => {
      if (!server) return; // guest or offline — local already shown
      const merged = mergeOrders(local, server);
      saveOrders(ownerId, merged);
      setOrders(merged);
    });
  }, [ownerId]);
  useEffect(() => { load(); }, [load]);

  const buckets = useMemo(() => ({
    all: orders,
    active: orders.filter(order => ['placed', 'packed', 'shipped'].includes(getOrderStatus(order).key)),
    delivered: orders.filter(order => getOrderStatus(order).key === 'delivered'),
    cancelled: orders.filter(order => getOrderStatus(order).key === 'cancelled'),
  }), [orders]);
  const visible = buckets[filter] || buckets.all;

  return (
    <div className="screen shop-orders-screen">
      {/* No subtitle: on a phone it cost a whole line above the tabs for copy
          that repeats the title. Title, back and Refresh share one row. */}
      <PageHeader title="My orders" onBack={() => navigate('shop')} action={<button type="button" className="refresh-text-button" onClick={load}>Refresh</button>} />
      <div className="booking-tabs shop-order-tabs">
        <button className={filter === 'active' ? 'active' : ''} onClick={() => setFilter('active')}>Active <span>{buckets.active.length}</span></button>
        <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>All <span>{buckets.all.length}</span></button>
        <button className={filter === 'delivered' ? 'active' : ''} onClick={() => setFilter('delivered')}>Delivered</button>
        <button className={filter === 'cancelled' ? 'active' : ''} onClick={() => setFilter('cancelled')}>Cancelled</button>
      </div>
      {visible.length ? (
        <div className="shop-order-list">
          {visible.map(order => {
            const status = getOrderStatus(order);
            const Icon = STATUS_ICON[status.key] || Package;
            return (
              <button type="button" key={order.id} className="shop-order-card" onClick={() => navigate('shopOrder', { orderId: order.id })}>
                <span className="shop-order-icon"><Icon size={20} /></span>
                <span className="shop-order-copy">
                  <span className="shop-order-top"><strong>{order.id}</strong>{statusPill(status)}</span>
                  <small>{formatDate(order.placedAt)} · {order.items.reduce((sum, item) => sum + item.qty, 0)} item{order.items.reduce((sum, item) => sum + item.qty, 0) === 1 ? '' : 's'} · {formatCurrency(order.amounts.total)}</small>
                </span>
                <ChevronRight size={18} className="shop-order-chevron" />
              </button>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={Package}
          title={filter === 'active' ? 'No active orders' : 'No orders here yet'}
          message={filter === 'active' ? 'Order stock for your salon and it will appear here with live status.' : 'Order stock for your salon and it will appear here.'}
          action={<Button onClick={() => navigate('shop')}>Browse the shop <ChevronRight size={16} /></Button>}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *\
 * Order detail — live tracker, items, address, payment, cancel
 * ------------------------------------------------------------------ */
export function ShopOrderScreen({ session, params, navigate, notify }) {
  const ownerId = shopOwnerId(session);
  const orderId = params?.orderId || '';
  const confirm = useConfirm();
  const now = useNow(30000);
  const [order, setOrder] = useState(() => findOrder(ownerId, orderId));
  const [cancelling, setCancelling] = useState(false);

  // Local record first (instant), then the server copy — it carries the live
  // salon-facing status and is persisted back into the local history so the
  // order stays findable (and cancellable) offline.
  const load = useCallback(() => {
    const local = findOrder(ownerId, orderId);
    setOrder(local);
    fetchServerOrderById(orderId).then(server => {
      if (!server) return;
      const persisted = upsertLocalOrder(ownerId, server);
      setOrder(persisted || server);
    });
  }, [ownerId, orderId]);
  useEffect(() => { load(); }, [load]);

  if (!order) {
    return (
      <div className="screen shop-order-screen">
        <PageHeader title="Order details" onBack={() => navigate('shopOrders')} />
        <EmptyState icon={Package} title="Order not found" message="This order may belong to a different salon account on this device." action={<Button onClick={() => navigate('shopOrders')}>Back to my orders</Button>} />
      </div>
    );
  }

  const status = getOrderStatus(order, now);
  const cancellable = canCancelOrder(order, now);
  const payment = order.payment || {};

  const cancel = async () => {
    const confirmed = await confirm({
      title: 'Cancel this order?',
      message: payment.method === 'ONLINE' && payment.status === 'PAID'
        ? 'The amount paid will be refunded to the original source within 5–7 working days.'
        : 'No payment will be collected. This cannot be undone once the order goes out for delivery.',
      confirmLabel: 'Cancel order',
      cancelLabel: 'Keep order',
      tone: 'danger',
      icon: XCircle,
    });
    if (!confirmed) return;
    setCancelling(true);
    try {
      if (order.serverStatus) {
        // The backend is the authority on whether the parcel has left the
        // depot — ask it first, then mirror the outcome locally.
        const accepted = await cancelServerOrder(order.id, 'Cancelled by the salon from the portal');
        if (accepted) {
          const updated = cancelOrder(ownerId, order.id, { now, reason: 'Cancelled by the salon from the portal' });
          const final = updated?.cancelledAt
            ? upsertLocalOrder(ownerId, { ...updated, serverStatus: 'CANCELLED' })
            : null;
          setOrder(final || updated);
          notify?.('success', 'Order cancelled.');
        } else {
          // Status moved to "out for delivery" between load and click.
          load();
          notify?.('error', 'This order can no longer be cancelled — it has already gone out for delivery. Call support if something is wrong.');
        }
      } else {
        const updated = cancelOrder(ownerId, order.id, { now, reason: 'Cancelled by the salon from the portal' });
        if (updated?.cancelledAt) {
          setOrder(updated);
          notify?.('success', 'Order cancelled.');
        } else {
          notify?.('error', 'This order has already been dispatched and can no longer be cancelled. Call support if something is wrong.');
        }
      }
    } catch (error) {
      notify?.('error', getErrorMessage(error, 'Could not cancel this order.'));
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="screen shop-order-screen">
      <PageHeader title="Order details" subtitle={`Order ${order.id} · ${formatDate(order.placedAt)}`} onBack={() => navigate('shopOrders')} />

      <section className={cx('shop-tracker-card', `is-${status.key}`)}>
        <div className="shop-tracker-head">
          <div>
            <span className="eyebrow">ORDER STATUS</span>
            <h2>{status.key === 'cancelled' ? 'Order cancelled' : status.label}</h2>
          </div>
          {statusPill(status)}
        </div>
        {status.key === 'delivered' && <p className="shop-tracker-eta"><CheckCircle2 size={15} /> Delivered — enjoy the stock at {order.salonName || 'your salon'}</p>}
        {status.key === 'cancelled' && (
          <p className="shop-tracker-eta cancelled">
            {payment.method === 'ONLINE'
              ? <>Refund of {formatCurrency(payment.amount)} is on the way to the original payment source (5–7 working days).</>
              : 'The order was cancelled before dispatch. No amount was collected.'}
          </p>
        )}
        {status.key !== 'cancelled' && (
          <div className="shop-tracker" aria-hidden="true">
            {STATUS_TIMELINE.map((step, index) => (
              <div key={step.key} className={cx('shop-tracker-step', index <= status.stepIndex && 'done', index === status.stepIndex && 'current')}>
                <i /><span>{step.label}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="shop-order-items">
        <h3>Items · {order.items.reduce((sum, item) => sum + item.qty, 0)}</h3>
        {order.items.map(item => (
          <div className="shop-order-item" key={item.productId}>
            <ImageWithFallback src={getFileUrl(item.image)} fallback={PRODUCT_PLACEHOLDER} alt={item.name} className="shop-cart-image" />
            <div className="shop-order-item-copy">
              <strong>{item.name}</strong>
              <small>Qty {item.qty}</small>
            </div>
            <span>{formatCurrency(item.price * item.qty)}</span>
          </div>
        ))}
        <div className="shop-order-bill">
          <div className="shop-bill-row"><span>Item total</span><span>{formatCurrency(order.amounts.itemTotal)}</span></div>
          {Number(order.amounts.discount) > 0 && <div className="shop-bill-row saving"><span>Order discount</span><span>− {formatCurrency(order.amounts.discount)}</span></div>}
          <div className="shop-bill-row"><span>Delivery fee</span>{order.amounts.deliveryFee === 0 ? <span className="shop-bill-free">FREE</span> : <span>{formatCurrency(order.amounts.deliveryFee)}</span>}</div>
          {Number(order.amounts.codFee) > 0 && <div className="shop-bill-row"><span>COD charges</span><span>{formatCurrency(order.amounts.codFee)}</span></div>}
          {order.amounts.savings > 0 && <div className="shop-bill-row saving"><span>MRP savings</span><span>− {formatCurrency(order.amounts.savings)}</span></div>}
          <div className="shop-bill-row total"><span>To pay</span><strong>{formatCurrency(order.amounts.total)}</strong></div>
        </div>
      </section>

      <section className="shop-order-address">
        <h3><MapPin size={15} /> Delivery to</h3>
        <p><strong>{order.address.name}</strong> · {order.address.phone}</p>
        <p>{order.address.line1}{order.address.city ? `, ${order.address.city}` : ''}{order.address.state ? `, ${order.address.state}` : ''} — {order.address.pincode}</p>
      </section>

      <section className="shop-order-payment">
        <h3>{payment.method === 'COD' ? <Banknote size={15} /> : <CreditCard size={15} />} Payment</h3>
        {payment.method === 'COD'
          ? <p><StatusPill tone={status.key === 'delivered' ? 'open' : 'pending'} dot>{status.key === 'delivered' ? 'Collected on delivery' : 'Pay on delivery'}</StatusPill> Pay <strong>{formatCurrency(payment.amount)}</strong> in cash when the order arrives.</p>
          : (
            <p>
              Paid <strong>{formatCurrency(payment.amount)}</strong> online
              {payment.paymentId ? <small> · {payment.paymentId}</small> : null}{' '}
              <StatusPill tone={payment.status === 'PAID' ? 'open' : payment.status === 'REFUND_REQUESTED' ? 'cancelled' : 'pending'} dot>
                {payment.status === 'PAID' ? 'Paid' : payment.status === 'REFUND_REQUESTED' ? 'Refund requested' : 'Pending'}
              </StatusPill>
            </p>
          )}
      </section>
      <section className="shop-order-address">
        <h3><MapPin size={15} /> Delivery to</h3>
        <p><strong>{order.address.name}</strong> · {order.address.phone}</p>
        <p>{order.address.line1}{order.address.city ? `, ${order.address.city}` : ''}{order.address.state ? `, ${order.address.state}` : ''} — {order.address.pincode}</p>
      </section>

      {/* The delivery point on a map. It is the SAME point the admin panel and
          the delivery partner navigate to — shown here so the salon can
          confirm the pin before (and after) the parcel is on its way. */}
      <LocationPreview
        value={deliveryPointOf(order)}
        title="Delivery location"
        caption={
          deliveryPointOf(order)
            ? 'Our delivery partner navigates to this point. Ask support to update it if the gate or building is wrong.'
            : 'No pin saved yet — update the salon GPS location so the delivery partner can find you.'
        }
      />

      {cancellable && (
        <Button variant="danger" loading={cancelling} onClick={cancel} className="shop-cancel-button"><XCircle size={16} /> Cancel order</Button>
      )}
      {!cancellable && status.key !== 'delivered' && status.key !== 'cancelled' && (
        <p className="shop-support-note"><ShieldCheck size={14} /> This order is already out for delivery. If anything looks wrong, call <a href={`tel:${SUPPORT_PHONE}`}><Phone size={12} /> {SUPPORT_PHONE}</a>.</p>
      )}
    </div>
  );
}
