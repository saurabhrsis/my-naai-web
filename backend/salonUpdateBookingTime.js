// Salon Queue → "Update time": the salon moves the time of a booking it has
// ALREADY accepted, and that is the whole flow. No customer confirmation.
//
//   salon sets the new time  →  booking + queue row move  →  customer is told
//
// The customer does not accept or decline anything here. The appointment is
// real and the salon owns the chair, so the new time is simply the time: the
// booking is updated, the queue row moves with it, and the customer gets an
// in-app notification and a push telling them to come earlier or later.
//
// ⚠️ This is NOT the booking-REQUEST flow (owner-action / ownerActionBooking).
// A first-time request is answered with ACCEPT / REJECT / DELAY there, and a
// DELAY there is a *proposal* the customer answers — which is why it keeps the
// DELAY_TIME_PROPOSAL type. This endpoint runs after the booking is confirmed
// and sends BOOKING_TIME_UPDATED, which the apps open read-only.
//
// Drop this file in next to the other booking controllers and wire it:
//
//   const salonUpdateBookingTime = require('./controllers/booking/salonUpdateBookingTime');
//   router.post('/salon/queue/update-time/:bookingId', salonAuth, salonUpdateBookingTime);
//
// Route:  POST /api/booking/salon/queue/update-time/:bookingId
// Body:
//   { "time": "18:50:00" }                     // the new time, 'HH:mm' or 'HH:mm:ss'
//   { "time": "00:20", "date": "2026-09-08" }  // +date when the slot crosses midnight
//   { "offsetMinutes": 20 }                    // instead of a time: + later, - earlier
//   { "reason": "Previous cut is running long" }   // optional, goes in the message
//
// The only status check is the one that matters: a booking that is already
// completed or cancelled has no time left to move. Everything else is fair
// game — confirmed, or a leftover delay_requested from the old flow, which this
// settles back to confirmed.

const db = require('../database/models');
const { formatTo12Hour } = require('../utils/timeFormat');
const sendNotificationToDevice = require('../firebase/sendNotification');

// A booking can be nudged, not rebooked. Beyond this, the salon wants a new
// booking, and silently moving an appointment by half a day is a mistake.
const MAX_OFFSET_MINUTES = 240;
// A salon taps "Update" on a booking that is due right now; a small grace
// window stops the request failing on the seconds it took to arrive.
const PAST_GRACE_MINUTES = 1;
const MINUTES_IN_DAY = 24 * 60;

// The two states a booking reaches that no time change can follow. Anything
// else still has an appointment to keep.
const FINAL_STATUSES = ['completed', 'cancelled'];

function pad(value) {
  return String(value).padStart(2, '0');
}

// 'HH:mm' | 'HH:mm:ss' -> minutes since midnight, or null when unparseable.
function toMinutes(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || hours > 23 || !Number.isFinite(minutes) || minutes > 59) return null;
  return hours * 60 + minutes;
}

