'use strict';

const { describeDuration, formatTimeLabel, offsetDirection } = require('./bookingClock');

/**
 * Notification copy and delivery for a booking time change.
 *
 * The whole reason `delayMinutes` is signed is so this file can tell a customer
 * "we can see you 15 minutes earlier" instead of "your booking is delayed by
 * -15 minutes". Everything customer-facing branches on the sign; nothing else
 * in the system needs to know.
 */

// Optional: only required if you use the default sender.
let admin = null;
try {
  admin = require('firebase-admin');
} catch {
  // firebase-admin not installed — plug your own sender into sendPushMessage.
}

/**
 * Build the title/body pair the customer sees.
 *
 * `offsetMinutes` signed, `proposedTime` an 'HH:mm:ss' string.
 */
function buildTimeChangeCopy({ salonName, offsetMinutes, proposedTime, reason, crossesDay, proposedDateLabel }) {
  const salon = salonName || 'Your salon';
  const duration = describeDuration(offsetMinutes);
  const timeLabel = formatTimeLabel(proposedTime);
  const dayNote = crossesDay && proposedDateLabel ? ` on ${proposedDateLabel}` : '';

  const copy = offsetDirection(offsetMinutes) === 'EARLIER'
    ? {
      title: 'Earlier time available',
      body: `${salon} can see you ${duration} earlier, at ${timeLabel}${dayNote}. Can you make it?`,
    }
    : {
      title: 'Your appointment is running late',
      body: `${salon} needs ${duration} more. New time: ${timeLabel}${dayNote}. Can you still make it?`,
    };

  // The salon's own words carry more weight than any generic apology, so they
  // go in the body where the customer actually reads them.
  if (reason) copy.body += ` — ${reason}`;
  return copy;
}

/** Copy for the salon when the customer answers. */
function buildResponseCopy({ customerName, accepted, proposedTime }) {
  const who = customerName || 'The customer';
  return accepted
    ? {
      title: 'New time accepted',
      body: `${who} accepted the new time of ${formatTimeLabel(proposedTime)}.`,
    }
    : {
      title: 'New time declined',
      body: `${who} kept their original booking time.`,
    };
}

/**
 * Actually send. Replace the body of this function if you already have a push
 * helper — the controller only cares that it resolves to a boolean.
 *
 * A failed push must never fail the request: the time change is already
 * committed, and a salon whose "Update time" button errors out after the
 * database was written will just press it again and confuse everyone. The
 * failure is logged and reported as `notified: false`.
 */
async function sendPushMessage({ deviceToken, title, body, data }) {
  if (!deviceToken) return false;
  if (!admin || !admin.apps || !admin.apps.length) {
    console.warn('[notifyCustomer] firebase-admin not initialised; skipping push');
    return false;
  }

  try {
    await admin.messaging().send({
      token: deviceToken,
      notification: { title, body },
      // FCM stringifies data values anyway; doing it here keeps what the client
      // receives identical to what we intended to send.
      data: Object.fromEntries(
        Object.entries(data || {}).map(([key, value]) => [key, value === undefined || value === null ? '' : String(value)]),
      ),
      android: {
        priority: 'high',
        notification: { channelId: 'booking-updates', sound: 'default' },
      },
      apns: {
        payload: { aps: { sound: 'default', contentAvailable: true } },
      },
    });
    return true;
  } catch (error) {
    // An unregistered token is expected (app uninstalled) and not worth an alert.
    const code = error && error.errorInfo && error.errorInfo.code;
    if (code === 'messaging/registration-token-not-registered') {
      console.info('[notifyCustomer] stale device token, skipping');
      return false;
    }
    console.error('[notifyCustomer] push failed:', error && error.message);
    return false;
  }
}

/**
 * Notify the customer that the salon wants to move their booking.
 * Resolves to true only when a push actually went out.
 */
async function notifyCustomerOfTimeChange({
  deviceToken,
  salonName,
  customerName,
  bookingRequestId,
  bookingId,
  offsetMinutes,
  proposedDate,
  proposedTime,
  proposedDateLabel,
  crossesDay,
  reason,
}) {
  const { title, body } = buildTimeChangeCopy({
    salonName,
    offsetMinutes,
    proposedTime,
    reason,
    crossesDay,
    proposedDateLabel,
  });

  return sendPushMessage({
    deviceToken,
    title,
    body,
    data: {
      // The mobile app switches on `type` to route to DelayRequestScreen.
      type: 'BOOKING_TIME_CHANGE',
      bookingRequestId,
      bookingId,
      customerName,
      salonName,
      delayMinutes: offsetMinutes,          // signed, stringified on the way out
      direction: offsetDirection(offsetMinutes),
      proposedTime: formatTimeLabel(proposedTime),
      proposedBookingDate: proposedDate,
      proposedBookingTime: proposedTime,
      reason: reason || '',
    },
  });
}

/** Notify the salon owner that the customer answered. */
async function notifySalonOfResponse({
  deviceToken,
  customerName,
  accepted,
  bookingRequestId,
  bookingId,
  proposedTime,
}) {
  const { title, body } = buildResponseCopy({ customerName, accepted, proposedTime });

  return sendPushMessage({
    deviceToken,
    title,
    body,
    data: {
      type: 'BOOKING_TIME_CHANGE_RESPONSE',
      bookingRequestId,
      bookingId,
      action: accepted ? 'ACCEPT' : 'REJECT',
      customerName,
      proposedTime: formatTimeLabel(proposedTime),
    },
  });
}

module.exports = {
  buildResponseCopy,
  buildTimeChangeCopy,
  notifyCustomerOfTimeChange,
  notifySalonOfResponse,
  sendPushMessage,
};
