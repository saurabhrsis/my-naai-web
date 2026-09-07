import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Crown,
  LoaderCircle,
  LogOut,
  Phone,
  Smartphone,
  WalletCards,
  X,
} from 'lucide-react';
import { api, resetPlanExpiredAlert } from '../lib/api';
import { FREE_ONBOARDING_PLAN, PARTNER_PLANS, RENEWAL_PLANS } from '../lib/planDetails';
import {
  clearPendingPayment,
  clearRedirectedPaymentParams,
  describePaymentFailure,
  extractRazorpayOrder,
  isPendingPaymentFresh,
  loadRazorpayCheckout,
  openRazorpayCheckout,
  orderAmountInPaise,
  readPendingPayment,
  readRedirectedPayment,
  savePendingPayment,
} from '../lib/razorpay';
import { Button, GOLD, PageHeader, cx, formatCurrency, getErrorMessage } from './Shared';

// Plan catalog, renewal plans and the free onboarding plan live in
// src/lib/planDetails.js so the subscription picker and the active-plan
// displays always use the mobile app's names and prices.

const SUPPORT_PHONE = '8380017393';
// Same logo the mobile app shows inside Razorpay Checkout.
const CHECKOUT_IMAGE = 'https://res.cloudinary.com/dfdkzozqi/image/upload/v1773818628/my_naai_pay_gateway_ucntco.png';
const FALLBACK_KEY = 'rzp_live_ST8yVm3RaFMiHW';

// A configured value wins; the mobile app's live key is the production
// fallback. Anything that is not a real `rzp_(test|live)_…` id (an empty var, a
// leftover placeholder such as `your_key_here`) is rejected rather than handed
// to Checkout, which would fail with an opaque gateway error.
function getRazorpayKey() {
  const configured = import.meta.env?.VITE_RAZORPAY_KEY_ID;
  const value = typeof configured === 'string' ? configured.trim() : '';
  if (/^rzp_(test|live)_[A-Za-z0-9]+$/.test(value)) return value;
  if (value) console.warn('VITE_RAZORPAY_KEY_ID is not a valid Razorpay key id; using the built-in fallback key.');
  return /^rzp_(test|live)_[A-Za-z0-9]+$/.test(FALLBACK_KEY) ? FALLBACK_KEY : '';
}

// checkout.js is loaded with `async` in index.html; this state keeps the button
// honest about whether the gateway is actually usable before a partner taps it.
function useRazorpayGateway() {
  const [status, setStatus] = useState(() => (typeof window !== 'undefined' && window.Razorpay ? 'ready' : 'checking'));
  const check = useCallback(() => {
    setStatus('checking');
    return loadRazorpayCheckout().then(ready => {
      setStatus(ready ? 'ready' : 'unavailable');
      return ready;
    });
  }, []);
  useEffect(() => {
    let active = true;
    loadRazorpayCheckout().then(ready => { if (active) setStatus(ready ? 'ready' : 'unavailable'); });
    return () => { active = false; };
  }, []);
  return { status, check };
}

const PAYMENT_STATE_COPY = {
  opening: { title: 'Opening Razorpay…', text: 'Keep this page open while the payment sheet starts.' },
  'in-checkout': { title: 'Payment sheet open', text: 'Complete the payment in the Razorpay window.' },
  'app-switched': { title: 'Waiting for your payment app…', text: 'Finish the payment in Google Pay, PhonePe, Paytm or BHIM, then return to this page.' },
  confirming: { title: 'Confirming your payment…', text: 'Welcome back. We are checking the payment status with the bank — please do not pay again.' },
  activating: { title: 'Activating your plan…', text: 'Payment received. My Naai is updating your subscription now.' },
};

