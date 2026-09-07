// Razorpay Checkout helpers shared by the subscription, renewal and salon
// registration flows. Everything here is intentionally framework-free so the
// payment behaviour can be reasoned about (and unit-tested) outside React.
//
// Mobile note: on phones Razorpay Checkout hands the customer over to a UPI app
// (Google Pay, PhonePe, Paytm, BHIM …) with an intent. The checkout sheet stays
// alive in this page and calls `handler` when the customer comes back, so the
// portal must never tear the flow down while the tab is hidden. A pending-payment
// record is persisted before the sheet opens so an interrupted/again-opened tab
// can offer a recovery path instead of silently losing the payment.

export const RAZORPAY_CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

const PENDING_PAYMENT_KEY = 'mynaaiPendingPayment';
export const PENDING_PAYMENT_TTL = 30 * 60 * 1000;

function isBrowser() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function readText(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

// The mobile app charges ₹1 (100 paise) whenever a plan price is 0 so the order
// is still valid for Razorpay; keep the same rule here.
export function toPaise(amount) {
  const value = Number(amount);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : 100;
}

// Prefer the amount the backend actually put on the order — a mismatch between
// the order amount and the checkout amount makes Razorpay reject the payment.
export function orderAmountInPaise(order, planPrice) {
  const fromOrder = Number(order?.amount);
  if (Number.isFinite(fromOrder) && fromOrder > 0) return Math.round(fromOrder);
  return toPaise(planPrice);
}

// `create-payment-order` has been observed returning the Razorpay order at
// several depths (`{ order }`, `{ data: { order } }`, `{ data: … }`, or the
// order object itself) and under two id keys (`id`, `orderId`). Reading only
// `response.order.id` made every one of the other shapes look like "the payment
// order came back empty" even though the order existed — which is the failure
// mode a partner sees as "Razorpay is not working". Search the response instead
// and normalize to `{ id, amount, currency }`.
export function extractRazorpayOrder(response) {
  const seen = new Set();
  const readId = node => {
    for (const key of ['id', 'orderId', 'order_id', 'razorpayOrderId']) {
      const value = node?.[key];
      if (typeof value === 'string' && /^order_/i.test(value.trim())) return value.trim();
    }
    return '';
  };
  const walk = node => {
    if (!node || typeof node !== 'object' || seen.has(node)) return null;
    seen.add(node);
    const id = readId(node);
    if (id) {
      const amount = Number(node.amount ?? node.amountDue ?? node.amount_due);
      const currency = typeof node.currency === 'string' && node.currency.trim() ? node.currency.trim() : 'INR';
      return { id, amount: Number.isFinite(amount) && amount > 0 ? Math.round(amount) : null, currency, raw: node };
    }
    // Depth-first over the usual envelopes, then any remaining object values.
    for (const key of ['order', 'data', 'result', 'payload', 'response']) {
      const found = walk(node[key]);
      if (found) return found;
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') {
        const found = walk(value);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(response);
}

// index.html loads checkout.js with `async`; this makes the portal resilient
// when that request is blocked (ad blockers, flaky mobile networks) by loading
// it on demand before a payment is attempted.
export function loadRazorpayCheckout({ timeout = 15000, src = RAZORPAY_CHECKOUT_SRC } = {}) {
  return new Promise(resolve => {
    if (!isBrowser()) return resolve(false);
    if (window.Razorpay) return resolve(true);
    let settled = false;
    let timer = null;
    const finish = value => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(Boolean(value));
    };
    timer = setTimeout(() => finish(window.Razorpay), timeout);
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener('load', () => finish(window.Razorpay), { once: true });
      existing.addEventListener('error', () => finish(false), { once: true });
      if (window.Razorpay) finish(true);
      return undefined;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.addEventListener('load', () => finish(window.Razorpay), { once: true });
    script.addEventListener('error', () => finish(false), { once: true });
    document.head.appendChild(script);
    return undefined;
  });
}

export function isRazorpayReady() {
  return isBrowser() && Boolean(window.Razorpay);
}

/* ------------------------------------------------------------------ *
 * Pending payment bookkeeping (recovery after an interrupted redirect)
 * ------------------------------------------------------------------ */

export function savePendingPayment(record) {
  if (!isBrowser() || !record) return;
  try {
    localStorage.setItem(PENDING_PAYMENT_KEY, JSON.stringify({ ...record, startedAt: Date.now() }));
  } catch (storageError) {
    // Storage can be full or blocked (private mode). The payment still works,
    // only the recovery affordance is lost.
    console.debug('Could not store the pending payment record.', storageError);
  }
}

export function readPendingPayment() {
  if (!isBrowser()) return null;
  try {
    const raw = localStorage.getItem(PENDING_PAYMENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (parseError) {
    console.debug('Stored pending payment was unreadable.', parseError);
    return null;
  }
}

export function clearPendingPayment() {
  if (!isBrowser()) return;
  try {
    localStorage.removeItem(PENDING_PAYMENT_KEY);
  } catch (storageError) {
    console.debug('Could not clear the pending payment record.', storageError);
  }
}

export function isPendingPaymentFresh(record, ttl = PENDING_PAYMENT_TTL) {
  const startedAt = Number(record?.startedAt);
  return Number.isFinite(startedAt) && startedAt > 0 && Date.now() - startedAt <= ttl;
}

/* ------------------------------------------------------------------ *
 * Redirect returns (UPI app / netbanking hand-off back to the portal)
 * ------------------------------------------------------------------ */

// Razorpay redirect flows come back with razorpay_payment_id, razorpay_order_id
// and razorpay_signature appended to the callback URL. The portal normally uses
// the in-page checkout sheet, but reading these parameters costs nothing and
// makes a redirect return complete the plan instead of dropping it.
export function readRedirectedPayment({ search, hash } = {}) {
  if (!isBrowser()) return null;
  const searchParams = new URLSearchParams(readText(search, window.location.search));
  const rawHash = readText(hash, window.location.hash);
  const hashQueryIndex = rawHash.indexOf('?');
  const hashParams = new URLSearchParams(hashQueryIndex >= 0 ? rawHash.slice(hashQueryIndex + 1) : '');
  const pick = key => searchParams.get(key) || hashParams.get(key) || '';
  const paymentId = pick('razorpay_payment_id');
  const errorCode = pick('error_code') || pick('error_reason');
  if (!paymentId && !errorCode) return null;
  return {
    paymentId,
    orderId: pick('razorpay_order_id'),
    signature: pick('razorpay_signature'),
    errorCode,
    errorDescription: pick('error_description'),
  };
}

// Drop the payment parameters from the address bar so a refresh cannot replay
// the same response.
export function clearRedirectedPaymentParams() {
  if (!isBrowser() || !window.history?.replaceState) return;
  const rawHash = window.location.hash || '';
  const hashQueryIndex = rawHash.indexOf('?');
  const hashParams = new URLSearchParams(hashQueryIndex >= 0 ? rawHash.slice(hashQueryIndex + 1) : '');
  ['razorpay_payment_id', 'razorpay_order_id', 'razorpay_signature', 'error_code', 'error_description', 'error_reason'].forEach(key => hashParams.delete(key));
  const nextHashQuery = hashParams.toString();
  const nextHash = `${hashQueryIndex >= 0 ? rawHash.slice(0, hashQueryIndex) : rawHash}${nextHashQuery ? `?${nextHashQuery}` : ''}`;
  window.history.replaceState({}, '', `${window.location.pathname}${nextHash}`);
}

/* ------------------------------------------------------------------ *
 * Failure copy
 * ------------------------------------------------------------------ */

export function describePaymentFailure(error) {
  const code = readText(error?.code).toUpperCase();
  const description = readText(error?.description);
  if (/USER_CANCEL|PAYMENT_CANCEL|CANCEL/.test(code)) return 'Payment cancelled. No amount was charged.';
  if (/BAD_REQUEST|VALIDATION/.test(code)) return description || 'The payment request was rejected. Please try again.';
  if (/TIMEOUT|NETWORK/.test(code)) return description || 'The payment could not reach the bank. Check your connection and try again.';
  if (description) return description;
  return 'The payment could not be completed. You will not be charged for a failed attempt.';
}

/* ------------------------------------------------------------------ *
 * Checkout
 * ------------------------------------------------------------------ */

// Opens Razorpay Checkout and always resolves with an explicit outcome:
//   { status: 'success',   payment: { paymentId, orderId, signature } }
//   { status: 'cancelled', error? }   — partner closed the sheet / pressed back
//   { status: 'failed',    error }    — gateway or bank failure
//   { status: 'unavailable', error }  — checkout.js could not be used
// `onEvent` receives { type: 'opened' | 'app-switch' | 'returned' | 'failed' | 'dismissed' }
// so the UI can tell the partner what is happening while a UPI app is in front.
export function openRazorpayCheckout({
  key,
  orderId,
  amount,
  currency = 'INR',
  name = 'My Naai',
  description = 'Salon partner subscription',
  image = '',
  themeColor = '#e8b97e',
  prefill = {},
  notes = {},
  onEvent = () => {},
} = {}) {
  return new Promise(resolve => {
    if (!isBrowser() || !window.Razorpay) {
      resolve({ status: 'unavailable', error: { description: 'Razorpay Checkout is unavailable on this device or network.' } });
      return;
    }
    if (!key || !orderId || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
      resolve({ status: 'failed', error: { description: 'The payment request is incomplete. Please try again.' } });
      return;
    }

    let settled = false;
    let failure = null;
    let switchedAway = false;
    let hidden = false;
    let checkout = null;

    const finish = (result, { closeSheet = false } = {}) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
      // A terminal failure used to resolve the promise while the Razorpay
      // iframe was still on screen: the app carried on underneath and the
      // partner was left staring at a dead payment sheet with no way back.
      // `ondismiss` cannot fire here (we already settled), so close it by hand.
      if (closeSheet) {
        try { checkout?.close(); } catch (closeError) { console.debug('Razorpay Checkout could not be closed.', closeError); }
      }
      resolve({ ...result, switchedAway });
    };

    // A UPI intent hides this tab. Track it so the UI can show "confirming your
    // payment" when the partner comes back instead of looking stuck.
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        hidden = true;
        onEvent({ type: 'app-switch' });
        return;
      }
      if (hidden) {
        hidden = false;
        switchedAway = true;
        onEvent({ type: 'returned' });
      }
    };
    const onPageHide = () => { hidden = true; onEvent({ type: 'app-switch' }); };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);

    try {
      checkout = new window.Razorpay({
        key,
        amount: Math.round(Number(amount)),
        currency,
        name,
        description,
        order_id: orderId,
        ...(image ? { image } : {}),
        prefill: { name: '', email: '', contact: '', ...prefill },
        notes,
        theme: { color: themeColor },
        // Ask before closing: an accidental back-tap while a UPI app is opening
        // must not silently abandon the subscription.
        modal: {
          escape: true,
          confirm_close: true,
          backdropclose: false,
          ondismiss: () => {
            onEvent({ type: 'dismissed' });
            finish(failure ? { status: 'failed', error: failure } : { status: 'cancelled' });
          },
        },
        handler: response => {
          const paymentId = response?.razorpay_payment_id || '';
          if (!paymentId) {
            failure = { code: 'MISSING_PAYMENT_ID', description: 'Razorpay did not return a payment ID. Do not pay again — contact support.' };
            onEvent({ type: 'failed', error: failure });
            finish({ status: 'failed', error: failure }, { closeSheet: true });
            return;
          }
          finish({
            status: 'success',
            payment: {
              paymentId,
              orderId: response?.razorpay_order_id || orderId,
              signature: response?.razorpay_signature || '',
            },
          }, { closeSheet: true });
        },
      });

      // `payment.failed` fires while the sheet is still open, so record it and
      // let the partner retry with another method. Only a validation failure is
      // terminal — there the sheet closes on its own.
      checkout.on('payment.failed', response => {
        const error = response?.error || {};
        failure = {
          code: readText(error.code),
          description: readText(error.description, 'The payment could not be completed.'),
          step: readText(error.step),
          reason: readText(error.reason),
        };
        onEvent({ type: 'failed', error: failure });
        const terminal = /validation/i.test(failure.step) || /BAD_REQUEST_ERROR/i.test(failure.code);
        if (terminal) finish({ status: 'failed', error: failure }, { closeSheet: true });
      });

      checkout.open();
      onEvent({ type: 'opened' });
    } catch (openError) {
      finish({
        status: 'failed',
        error: { description: readText(openError?.message, 'Razorpay Checkout could not be opened.') },
      });
    }
  });
}
