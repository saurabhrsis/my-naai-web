// Salon Queue → "Update time": the salon moves the time of a booking it has
// ALREADY ACCEPTED, and the customer confirms the new time.
//
// This is NOT the booking-request flow. The two are deliberately separate:
//
//   booking-request flow  (ownerActionBooking.js)
//     A customer asks for a slot. The booking is `requested`. The salon answers
//     ACCEPT (→ confirmed, a queue row is created), REJECT (→ cancelled) or
//     DELAY (→ delay_requested with a proposed time). Nothing exists in the
//     salon's queue until the salon accepts.
//     POST /api/bookingRequest/owner-action/:bookingId
//
//   salon-queue flow  (this file)
//     The booking is already `confirmed` and sitting in the salon's queue — the
//     customer is coming. The salon is running late, or a chair just freed up
//     early, and it moves that already-agreed time. There is no accept/reject of
//     a request here: the booking is real, only its clock changes.
//     POST /api/booking/salon/queue/update-time/:bookingId
//
// A `requested` booking reaching this endpoint is therefore an error, and the
// response says exactly where it belongs — that guard is the whole reason these
// are two endpoints instead of one `action` switch.
//
// Same shape as its neighbours otherwise: `req.salon.salonId`, one transaction,
// a push + an in-app Notification + the socket emits, the same response body.
//
// Body (all of the first three are optional except that one is required):
//   { "offsetMinutes": 20 }                            // later by 20  (signed)
//   { "offsetMinutes": -15 }                           // earlier by 15
//   { "proposedTime": "17:45" }                        // an exact clock time
//   { "newBookingDate": "2026-09-08" }                 // only when the resolved
//                                                      //  slot crosses midnight
//   { "responseWindowMinutes": 15 }                    // default 15, clamp 1–120
//   { "reason": "Previous cut is running long" }
//
// The web queue screen posts the resolved slot as `newBookingTime` (an
// `HH:mm:ss`) and `newBookingDate`; both are accepted here.
//
// ⚠️ ACCEPT-side contract (their customerDelayAction.js)
// On ACCEPT the proposal has to become the booking's real time — and the queue
// row has to move with it. The controller that answers the customer must do:
//
//   updateData.bookingTime = booking.proposedBookingTime;
//   if (booking.proposedBookingDate) updateData.bookingDate = booking.proposedBookingDate;
//   updateData.expiresAt = null;
//   updateData.proposedBookingTime = null;
//   updateData.customerResponse = 'accepted';
//   // …and then, for a booking that already had a queue row, UPDATE it —
//   // `Queue.create` there would give one customer two numbers in the same
//   // chair. Replace the create block with:
//   const existing = await db.Queue.findOne({ where: { bookingId: booking.bookingId }, transaction: t });
//   if (existing) {
//     await existing.update({ bookingTime: booking.proposedBookingTime, bookingDate: booking.bookingDate }, { transaction: t });
//   } else {
//     /* the existing create block, for the booking-request flow */
//   }
//   // …and move the reminder: deleteReminderTask(booking.reminderTaskName), then
//   // recompute reminderTime for the new slot, or the customer is reminded for a
//   // time they no longer have.

const db = require('../../database/models');
const { formatTo12Hour } = require('../../utils/timeFormat');
const sendNotificationToDevice = require('../../firebase/sendNotification');

// How long the customer has to answer before the proposal stops being live.
const DEFAULT_RESPONSE_WINDOW_MINUTES = 15;
const MIN_RESPONSE_WINDOW_MINUTES = 1;
const MAX_RESPONSE_WINDOW_MINUTES = 120;
// A salon moves a booking by minutes, not by hours; anything larger is a
// mistake (or a bad client) and belongs in a re-booking, not a time change.
const MAX_OFFSET_MINUTES = 240;
const MINUTES_IN_DAY = 24 * 60;

// The queue flow acts on a booking the salon has taken. `delay_requested` is
// included because a salon that is running even later needs to replace the
// proposal it is already waiting on — that is still the queue talking.
const QUEUE_STATUSES = ['confirmed', 'delay_requested'];

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