export function SubscriptionScreen({ params = {}, session, navigate, notify, onAuthComplete, onSessionUpdate, onLogout }) {
  const registrationData = params.registrationData;
  const isRegistration = Boolean(registrationData);
  const isForcedRenewal = !isRegistration && Boolean(params.forceRenewal || params.forceRenewal === 'true');
  const isUpgrade = Boolean(isForcedRenewal || params.isUpgrade || params.mode === 'RENEW');
  const isOnboarding = params.isOnboarding === true || params.isOnboarding === 'true';
  const showFreeOnboarding = isOnboarding && !isRegistration;
  const paidPlans = isUpgrade ? RENEWAL_PLANS : PARTNER_PLANS;
  const plans = showFreeOnboarding ? [FREE_ONBOARDING_PLAN, ...paidPlans] : paidPlans;
  const [selected, setSelected] = useState(() => (showFreeOnboarding ? FREE_ONBOARDING_PLAN.id : isRegistration ? 'trial_2_months' : ''));
  const [loading, setLoading] = useState(false);
  const [paymentState, setPaymentState] = useState('idle');
  const [notice, setNotice] = useState(null);
  const [recovery, setRecovery] = useState(null);
  const gateway = useRazorpayGateway();
  const inFlight = useRef(false);
  const isMobile = useMemo(() => typeof navigator !== 'undefined' && /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent || ''), []);
  const stateCopy = PAYMENT_STATE_COPY[paymentState] || null;

  // Activates the plan once a payment succeeded. Shared by the button flow and by
  // a redirect return from a UPI app so both paths finish the same way.
  const finalizePlan = useCallback(async ({ plan, payment, registration }) => {
    setPaymentState('activating');
    if (registration) {
      const tempToken = String(registration.tempToken || '').trim();
      if (!tempToken) throw new Error('Salon verification expired. Please sign in again and choose a plan.');
      // The OTP endpoint returns a temporary authorization token. It is only
      // sent on this request; the completed response must return the persisted
      // salon session that the portal uses afterwards.
      const response = await api.createSalon({
        ...registration,
        planType: plan.id,
        paymentId: payment.paymentId,
        orderId: payment.orderId,
        signature: payment.signature,
      }, { headers: { Authorization: `Bearer ${tempToken}` } });
      if (response?.status !== 'SUCCESS') throw new Error(response?.message || 'Salon registration failed.');
      const token = response.token || response.data?.token;
      if (!token) throw new Error('Salon registration completed without a login session. Please try again.');
      const createdSalonId = response.salonId || response.data?.salonId || response.salon?.salonId || response.data?.salon?.salonId;
      if (!createdSalonId) throw new Error('Salon registration completed without a salon ID. Please try again.');
      const user = {
        ...registration,
        salonId: createdSalonId,
        salon: { ...(registration.salon || {}), salonId: createdSalonId },
        isNewSalon: false,
        profileCompleted: true,
      };
      delete user.tempToken;
      clearPendingPayment();
      setPaymentState('idle');
      onAuthComplete?.({ role: 'SALON', token, user, userId: createdSalonId, isNewSalon: false });
      return 'register';
    }
    // `planType`, `paymentId` and `totalAmount` are the mobile contract; the
    // order id and signature are sent alongside so a backend that verifies the
    // Razorpay signature has everything it needs instead of rejecting a real,
    // already-charged payment.
    const response = await api.renewSalon({
      planType: plan.id,
      paymentId: payment.paymentId,
      totalAmount: plan.price,
      ...(payment.orderId ? { orderId: payment.orderId } : {}),
      ...(payment.signature ? { signature: payment.signature } : {}),
    });
    if (response?.status !== 'SUCCESS') throw new Error(response?.message || 'Renewal failed.');
    resetPlanExpiredAlert();
    clearPendingPayment();
    // Keep the cached session in step so the account screen does not flash the
    // previous plan while it re-reads the profile. The explicit active flag also
    // releases the hard paywall immediately, before the profile refresh returns.
    const returnedPlan = response?.data?.subscription || response?.data?.plan || response?.subscription || response?.plan || {};
    onSessionUpdate?.({
      ...returnedPlan,
      planType: returnedPlan.planType || plan.id,
      planStatus: 'ACTIVE',
      subscriptionExpired: false,
      profileCompleted: true,
    }, {});
    setPaymentState('idle');
    notify?.('success', 'Plan renewed successfully. Welcome back!');
    // When renewal was forced by expiry, send the salon straight to the queue
    // so full software access is restored immediately. Normal upgrades go to
    // account.
    if (isForcedRenewal) {
      navigate('queue', {}, { replace: true });
    } else {
      navigate('account', {}, { replace: true });
    }
    return 'renew';
  }, [isForcedRenewal, navigate, notify, onAuthComplete, onSessionUpdate]);

  // A successful payment that could not be recorded is the one dangerous
  // failure: tell the partner exactly what happened, with the references
  // support needs, and never invite a second payment.
  const reportActivationFailure = useCallback((error, payment) => {
    const message = getErrorMessage(error, 'The plan could not be activated.');
    setPaymentState('idle');
    // Keep the record (marked as activation-failed) so a reload still shows the
    // references support needs — and never offers a second payment.
    savePendingPayment({ ...(readPendingPayment() || {}), stage: 'activation-failed', paymentId: payment?.paymentId || '', orderId: payment?.orderId || '' });
    setNotice({
      tone: 'error',
      title: 'Payment received, plan not updated yet',
      text: `${message} Do not pay again. Call ${SUPPORT_PHONE} with payment ID ${payment?.paymentId || 'unknown'} and order ID ${payment?.orderId || 'unknown'} and we will activate or refund it.`,
    });
    notify?.('error', `${message} Payment ID ${payment?.paymentId || 'unknown'} — call ${SUPPORT_PHONE}, do not pay again.`);
  }, [notify]);

  // Opens Razorpay Checkout and translates every possible outcome into an
  // explicit message: success, partner-cancelled, gateway failure, or a UPI app
  // hand-off that never came back.
  const runPayment = useCallback(async (plan, flow, registration) => {
    setNotice(null);
    setPaymentState('opening');

    // The public key is what Checkout authenticates with. An empty/placeholder
    // value produced an opaque Razorpay error only after the sheet tried to
    // open, so check it up front and say so plainly.
    const key = getRazorpayKey();
    if (!key) {
      setPaymentState('idle');
      setNotice({ tone: 'error', title: 'Payments are not configured', text: `This build has no Razorpay key, so payments cannot be taken here. Please call ${SUPPORT_PHONE} — do not attempt to pay.` });
      notify?.('error', 'Razorpay is not configured for this build.');
      return null;
    }

    // Load Checkout *before* creating the order. Creating an order first left a
    // live unpaid order behind whenever checkout.js was blocked by the network
    // or an ad blocker, and the partner saw a generic failure.
    const ready = gateway.status === 'ready' ? true : await gateway.check();
    if (!ready) {
      setPaymentState('idle');
      setNotice({ tone: 'error', title: 'Payment gateway unavailable', text: 'Razorpay Checkout could not load on this network. Retry below, turn off any ad/tracker blocker for this site, or switch to another connection and try again.' });
      notify?.('error', 'Razorpay Checkout could not load. Please retry.');
      return null;
    }

    let order;
    try {
      // During registration there is no persisted session yet: the temporary
      // token from verify-otp-register is the only credential that exists, and
      // backends that protect this route rejected the unauthenticated call with
      // a 401 that surfaced as "could not start the payment".
      const tempToken = String(registration?.tempToken || '').trim();
      const response = await api.createPaymentOrder(
        { amount: plan.price, currency: 'INR', planType: plan.id },
        tempToken ? { headers: { Authorization: `Bearer ${tempToken}` } } : {},
      );
      order = extractRazorpayOrder(response);
      if (!order?.id) throw new Error(response?.message || 'The payment order came back empty.');
    } catch (error) {
      setPaymentState('idle');
      const message = getErrorMessage(error, 'Could not create the payment order.');
      setNotice({ tone: 'error', title: 'Could not start the payment', text: `${message} Nothing was charged. Check your connection and try again, or call ${SUPPORT_PHONE} if it keeps failing.` });
      notify?.('error', message);
      return null;
    }

    // Persisted before the sheet opens: if the mobile browser kills this tab
    // while a UPI app is in front, the partner gets a recovery card instead of
    // silently losing the payment.
    savePendingPayment({
      flow,
      orderId: order.id,
      planId: plan.id,
      planTitle: plan.title,
      amount: plan.price,
      amountPaise: orderAmountInPaise(order, plan.price),
      ...(registration ? { registration } : {}),
    });

    setPaymentState('in-checkout');
    const result = await openRazorpayCheckout({
      key,
      orderId: order.id,
      amount: orderAmountInPaise(order, plan.price),
      currency: order.currency || 'INR',
      description: `${plan.title} · My Naai salon partner subscription`,
      image: CHECKOUT_IMAGE,
      themeColor: GOLD,
      prefill: {
        name: registration?.ownerName || registration?.salonName || '',
        contact: registration?.phoneNumber || session?.user?.phoneNumber || '',
        email: registration?.email || session?.user?.email || '',
      },
      notes: { plan: plan.id, flow, salonId: session?.userId || registration?.salonId || '' },
      onEvent: event => {
        if (event.type === 'app-switch') setPaymentState('app-switched');
        else if (event.type === 'returned') setPaymentState('confirming');
        else if (event.type === 'failed') {
          // The sheet stays open so the partner can retry with another method.
          notify?.('error', describePaymentFailure(event.error));
        }
      },
    });

    if (result.status === 'success') {
      setPaymentState('confirming');
      return result.payment;
    }

    clearPendingPayment();
    setPaymentState('idle');
    if (result.status === 'cancelled') {
      const cameBackFromApp = Boolean(result.switchedAway);
      setNotice({
        tone: 'info',
        title: 'Payment cancelled',
        text: cameBackFromApp
          ? `You returned from your payment app and closed the sheet before it confirmed. No amount was charged unless your bank shows a debit — then call ${SUPPORT_PHONE} with order ID ${order.id}. Choose Continue to try again.`
          : `You closed Razorpay before completing the payment, so nothing was charged. Order ${order.id} is now closed — choose Continue to start a fresh payment.`,
      });
      notify?.('info', 'Payment cancelled. No amount was charged.');
      return null;
    }
    if (result.status === 'unavailable') {
      setNotice({ tone: 'error', title: 'Payment gateway unavailable', text: 'Razorpay Checkout closed unexpectedly. Retry, or continue on a different browser or connection.' });
      notify?.('error', 'Razorpay Checkout is unavailable. Please retry.');
      return null;
    }
    setNotice({
      tone: 'error',
      title: 'Payment failed',
      text: `${describePaymentFailure(result.error)} A failed attempt is not charged. Order ${order.id} can be retried below.`,
    });
    notify?.('error', describePaymentFailure(result.error));
    return null;
  }, [gateway, notify, session?.userId, session?.user?.email, session?.user?.phoneNumber]);

  const completeFreeOnboarding = useCallback(() => {
    clearPendingPayment();
    localStorage.setItem('isNewSalon', 'false');
    onSessionUpdate?.({}, { isNewSalon: false });
    notify?.('success', 'Your free trial is ready. Welcome to My Naai.');
    navigate('queue', {}, { replace: true });
  }, [navigate, notify, onSessionUpdate]);

  // Finish a payment that came back through a redirect (UPI app / netbanking
  // hand-off) using the order we stored before opening checkout.
  const completeRedirectedPayment = useCallback(async (pending, returned) => {
    const plan = plans.find(item => item.id === pending.planId)
      || { id: pending.planId, title: pending.planTitle || 'Selected plan', price: Number(pending.amount) || 0 };
    setLoading(true);
    inFlight.current = true;
    try {
      await finalizePlan({
        plan,
        payment: { paymentId: returned.paymentId, orderId: returned.orderId || pending.orderId, signature: returned.signature || '' },
        registration: pending.flow === 'register' ? pending.registration : null,
      });
    } catch (error) {
      reportActivationFailure(error, { paymentId: returned.paymentId, orderId: returned.orderId || pending.orderId });
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, [finalizePlan, plans, reportActivationFailure]);

  // Recovery on mount: a redirect return, a stale/interrupted pending payment,
  // or nothing at all.
  useEffect(() => {
    const returned = readRedirectedPayment();
    const pending = readPendingPayment();
    if (returned?.paymentId) {
      clearRedirectedPaymentParams();
      if (pending && (!returned.orderId || returned.orderId === pending.orderId)) {
        setRecovery(null);
        setNotice({ tone: 'info', title: 'Confirming your payment', text: 'Your payment app sent the result back to My Naai. Activating your plan…' });
        completeRedirectedPayment(pending, returned);
        return;
      }
      clearPendingPayment();
      setNotice({
        tone: 'error',
        title: 'Payment received, but this session expired',
        text: `Payment ${returned.paymentId} could not be matched to an open order. Do not pay again — call ${SUPPORT_PHONE} and we will activate or refund it.`,
      });
      return;
    }
    if (returned?.errorCode) {
      clearRedirectedPaymentParams();
      clearPendingPayment();
      setNotice({ tone: 'error', title: 'Payment failed', text: describePaymentFailure({ code: returned.errorCode, description: returned.errorDescription }) });
      return;
    }
    if (!pending) return;
    if (isPendingPaymentFresh(pending)) setRecovery(pending);
    else clearPendingPayment();
    // Runs once per screen mount; the helpers read browser storage directly.
  }, []);

  const continuePlan = async () => {
    if (loading || inFlight.current) return;
    const plan = plans.find(item => item.id === selected);
    if (!plan) return notify?.('error', 'Please choose a plan to continue.');
    setNotice(null);
    if (showFreeOnboarding && plan.id === FREE_ONBOARDING_PLAN.id) return completeFreeOnboarding();
    if (isRegistration && !String(registrationData?.deviceToken || '').trim()) {
      return notify?.('error', 'Enable notifications, then continue. A device token is required to register the salon.');
    }
    inFlight.current = true;
    setLoading(true);
    try {
      const flow = isRegistration ? 'register' : 'renew';
      const payment = await runPayment(plan, flow, isRegistration ? registrationData : null);
      if (!payment) return;
      if (!payment.paymentId) {
        reportActivationFailure(new Error('Razorpay did not return a payment ID.'), payment);
        return;
      }
      try {
        await finalizePlan({ plan, payment, registration: isRegistration ? registrationData : null });
      } catch (activationError) {
        // The money moved but the plan did not: never suggest paying again.
        reportActivationFailure(activationError, payment);
      }
    } catch (error) {
      setPaymentState('idle');
      const message = getErrorMessage(error, 'Payment process failed.');
      setNotice({ tone: 'error', title: 'Could not complete the plan', text: `${message} No payment was taken for this attempt.` });
      notify?.('error', message);
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
    return undefined;
  };

  const retryRecovery = () => {
    const pending = recovery;
    setRecovery(null);
    clearPendingPayment();
    if (pending?.planId && plans.some(item => item.id === pending.planId)) setSelected(pending.planId);
    continuePlan();
  };

  const handleBack = isForcedRenewal
    ? undefined
    : isRegistration
      ? params.onBack
      : isOnboarding
        ? () => navigate('account', {}, { replace: true })
        : () => navigate(-1);

  return <div className={cx('screen', 'subscription-screen', isForcedRenewal && 'forced-renewal-screen')}><PageHeader title={isForcedRenewal ? 'Renew your salon subscription' : isUpgrade ? 'Renew your plan' : 'Choose your plan'} subtitle={isForcedRenewal ? 'Your subscription has expired. Renewal is required before you can use the salon portal.' : isOnboarding ? 'Choose how you want to start your salon journey.' : isUpgrade ? 'Keep your salon visible and ready for bookings.' : 'Start building your salon presence on My Naai.'} onBack={handleBack} />
    <div className="subscription-intro"><div className="subscription-mark"><Crown size={21} /></div><div><strong>{isForcedRenewal ? 'Renewal required to continue' : isOnboarding ? 'Your salon is ready for a final choice' : isUpgrade ? 'Keep the momentum going' : 'Simple plans for growing salons'}</strong><p>{isForcedRenewal ? 'Choose a renewal plan and complete payment to unlock your queue, history, products and account.' : isOnboarding ? 'Start with a 20-day free trial or choose a paid plan.' : 'No confusing tiers. Pick what fits your business today.'}</p></div></div>
    {notice && <div className={cx('payment-notice', `notice-${notice.tone || 'info'}`)} role="status"><span className="payment-notice-mark">{notice.tone === 'error' ? <CircleAlert size={17} /> : notice.tone === 'info' ? <WalletCards size={17} /> : <CheckCircle2 size={17} />}</span><div><strong>{notice.title}</strong><p>{notice.text}</p></div><button type="button" onClick={() => setNotice(null)} aria-label="Dismiss message"><X size={15} /></button></div>}
    {recovery && <div className="payment-recovery" role="status">
      <span className="payment-notice-mark"><CircleAlert size={17} /></span>
      <div>
        <strong>{recovery.stage === 'activation-failed' ? 'Payment received, plan not activated' : 'We could not confirm your last payment'}</strong>
        {recovery.stage === 'activation-failed' ? <p>Razorpay confirmed payment {recovery.paymentId || ''} for order {recovery.orderId || '—'}, but My Naai could not activate the plan. Do not pay again — call {SUPPORT_PHONE} with these details and we will activate or refund it.</p> : <p>{recovery.flow === 'register'
          ? `Your ${recovery.planTitle || 'plan'} payment for order ${recovery.orderId || '—'} was interrupted before My Naai could finish registering the salon.`
          : `Your ${recovery.planTitle || 'plan'} renewal for order ${recovery.orderId || '—'} was interrupted before My Naai could activate it.`}
          {recovery.flow === 'register'
            ? ' Try the payment again below — if your bank already debited the amount, call support instead of paying twice.'
            : ' Try again below, or call support with the order ID if the amount was already debited.'}</p>}
      </div>
      <div className="payment-recovery-actions">
        {recovery.stage !== 'activation-failed' && <Button size="small" onClick={retryRecovery} disabled={loading}>Try again</Button>}
        <a className="text-link" href={`tel:${SUPPORT_PHONE}`}><Phone size={14} /> {SUPPORT_PHONE}</a>
        <button type="button" className="text-link" onClick={() => { setRecovery(null); clearPendingPayment(); }}>Dismiss</button>
      </div>
    </div>}
    <div className="plan-grid">{plans.map(plan => <button className={cx('plan-card', selected === plan.id && 'active')} key={plan.id} onClick={() => setSelected(plan.id)} disabled={loading}><span className="plan-card-title">{plan.title}</span><strong>{plan.displayPrice || formatCurrency(plan.price)}</strong><span className="plan-duration">{plan.duration}</span><small>{plan.note}</small><span className="plan-radio" aria-hidden="true">{selected === plan.id && <Check size={13} />}</span>{plan.best && <span className="plan-best">{plan.id === FREE_ONBOARDING_PLAN.id ? 'DEFAULT' : 'BEST VALUE'}</span>}</button>)}</div>
    <div className="plan-benefits"><span><CheckCircle2 size={16} /> Be discoverable nearby</span><span><CheckCircle2 size={16} /> Manage your live queue</span><span><CheckCircle2 size={16} /> Get booking updates</span></div>
    {stateCopy && <div className="payment-progress" role="status"><LoaderCircle className="spin" size={16} /><span><strong>{stateCopy.title}</strong><small>{stateCopy.text}</small></span></div>}
    {isMobile && !stateCopy && <p className="payment-method-note"><Smartphone size={16} /><span>Razorpay may open your UPI app — Google Pay, PhonePe, Paytm or BHIM. Pay there, then come straight back to this page. My Naai confirms the payment automatically, so please do not pay twice.</span></p>}
    <Button className="subscription-continue" onClick={continuePlan} loading={loading} disabled={gateway.status === 'unavailable'}>{isOnboarding && selected === FREE_ONBOARDING_PLAN.id ? 'Start free trial' : isUpgrade ? 'Renew plan' : 'Continue to payment'} <ChevronRight size={17} /></Button>
    <div className={cx('gateway-status', `gateway-${gateway.status}`)}>
      {gateway.status === 'ready' ? <CheckCircle2 size={15} /> : gateway.status === 'checking' ? <LoaderCircle className="spin" size={15} /> : <CircleAlert size={15} />}
      <span>{gateway.status === 'ready' ? 'Secure payments powered by Razorpay · UPI, cards, netbanking and wallets' : gateway.status === 'checking' ? 'Preparing Razorpay Checkout…' : 'Razorpay Checkout could not load on this network'}</span>
      {gateway.status !== 'ready' && <button type="button" onClick={gateway.check}>Retry</button>}
    </div>
    {isForcedRenewal && onLogout && (
      <div className="forced-renewal-footer">
        <button className="forced-renewal-logout" onClick={onLogout}><LogOut size={15} /> Sign out</button>
        <span className="forced-renewal-help">Need help? Call <a href={`tel:${SUPPORT_PHONE}`}>{SUPPORT_PHONE}</a></span>
      </div>
    )}
  </div>;
}
