import React, { useCallback, useEffect, useState } from 'react';
import { Bell, Check, ChevronRight, Clock3, Info, X } from 'lucide-react';
import { api } from '../lib/api';
import { closeNotification } from '../lib/push';
import { Button, cx, formatDate, getErrorMessage, getInitials } from './Shared';

// The salon's answer window for a new booking request, mirroring the mobile app:
// 60 seconds to accept, reject, or propose another time. The same number is the
// worker's repeat window (public/firebase-messaging-sw.js) and the request
// screen's countdown (SalonScreens.jsx).
export const BOOKING_ALERT_WINDOW_MS = 60000;
const WARNING_AT_MS = 15000;

// The in-app face of a booking request: the one alert that asks for a decision
// instead of just announcing one. It appears on whatever screen the salon is
// looking at — the queue, a profile editor, the dashboard — with the three
// answers the mobile app offers, and it offers them for exactly one minute.
//
// Why a card and not another toast: a toast is a sentence that disappears; a
// booking request is a decision with a deadline. The countdown is the same one
// the request screen shows, and when it runs out the buttons go away rather
// than letting the owner tap an answer the server no longer accepts.
export function BookingRequestAlert({ alert = null, notify, navigate, onDone, onDismiss }) {
  const bookingRequestId = alert?.data?.bookingRequestId || alert?.data?.bookingId || '';
  const arrival = Number(alert?.sentAt) || Date.now();
  const [deadline, setDeadline] = useState(() => arrival + BOOKING_ALERT_WINDOW_MS);
  const [details, setDetails] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [expired, setExpired] = useState(() => Date.now() >= deadline);
  const [busy, setBusy] = useState('');

  // The push payload carries the ids, not the story. The request screen's own
  // endpoint fills in the customer and the slot; until it answers, the card
  // shows what the notification already said.
  useEffect(() => {
    if (!bookingRequestId) return undefined;
    let cancelled = false;
    api.getBookingRequestById(bookingRequestId)
      .then(response => { if (!cancelled) setDetails(response?.data || null); })
      .catch(() => { /* the card still works from the push payload */ });
    return () => { cancelled = true; };
  }, [bookingRequestId]);

  // The server's answer window starts when the customer sent the request, not
  // when the push reached this device. Once the request arrives, use the earlier
  // of the two so the card never offers an answer the server would refuse.
  useEffect(() => {
    const created = details?.createdAt || details?.bookingRequestTime || details?.createdAtTimestamp;
    const createdMs = created ? new Date(created).getTime() : NaN;
    if (!Number.isFinite(createdMs) || createdMs <= 0) return;
    setDeadline(current => Math.min(current, createdMs + BOOKING_ALERT_WINDOW_MS));
  }, [details]);

  useEffect(() => {
    const tick = () => {
      const current = Date.now();
      setNow(current);
      setExpired(current >= deadline);
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [deadline]);

  const answer = useCallback(async (action, delayMinutes) => {
    if (!bookingRequestId || busy) return;
    setBusy(action);
    try {
      const response = action === 'DELAY'
        ? await api.salonDelayBooking(bookingRequestId, delayMinutes)
        : await api.bookingRequestOwnerAction(bookingRequestId, { action });
      if (response?.status && response.status !== 'SUCCESS') throw new Error(response.message || 'Could not update request');
      notify?.('success', action === 'ACCEPT' ? 'Booking accepted.' : action === 'REJECT' ? 'Booking rejected.' : 'Customer notified about the delay.');
      closeNotification(bookingRequestId);
      onDone?.(action);
    } catch (error) {
      notify?.('error', getErrorMessage(error, 'Could not update booking request.'));
      setBusy('');
    }
  }, [bookingRequestId, busy, notify, onDone]);

  const openRequest = useCallback((openDelayModal = false) => {
    // Handing the decision to the request screen: it shows the full details, the
    // same countdown, and the delay options. The banner has done its job.
    closeNotification(bookingRequestId);
    onDismiss?.();
    navigate?.('bookingRequest', openDelayModal ? { bookingRequestId, openDelayModal: 'true' } : { bookingRequestId });
  }, [bookingRequestId, navigate, onDismiss]);

  if (!alert || !bookingRequestId) return null;

  const remaining = Math.max(0, deadline - now);
  const seconds = Math.ceil(remaining / 1000);
  const countdownLabel = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const warning = !expired && remaining <= WARNING_AT_MS;
  const customer = details?.customerName || details?.userName || alert.data?.customerName || 'A customer';
  const when = details
    ? `${formatDate(details.bookingDate)} · ${details.startTime || '—'}${details.endTime ? ` – ${details.endTime}` : ''}`
    : (alert.data?.bookingDate || alert.data?.slot || 'Time in the app');

  return (
    <div className="alert-dock">
      <div className="booking-alert" role="alertdialog" aria-live="assertive" aria-label={`New booking request from ${customer}`}>
        <div className="booking-alert-top">
          <span className="booking-alert-mark" aria-hidden="true"><Bell size={16} /></span>
          <span className="booking-alert-avatar" aria-hidden="true">{getInitials(customer)}</span>
          <span className="booking-alert-who">
            <small className="eyebrow">NEW BOOKING REQUEST</small>
            <strong>{customer}</strong>
            <span>{when}</span>
          </span>
          <span className={cx('request-timer', warning && 'timer-warning')}>
            <small>{expired ? 'Expired' : 'Respond in'}</small>
            {!expired && <strong>{countdownLabel}</strong>}
          </span>
          <button className="booking-alert-close" onClick={() => onDismiss?.()} aria-label="Dismiss this alert"><X size={14} /></button>
        </div>
        {expired ? (
          <div className="booking-alert-expired" role="status">
            <Info size={15} />
            <span>The 60-second answer window has closed. Open the request to see its current status.</span>
            <button onClick={() => openRequest(false)}>Open request</button>
          </div>
        ) : (
          <div className="booking-alert-actions">
            <Button variant="success" size="small" loading={busy === 'ACCEPT'} onClick={() => answer('ACCEPT')}>Accept <Check size={16} /></Button>
            <Button variant="danger" size="small" loading={busy === 'REJECT'} onClick={() => answer('REJECT')}>Reject <X size={16} /></Button>
            <Button variant="secondary" size="small" onClick={() => openRequest(true)}>Update time <Clock3 size={15} /></Button>
            <button className="booking-alert-more" onClick={() => openRequest(false)}>Details <ChevronRight size={14} /></button>
          </div>
        )}
      </div>
    </div>
  );
}