function toClock(minutes) {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:00`;
}

function toMinutesValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const minutes = Number(value);
  return Number.isFinite(minutes) ? minutes : null;
}

// 'YYYY-MM-DD' or a full ISO timestamp -> 'YYYY-MM-DD'.
function toDay(value) {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

// Whole days between two 'YYYY-MM-DD' values, as minutes — so a signed offset
// stays true when a proposal lands on the next day (23:40 → 00:20 is +40, not
// -1400).
function dayShiftMinutes(fromDay, toDay) {
  const parse = value => {
    const [year, month, dayOfMonth] = String(value).split('-').map(Number);
    return Date.UTC(year, month - 1, dayOfMonth);
  };
  return Math.round((parse(toDay) - parse(fromDay)) / 86400000) * MINUTES_IN_DAY;
}

function addDays(day, days) {
  const [year, month, dayOfMonth] = day.split('-').map(Number);
  const date = new Date(year, month - 1, dayOfMonth);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Today in the SERVER's wall clock. `toISOString()` is UTC, and an Indian salon
// at 00:30 is still on yesterday's UTC date — a DATEONLY column compared against
// that would call today's bookings "past" for five and a half hours every night.
function localDay(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// Only the columns the loaded model actually declares. `proposedBookingTime`,
// `proposedBookingDate`, `delayMinutes`, `originalBookingTime` and `expiresAt`
// are commented out of the Booking model today; writing one anyway makes
// Sequelize throw "Unknown attribute" and the salon sees a 500 for a change that
// is otherwise perfectly valid. Uncomment the columns and the writes land.
function knownColumns(update) {
  const attributes = db.Booking.rawAttributes || {};
  return Object.fromEntries(Object.entries(update).filter(([key]) => Object.prototype.hasOwnProperty.call(attributes, key)));
}

function hasColumn(model, column) {
  return Boolean(model?.rawAttributes && Object.prototype.hasOwnProperty.call(model.rawAttributes, column));
}

const salonUpdateBookingTime = async (req, res) => {
  try {
    const bookingId = req.params.bookingId || req.body.bookingId;
    const salonId = req.salon?.salonId || req.body.salonId;
    const {
      proposedTime = null,
      newBookingTime = null,
      offsetMinutes = null,
      delayMinutes = null,
      newBookingDate = null,
      proposedBookingDate = null,
      reason = '',
      responseWindowMinutes = null,
    } = req.body || {};

    if (!salonId) {
      return res.status(404).json({ status: 'FAILED', message: 'salonId not found in token' });
    }
    if (!bookingId || bookingId === 'null') {
      return res.status(400).json({ status: 'FAILED', message: 'bookingId required' });
    }

    // ── Read and validate BEFORE opening a transaction ──────────────────────
    // The booking-request controllers open a transaction at the top and return
    // early from half a dozen validation branches without rolling it back; each
    // of those holds a pooled connection until the driver times it out.
    const booking = await db.Booking.findByPk(bookingId, {
      include: [
        { model: db.User, as: 'user' },
        { model: db.Salon, as: 'salon' },
      ],
    });

    if (!booking) {
      return res.status(404).json({ status: 'FAILED', message: 'Booking not found' });
    }
    if (booking.salonId !== salonId) {
      return res.status(403).json({ status: 'FAILED', message: 'Unauthorized' });
    }

    // The two-flow guard, spelled out. A request that has not been accepted yet
    // is not a queue entry, and answering it here would skip the accept step —
    // no queue row, no customer confirmation of the booking itself.
    if (booking.bookingStatus === 'requested') {
      return res.status(400).json({
        status: 'FAILED',
        message: 'This booking is still a new request — accept, reject or delay it with the booking-request action API (POST /api/bookingRequest/owner-action/:bookingId). Update time is for bookings already in the queue.',
      });
    }
    if (!QUEUE_STATUSES.includes(booking.bookingStatus)) {
      return res.status(400).json({
        status: 'FAILED',
        message: `This booking is ${booking.bookingStatus} and its time cannot be changed`,
      });
    }

    const day = toDay(booking.bookingDate);
    if (!day) {
      return res.status(400).json({ status: 'FAILED', message: 'This booking has no date to change' });
    }
    if (day < localDay()) {
      return res.status(400).json({ status: 'FAILED', message: 'This booking is in the past' });
    }

    const currentTime = booking.bookingTime || booking.originalBookingTime;
    const currentMinutes = toMinutes(currentTime);
    if (currentMinutes === null) {
      return res.status(400).json({ status: 'FAILED', message: 'This booking has no time to change' });
    }

    // A signed offset (later: positive; earlier: negative) or an exact clock
    // time. The web queue screen sends `newBookingTime` (the resolved slot);
    // `proposedTime` and the older `delayMinutes` name are accepted too.
    const offsetInput = toMinutesValue(offsetMinutes) ?? toMinutesValue(delayMinutes);
    const targetMinutes = toMinutes(proposedTime) ?? toMinutes(newBookingTime);

    let shiftedMinutes = null;
    let dayShift = 0;
    if (offsetInput !== null) {
      if (offsetInput === 0) {
        return res.status(400).json({ status: 'FAILED', message: 'Choose how many minutes to move the booking' });
      }
      if (Math.abs(offsetInput) > MAX_OFFSET_MINUTES) {
        return res.status(400).json({ status: 'FAILED', message: `A time change can be at most ${MAX_OFFSET_MINUTES} minutes` });
      }
      const raw = currentMinutes + Math.trunc(offsetInput);
      dayShift = Math.floor(raw / MINUTES_IN_DAY);
      shiftedMinutes = ((raw % MINUTES_IN_DAY) + MINUTES_IN_DAY) % MINUTES_IN_DAY;
    } else if (targetMinutes !== null) {
      shiftedMinutes = targetMinutes;
    } else {
      return res.status(400).json({ status: 'FAILED', message: 'proposedTime or offsetMinutes required' });
    }

    // The resolved day: what the client sent when it did its own maths, the
    // offset's day shift otherwise.
    const proposedDay = toDay(newBookingDate) || toDay(proposedBookingDate)
      || (dayShift ? addDays(day, dayShift) : day);

    if (proposedDay < localDay()) {
      return res.status(400).json({ status: 'FAILED', message: 'That time is in the past' });
    }
    if (proposedDay === localDay()) {
      const now = new Date();
      if (shiftedMinutes <= now.getHours() * 60 + now.getMinutes()) {
        return res.status(400).json({ status: 'FAILED', message: 'That time has already passed today' });
      }
    }

    const crossesDay = proposedDay !== day;
    // A moved date is a different promise — a different queue group, a different
    // reminder — so it is only stored when the table has somewhere to keep it.
    // Writing tomorrow's 00:20 against today's date would send the customer at
    // the wrong time on the wrong day, which is worse than a clear refusal.
    if (crossesDay && !hasColumn(db.Booking, 'proposedBookingDate')) {
      return res.status(400).json({
        status: 'FAILED',
        message: 'That time is on another day. Add a `proposedBookingDate` column to the Booking model to move a booking across midnight — until then, re-book the customer instead.',
      });
    }

    // The real, signed move in minutes — including the day shift, whichever way
    // the client expressed it (an offset, an exact time, a resolved next-day
    // slot). The sign is the client contract: negative is earlier.
    const signedOffset = (shiftedMinutes + dayShiftMinutes(day, proposedDay)) - currentMinutes;
    const proposedClock = toClock(shiftedMinutes);

    if (!crossesDay && shiftedMinutes === currentMinutes) {
      return res.status(400).json({ status: 'FAILED', message: 'The booking is already at that time' });
    }

    const windowMinutes = Math.min(
      MAX_RESPONSE_WINDOW_MINUTES,
      Math.max(MIN_RESPONSE_WINDOW_MINUTES, Number(responseWindowMinutes) || DEFAULT_RESPONSE_WINDOW_MINUTES),
    );
    const expiresAt = new Date(Date.now() + windowMinutes * 60000);

    // The queue row this booking belongs to. The booking flow creates it on
    // ACCEPT; it is what makes this the queue's own time change, and its number
    // goes back to the screen that asked.
    let queue = null;
    try {
      queue = await db.Queue.findOne({ where: { bookingId: booking.bookingId } });
    } catch (queueError) {
      // A queue table that is not part of this deployment must not block a
      // legitimate time change.
      console.warn('Salon Update Booking Time: queue row lookup failed.', queueError.message);
    }

    // ── The write ───────────────────────────────────────────────────────────
    const t = await db.sequelize.transaction();
    try {
      await booking.update(knownColumns({
        // Still the queue's booking — just not at its old time any more. The
        // customer's answer is what makes the new time real.
        bookingStatus: 'delay_requested',
        ownerAction: 'delayed',
        originalBookingTime: booking.originalBookingTime || currentTime,
        proposedBookingTime: proposedClock,
        proposedBookingDate: crossesDay ? proposedDay : null,
        requestedDelayMinutes: signedOffset,
        delayMinutes: signedOffset,
        expiresAt,
      }), { transaction: t });
      await t.commit();
    } catch (writeError) {
      await t.rollback();
      throw writeError;
    }

    // ── Tell the customer ───────────────────────────────────────────────────
    const salonName = booking.salon?.salonName || 'your salon';
    const fromLabel = formatTo12Hour(currentTime);
    const toLabel = formatTo12Hour(proposedClock);
    const dayNote = crossesDay ? ` on ${proposedDay}` : '';
    // The sign decides the words: a pulled-forward appointment must never read
    // like the salon is running late.
    const isEarlier = signedOffset < 0;
    const title = isEarlier ? 'Earlier time available' : 'Booking time update';
    const message = `${isEarlier
      ? `Good news — ${salonName} can take you earlier, at ${toLabel}${dayNote} instead of ${fromLabel}.`
      : `${salonName} is running a little late — can you come at ${toLabel}${dayNote} instead of ${fromLabel}?`}${
      reason ? ` ${reason}` : ''
    } Please respond within ${windowMinutes} minutes.`;

    const userDeviceToken = booking.user?.deviceToken;
    if (userDeviceToken) {
      // `DELAY_TIME_PROPOSAL` is the type both clients already route to their
      // "new time" screen and answer with `customerDelayResponse`. The value in
      // `bookingRequestId` must be the BOOKING id: the clients deep-link and
      // answer with that field, and the response route resolves it against the
      // Booking table. `source` is how the accept side tells a queue proposal
      // from a first-time request (see the header).
      await sendNotificationToDevice(userDeviceToken, title, message, {
        type: 'DELAY_TIME_PROPOSAL',
        source: 'QUEUE_UPDATE',
        bookingId: booking.bookingId,
        bookingRequestId: booking.bookingId,
        delayMinutes: signedOffset,
        proposedTime: proposedClock,
        proposedDate: crossesDay ? proposedDay : '',
        originalTime: currentTime,
        reason: reason || '',
        queueNumber: queue?.queueNumber ?? null,
        expiresAt: expiresAt.toISOString(),
      });
    }

    await db.Notification.create({
      receiverType: 'USER',
      receiverId: booking.userId,
      title,
      message,
    });

    if (req.io) {
      // The customer's app refreshes on `user_<id>` / `booking_status_updated`;
      // the salon's own queue refreshes on the room its cancel flow uses.
      req.io.to(`user_${booking.userId}`).emit('booking_status_updated', {
        bookingId: booking.bookingId,
        bookingStatus: 'delay_requested',
        proposedBookingTime: proposedClock,
        proposedBookingDate: crossesDay ? proposedDay : null,
        delayMinutes: signedOffset,
        expiresAt: expiresAt.toISOString(),
        message,
      });
      req.io.to(`salon_${booking.salonId}`).emit('queue_updated', {
        title,
        message: `Time change sent to the customer — ${fromLabel} to ${toLabel}${dayNote}.`,
        bookingId: booking.bookingId,
        queueNumber: queue?.queueNumber ?? null,
      });
    }

    // The booking still *is* at its original time until the customer answers —
    // so the queue row is left alone here. It moves when they accept (see the
    // ACCEPT-side contract in the header), which is also where the reminder task
    // has to be cancelled and recomputed for the new slot.

    return res.status(200).json({
      status: 'SUCCESS',
      message: 'Time change sent to the customer for confirmation',
      data: {
        bookingId: booking.bookingId,
        bookingStatus: 'delay_requested',
        bookingTime: currentTime,
        originalBookingTime: booking.originalBookingTime || currentTime,
        proposedBookingTime: proposedClock,
        proposedBookingDate: crossesDay ? proposedDay : null,
        delayMinutes: signedOffset,
        reason: reason || null,
        expiresAt: expiresAt.toISOString(),
        queueId: queue?.queueId ?? null,
        queueNumber: queue?.queueNumber ?? null,
      },
    });
  } catch (err) {
    console.error('Salon Queue Update Time Error:', err);
    return res.status(500).json({ status: 'FAILED', message: err.message });
  }
};

module.exports = salonUpdateBookingTime;