// Minutes since midnight -> 'HH:mm:ss'. Minutes outside 0–1439 are rolled over
// by the caller first, so this never sees an out-of-range value.
function toClock(minutes) {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:00`;
}

// 'YYYY-MM-DD' or a full ISO timestamp -> 'YYYY-MM-DD'.
function toDay(value) {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

function addDays(day, days) {
  const [year, month, dayOfMonth] = day.split('-').map(Number);
  const date = new Date(year, month - 1, dayOfMonth);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Whole days between two 'YYYY-MM-DD' values, as minutes — so a signed offset
// stays honest across midnight (23:40 → 00:20 is +40, not -1400).
function dayShiftMinutes(fromDay, toDay) {
  const parse = value => {
    const [year, month, dayOfMonth] = String(value).split('-').map(Number);
    return Date.UTC(year, month - 1, dayOfMonth);
  };
  return Math.round((parse(toDay) - parse(fromDay)) / 86400000) * MINUTES_IN_DAY;
}

// Has this slot already gone? Built from the SERVER's wall clock, because
// `toISOString()` is UTC and an Indian salon at 00:30 is still on yesterday's
// UTC date — a DATEONLY column read against that calls today's bookings "past"
// for five and a half hours every night.
function isPast(day, minutes) {
  const [year, month, dayOfMonth] = day.split('-').map(Number);
  const at = new Date(year, month - 1, dayOfMonth, Math.floor(minutes / 60), minutes % 60, 0, 0);
  return at.getTime() < Date.now() - PAST_GRACE_MINUTES * 60000;
}

// Only the columns the loaded model actually declares. `proposedBookingTime`,
// `proposedBookingDate`, `delayMinutes`, `customerResponse` and `expiresAt` are
// commented out of the Booking model today; writing one anyway makes Sequelize
// throw "Unknown attribute" and the salon sees a 500 for a change that is
// otherwise perfectly valid. Uncomment the columns and the writes land.
function pickColumns(model, values) {
  const attributes = model?.rawAttributes;
  if (!attributes) return values;
  return Object.fromEntries(
    Object.entries(values).filter(([key]) => Object.prototype.hasOwnProperty.call(attributes, key)),
  );
}

function normalizeDeviceToken(value) {
  if (typeof value !== 'string') return '';
  const token = value.trim();
  if (!token || /[\u0000-\u0020\u007f]/.test(token) || token.length < 20 || token.length > 4096) return '';
  return token;
}

function permanentTokenError(error) {
  const text = `${error?.code || ''} ${error?.errorInfo?.code || ''} ${error?.message || error || ''}`.toLowerCase();
  return /registration-token-not-registered|invalid-registration-token|unregistered|not-registered|requested entity was not found/.test(text);
}

function deviceTokenFromRow(row) {
  return normalizeDeviceToken(row?.token || row?.deviceToken);
}

async function activeCustomerDeviceRows(userId) {
  const Model = db.DeviceToken;
  if (!Model || userId === undefined || userId === null || userId === '') return [];
  try {
    const where = { ownerType: 'USER', ownerId: userId, active: true };
    if (typeof Model.findAll === 'function') {
      const rows = await Model.findAll({ where });
      return Array.isArray(rows) ? rows : [];
    }
    if (typeof Model.findOne === 'function') {
      const row = await Model.findOne({ where });
      return row ? [row] : [];
    }
  } catch (error) {
    // The appointment is still valid if the optional device table is being
    // migrated. The legacy account column below remains a safe fallback.
    console.error('Could not read active customer device tokens:', error?.message || error);
  }
  return [];
}

async function deactivateDeviceRow(row, token, userId) {
  try {
    if (typeof row?.update === 'function') {
      await row.update({ active: false, lastSeenAt: new Date() });
    } else if (db.DeviceToken?.update) {
      await db.DeviceToken.update({ active: false, lastSeenAt: new Date() }, { where: { token } });
    }
    // Also clear a matching legacy account column. This is conditional on the
    // old token, so a concurrent rotation to a new token is never overwritten.
    if (db.User?.update) {
      await db.User.update({ deviceToken: null }, { where: { userId, deviceToken: token } });
    }
  } catch (error) {
    console.error('Could not deactivate stale device token:', error?.message || error);
  }
}

async function notifyCustomerDevices({ userId, legacyToken, title, message, payload }) {
  const rows = await activeCustomerDeviceRows(userId);
  const records = rows
    .map(row => ({ row, token: deviceTokenFromRow(row) }))
    .filter(record => record.token);
  const legacy = normalizeDeviceToken(legacyToken);
  if (legacy) records.push({ row: null, token: legacy });

  // A duplicate row or a legacy column containing the same token must not make
  // the customer hear the same alert twice. Keep the row associated with the
  // first occurrence so a permanently invalid registration can be deactivated.
  const unique = new Map();
  for (const record of records) if (!unique.has(record.token)) unique.set(record.token, record);
  const devices = [...unique.values()];
  if (!devices.length) return { attempted: 0, sent: 0 };

  const results = await Promise.all(devices.map(async ({ row, token }) => {
    try {
      const result = await sendNotificationToDevice(token, title, message, payload);
      if (result === false) return { sent: false };
      return { sent: true };
    } catch (error) {
      if (permanentTokenError(error)) await deactivateDeviceRow(row, token, userId);
      else console.error('Salon Queue Update Time push failed:', error?.message || error);
      return { sent: false };
    }
  }));
  return {
    attempted: devices.length,
    sent: results.filter(result => result.sent).length,
  };
}

async function createUniqueNotification(values) {
  const Model = db.Notification;
  if (!Model?.create) return;
  const eventKey = `BOOKING_TIME_UPDATED:${values.bookingId}:${values.bookingDate || ''}:${values.bookingTime || ''}`;
  const attributes = Model.rawAttributes || {};
  const dedupeField = ['eventKey', 'notificationKey', 'dedupeKey'].find(field => Object.prototype.hasOwnProperty.call(attributes, field));
  const data = pickColumns(Model, dedupeField ? { ...values, [dedupeField]: eventKey } : values);
  if (dedupeField && typeof Model.findOrCreate === 'function') {
    await Model.findOrCreate({ where: { [dedupeField]: eventKey }, defaults: data });
    return;
  }
  if (dedupeField && typeof Model.findOne === 'function') {
    const existing = await Model.findOne({ where: { [dedupeField]: eventKey } });
    if (existing) return;
  }
  await Model.create(data);
}

const salonUpdateBookingTime = async (req, res) => {
  try {
    const body = req.body || {};
    const bookingId = req.params.bookingId || body.bookingId;
    const salonId = req.salon?.salonId || body.salonId;
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 200) : '';

    if (!salonId) {
      return res.status(404).json({ status: 'FAILED', message: 'salonId not found in token' });
    }
    if (!bookingId || bookingId === 'null') {
      return res.status(400).json({ status: 'FAILED', message: 'bookingId required' });
    }

    const booking = await db.Booking.findByPk(bookingId, {
      include: [
        { model: db.User, as: 'user' },
        { model: db.Salon, as: 'salon' },
      ],
    });

    if (!booking) {
      return res.status(404).json({ status: 'FAILED', message: 'Booking not found' });
    }
    if (String(booking.salonId) !== String(salonId)) {
      return res.status(403).json({ status: 'FAILED', message: 'Unauthorized' });
    }

    // The one status check that matters. Everything after this point is a
    // booking that still has an appointment to keep.
    if (FINAL_STATUSES.includes(booking.bookingStatus)) {
      return res.status(400).json({
        status: 'FAILED',
        message: `Booking is already Completed/Cancel you can't update time`,
      });
    }

    const day = toDay(booking.bookingDate);
    const currentTime = booking.bookingTime || booking.originalBookingTime;
    const currentMinutes = toMinutes(currentTime);
    if (!day || currentMinutes === null) {
      return res.status(400).json({ status: 'FAILED', message: 'This booking has no time to change' });
    }

    // ── Resolve the new slot ────────────────────────────────────────────────
    // `time` wins; `offsetMinutes` is there for clients that still count
    // minutes. Either way the result is a wall clock + a day, never a delta
    // stored as data.
    const rawTime = body.time || body.newBookingTime || body.bookingTime;
    const rawOffset = body.offsetMinutes ?? body.delayMinutes;
    const explicitDate = toDay(body.date || body.newBookingDate || body.bookingDate);
    let newMinutes = null;
    let newDay = explicitDate || day;

    if (rawTime !== undefined && rawTime !== null && String(rawTime).trim() !== '') {
      newMinutes = toMinutes(rawTime);
      if (newMinutes === null) {
        return res.status(400).json({ status: 'FAILED', message: 'time must be a time like "18:50" or "18:50:00"' });
      }
    } else if (rawOffset !== undefined && rawOffset !== null && String(rawOffset).trim() !== '') {
      const offset = Number(rawOffset);
      if (!Number.isInteger(offset)) {
        return res.status(400).json({ status: 'FAILED', message: 'offsetMinutes must be a whole number of minutes' });
      }
      newMinutes = currentMinutes + offset;
    } else {
      return res.status(400).json({ status: 'FAILED', message: 'time is required' });
    }

    // Midnight rollover: +40 on a 23:40 booking is tomorrow, -30 on a 00:15 one
    // is yesterday. Without this the day stays put and the time wraps into a
    // slot that reads as twenty-three hours away.
    if (newMinutes < 0) {
      newMinutes += MINUTES_IN_DAY;
      newDay = addDays(newDay, -1);
    } else if (newMinutes >= MINUTES_IN_DAY) {
      newMinutes -= MINUTES_IN_DAY;
      newDay = addDays(newDay, 1);
    }

    // No day sent: a pick more than half a day away from the booking is the
    // *other* side of midnight, not half a day away. A late-night salon picking
    // 00:20 for a 23:40 booking means forty minutes later. A client that states
    // the day has already done this arithmetic, so its day is trusted.
    if (!explicitDate && Math.abs(newMinutes - currentMinutes) > 12 * 60) {
      newDay = addDays(day, newMinutes < currentMinutes ? 1 : -1);
    }

    const newClock = toClock(newMinutes);
    const offsetMinutes = dayShiftMinutes(day, newDay) + newMinutes - currentMinutes;
    if (offsetMinutes === 0) {
      return res.status(400).json({ status: 'FAILED', message: 'That is already the booked time' });
    }
    if (Math.abs(offsetMinutes) > MAX_OFFSET_MINUTES) {
      return res.status(400).json({
        status: 'FAILED',
        message: `A booking can move up to ${MAX_OFFSET_MINUTES / 60} hours — rebook it for a bigger change`,
      });
    }
    if (isPast(newDay, newMinutes)) {
      return res.status(400).json({ status: 'FAILED', message: 'That time has already passed' });
    }

    // ── Write: the booking moves, and the queue row moves with it ───────────
    const t = await db.sequelize.transaction();
    let queue = null;
    try {
      await booking.update(pickColumns(db.Booking, {
        bookingTime: newClock,
        bookingDate: newDay,
        // A leftover proposal from the old confirm-with-the-customer flow is
        // settled here: there is nothing left to answer.
        ...(booking.bookingStatus === 'delay_requested' ? { bookingStatus: 'confirmed' } : {}),
        proposedBookingTime: null,
        proposedBookingDate: null,
        requestedDelayMinutes: 0,
        delayMinutes: 0,
        customerResponse: null,
        expiresAt: null,
      }), { transaction: t });

      queue = await db.Queue.findOne({ where: { bookingId: booking.bookingId }, transaction: t });
      if (queue) {
        await queue.update(pickColumns(db.Queue, { bookingTime: newClock, bookingDate: newDay }), { transaction: t });
      } else if (booking.bookingStatus === 'confirmed' && db.Queue?.create) {
        queue = await db.Queue.create(pickColumns(db.Queue, {
          bookingId: booking.bookingId,
          salonId: booking.salonId,
          userId: booking.userId,
          bookingDate: newDay,
          bookingTime: newClock,
        }), { transaction: t });
      }
      await t.commit();
    } catch (writeError) {
      await t.rollback();
      throw writeError;
    }

    // ── Tell the customer ───────────────────────────────────────────────────
    const salonName = booking.salon?.salonName || 'your salon';
    const fromLabel = formatTo12Hour(currentTime);
    const toLabel = formatTo12Hour(newClock);
    const dayNote = newDay !== day ? ` on ${newDay}` : '';
    // The sign decides the words: an appointment pulled forward must never read
    // like the salon running late.
    const isEarlier = offsetMinutes < 0;
    const title = isEarlier ? 'Earlier time available' : 'Booking time updated';
    const message = `${isEarlier
      ? `${salonName} can take you earlier — please come at ${toLabel}${dayNote} instead of ${fromLabel}.`
      : `${salonName} is running a little late — please come at ${toLabel}${dayNote} instead of ${fromLabel}.`}${
      reason ? ` ${reason}` : ''}`;

    const payload = {
      type: 'BOOKING_TIME_UPDATED',
      bookingId: booking.bookingId,
      bookingRequestId: booking.bookingRequestId || booking.bookingId,
      salonId: booking.salonId,
      userId: booking.userId,
      salonName,
      offsetMinutes,
      direction: isEarlier ? 'EARLIER' : 'LATER',
      bookingTime: newClock,
      bookingDate: newDay,
      newTime: toLabel,
      previousBookingTime: currentTime,
      previousBookingDate: day,
      previousTime: fromLabel,
      reason: reason || '',
      queueNumber: queue?.queueNumber ?? null,
    };

    // Fan out to every active browser/phone token. The legacy account column is
    // included for deployments that have not migrated the DeviceToken table;
    // Map de-duplicates it when it is also present in the table. A dead FCM
    // token is deactivated only for the permanent "not registered" response —
    // a network outage must not erase a device that may recover.
    const notificationResult = await notifyCustomerDevices({
      userId: booking.userId,
      legacyToken: booking.user?.deviceToken,
      title,
      message,
      payload,
    });
    const notified = notificationResult.sent > 0;

    // In-app, for the customer's notification list — which is where a missed
    // push is still read. The salon is not notified of its own change; it has
    // the queue, and an alert for something it just did is only noise.
    await createUniqueNotification({
      receiverType: 'USER',
      receiverId: booking.userId,
      title,
      message,
      type: 'BOOKING_TIME_UPDATED',
      bookingId: booking.bookingId,
      bookingDate: newDay,
      bookingTime: newClock,
    });

    // Live refresh: the customer's My Bookings and the salon's queue reload on
    // these, so both sides show the new time without a manual pull.
    if (req.io) {
      req.io.to(`user_${booking.userId}`).emit('booking_status_updated', {
        ...payload,
        bookingStatus: booking.bookingStatus,
        title,
        message,
      });
      req.io.to(`salon_${booking.salonId}`).emit('queue_updated', {
        ...payload,
        title,
        message: `${booking.user?.userName || 'Customer'} moved to ${toLabel}${dayNote}.`,
      });
    }

    return res.status(200).json({
      status: 'SUCCESS',
      message: notified ? 'Booking time updated and customer notified' : 'Booking time updated',
      data: {
        bookingId: booking.bookingId,
        bookingStatus: booking.bookingStatus,
        bookingDate: newDay,
        bookingTime: newClock,
        previousBookingDate: day,
        previousBookingTime: currentTime,
        newTime: toLabel,
        previousTime: fromLabel,
        offsetMinutes,
        direction: isEarlier ? 'EARLIER' : 'LATER',
        crossesDay: newDay !== day,
        reason: reason || null,
        queueId: queue?.queueId ?? null,
        queueNumber: queue?.queueNumber ?? null,
        notified,
      },
    });
  } catch (err) {
    console.error('Salon Queue Update Time Error:', err);
    return res.status(500).json({ status: 'FAILED', message: err.message });
  }
};

module.exports = salonUpdateBookingTime;
