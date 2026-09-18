// Tests for the Salon Queue "Update time" controller.
//
// This is the QUEUE flow: a booking the salon has already accepted moves its
// time. A first-time booking *request* is the other flow (ownerActionBooking /
// the owner-action endpoint) and must never be actioned here — that separation
// is the most important thing in this file.
//
// The controller imports the real backend's models, Firebase sender and time
// formatter, so those three requires are intercepted and replaced with fakes
// before it loads. Everything else — the validation, the maths, the guards, the
// payload the customer's app reads — is the real code.
//
//   node --test backend/tests/*.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const COLUMNS = [
  'bookingStatus', 'ownerAction', 'originalBookingTime', 'proposedBookingTime',
  'proposedBookingDate', 'requestedDelayMinutes', 'delayMinutes', 'expiresAt',
  'bookingTime', 'bookingDate',
];
// The columns their Booking model currently has commented out.
const OPTIONAL_COLUMNS = ['proposedBookingTime', 'proposedBookingDate', 'delayMinutes', 'originalBookingTime', 'expiresAt'];

const pad = value => String(value).padStart(2, '0');
const dayFromNow = days => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
const localToday = () => dayFromNow(0);

function makeHarness({ booking = {}, missingColumns = [], failUpdate = false, queue = { queueId: 'q-1', queueNumber: 7 } } = {}) {
  const pushes = [];
  const notifications = [];
  const emitted = [];
  let transactions = 0;

  const attributes = {};
  COLUMNS.forEach(column => { attributes[column] = { field: column }; });
  missingColumns.forEach(column => { delete attributes[column]; });

  const record = {
    bookingId: 'bk-1',
    bookingStatus: 'confirmed',
    bookingDate: dayFromNow(1),
    bookingTime: '18:30:00',
    salonId: 'salon-1',
    userId: 'user-1',
    bookingRequestId: 'req-1',
    user: { deviceToken: 'user-token-1' },
    salon: { salonName: 'Glow Studio' },
    update: async (values) => {
      if (failUpdate) throw new Error('deadlock');
      Object.assign(record, values);
    },
    ...booking,
  };

  const db = {
    Booking: { findByPk: async () => (record.bookingId === null ? null : record), rawAttributes: attributes },
    Queue: { findOne: async () => queue },
    Notification: { create: async row => { notifications.push(row); return row; } },
    sequelize: {
      transaction: async () => {
        transactions += 1;
        let open = true;
        return {
          commit: async () => { open = false; },
          rollback: async () => {
            if (!open) throw new Error('rollback after commit');
            open = false;
          },
        };
      },
    },
    User: {}, Salon: {},
  };

  const io = {
    to: room => ({ emit: (event, payload) => emitted.push({ room, event, payload }) }),
  };

  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === '../../database/models') return db;
    if (request === '../../firebase/sendNotification') return async (...args) => { pushes.push(args); };
    if (request === '../../utils/timeFormat') return { formatTo12Hour: value => String(value || '') };
    return originalLoad.call(this, request, parent, isMain);
  };

  const controllerPath = require.resolve('../controllers/booking/salonUpdateBookingTime.js');
  delete require.cache[controllerPath];
  const controller = require(controllerPath);
  Module._load = originalLoad;

  const call = async ({ body = {}, params = { bookingId: 'bk-1' }, salonId = 'salon-1' } = {}) => {
    let statusCode = 0;
    let payload = null;
    const res = {
      status(code) { statusCode = code; return this; },
      json(value) { payload = value; return this; },
    };
    await controller({ params, body, salon: { salonId }, io }, res);
    return { statusCode, payload };
  };

  return { call, record, pushes, notifications, emitted, transactionCount: () => transactions };
}

test('the queue flow: a later time reopens the confirmed booking and asks the customer', async () => {
  const harness = makeHarness();
  const { statusCode, payload } = await harness.call({ body: { offsetMinutes: 20 } });

  assert.equal(statusCode, 200);
  assert.equal(payload.status, 'SUCCESS');
  assert.equal(harness.record.bookingStatus, 'delay_requested');
  assert.equal(harness.record.ownerAction, 'delayed');
  assert.equal(harness.record.originalBookingTime, '18:30:00');
  assert.equal(harness.record.proposedBookingTime, '18:50:00');
  assert.equal(harness.record.delayMinutes, 20);
  assert.ok(harness.record.expiresAt instanceof Date);
  // The queue row answers the screen that asked; its time is untouched until
  // the customer agrees to the new one.
  assert.equal(payload.data.queueNumber, 7);
  assert.equal(payload.data.queueId, 'q-1');
  assert.equal(payload.data.bookingTime, '18:30:00');
  assert.equal(payload.data.proposedBookingTime, '18:50:00');
  assert.equal(payload.data.delayMinutes, 20);

  const [token, title, message, data] = harness.pushes[0];
  assert.equal(token, 'user-token-1');
  assert.equal(data.type, 'DELAY_TIME_PROPOSAL');
  assert.equal(data.source, 'QUEUE_UPDATE');
  assert.equal(data.bookingId, 'bk-1');
  // The value the customer's app answers with has to resolve against Booking.
  assert.equal(data.bookingRequestId, 'bk-1');
  assert.equal(data.delayMinutes, 20);
  assert.equal(data.proposedTime, '18:50:00');
  assert.equal(data.queueNumber, 7);
  assert.match(message, /running a little late/);
  assert.match(message, /within 15 minutes/);
  assert.match(String(title), /time/i);

  assert.equal(harness.notifications.length, 1);
  assert.equal(harness.notifications[0].receiverType, 'USER');
  assert.equal(harness.notifications[0].receiverId, 'user-1');
  assert.equal(harness.emitted.filter(entry => entry.room === 'user_user-1').length, 1);
  assert.equal(harness.emitted.find(entry => entry.room === 'salon_salon-1').event, 'queue_updated');
});

test('the queue flow: an earlier slot stays negative and never reads as "running late"', async () => {
  const harness = makeHarness();
  await harness.call({ body: { offsetMinutes: -15, reason: 'Chair freed up' } });

  assert.equal(harness.record.proposedBookingTime, '18:15:00');
  assert.equal(harness.record.delayMinutes, -15);
  const [token, title, message, data] = harness.pushes[0];
  void token;
  assert.equal(data.delayMinutes, -15);
  assert.match(data.reason, /Chair freed up/);
  assert.match(message, /Good news|earlier/);
  assert.match(String(title), /Earlier/);
});

test('an exact clock time is accepted, and the client\'s resolved slot too', async () => {
  const exact = makeHarness();
  const { payload } = await exact.call({ body: { proposedTime: '17:45' } });
  assert.equal(exact.record.proposedBookingTime, '17:45:00');
  assert.equal(payload.data.delayMinutes, -45);

  // What the web queue screen actually posts.
  const resolved = makeHarness();
  const result = await resolved.call({ body: { offsetMinutes: 20, proposedTime: '6:50 PM', newBookingTime: '18:50:00', newBookingDate: dayFromNow(1) } });
  assert.equal(result.statusCode, 200);
  assert.equal(resolved.record.proposedBookingTime, '18:50:00');
  assert.equal(result.payload.data.proposedBookingTime, '18:50:00');
});

test('a booking request that has not been accepted yet is refused, and pointed at the other API', async () => {
  // The whole reason these are two endpoints: accepting, rejecting or delaying a
  // new request is owner-action's job, and doing it here would skip the accept
  // step — no queue row, no confirmation of the booking itself.
  const harness = makeHarness({ booking: { bookingStatus: 'requested' } });
  const { statusCode, payload } = await harness.call({ body: { offsetMinutes: 20 } });

  assert.equal(statusCode, 400);
  assert.match(payload.message, /owner-action/);
  assert.match(payload.message, /new request/i);
  assert.equal(harness.transactionCount(), 0);
  assert.equal(harness.pushes.length, 0);
});

test('a proposal can be replaced while the customer is still deciding', async () => {
  const harness = makeHarness({ booking: { bookingStatus: 'delay_requested', proposedBookingTime: '18:50:00' } });
  const { statusCode, payload } = await harness.call({ body: { offsetMinutes: 40 } });

  assert.equal(statusCode, 200);
  assert.equal(payload.data.proposedBookingTime, '19:10:00');
  assert.equal(harness.pushes.length, 1);
});

test('a time that crosses midnight needs a proposedBookingDate column, and is stored when it has one', async () => {
  const refused = makeHarness({
    booking: { bookingTime: '23:40:00' },
    missingColumns: ['proposedBookingDate'],
  });
  const blocked = await refused.call({ body: { offsetMinutes: 40 } });
  assert.equal(blocked.statusCode, 400);
  assert.match(blocked.payload.message, /another day/);
  assert.match(blocked.payload.message, /proposedBookingDate/);
  assert.equal(refused.pushes.length, 0);

  const allowed = makeHarness({ booking: { bookingTime: '23:40:00' } });
  const { statusCode, payload } = await allowed.call({ body: { offsetMinutes: 40 } });
  assert.equal(statusCode, 200);
  assert.equal(allowed.record.proposedBookingTime, '00:20:00');
  assert.equal(allowed.record.proposedBookingDate, dayFromNow(2));
  assert.equal(payload.data.proposedBookingDate, dayFromNow(2));
});

test('a client-resolved next-day slot is honoured when the column exists', async () => {
  const harness = makeHarness({ booking: { bookingTime: '23:40:00' } });
  const { statusCode, payload } = await harness.call({
    body: { offsetMinutes: 40, newBookingDate: dayFromNow(2), newBookingTime: '00:20:00' },
  });
  assert.equal(statusCode, 200);
  assert.equal(payload.data.proposedBookingDate, dayFromNow(2));
  assert.equal(harness.pushes[0][3].proposedDate, dayFromNow(2));
  // +40, not -1400: the sign has to describe the move, not just the clock face.
  assert.equal(payload.data.delayMinutes, 40);
});

test('an exact next-day slot without an offset still reports the true signed move', async () => {
  const harness = makeHarness({ booking: { bookingTime: '09:00:00' } });
  const { statusCode, payload } = await harness.call({ body: { newBookingDate: dayFromNow(2), newBookingTime: '08:30:00' } });

  assert.equal(statusCode, 200);
  assert.equal(payload.data.proposedBookingTime, '08:30:00');
  // 09:00 tomorrow → 08:30 the day after is 23 h 30 m LATER, and the sign has to
  // say so: the customer's screen reads it to decide "earlier" vs "running late".
  assert.equal(payload.data.delayMinutes, 1410);
  assert.match(harness.pushes[0][2], /running a little late/);
  assert.equal(harness.pushes[0][3].delayMinutes, 1410);
});

test('refuses a booking whose day has already gone', async () => {
  const harness = makeHarness({ booking: { bookingDate: '2020-01-05' } });
  const { statusCode, payload } = await harness.call({ body: { offsetMinutes: 15 } });
  assert.equal(statusCode, 400);
  assert.match(payload.message, /in the past/);
});

test('refuses a same-day time that has already passed', async () => {
  const now = new Date();
  if (now.getHours() === 0 && now.getMinutes() < 2) return;
  const passedMinutes = now.getHours() * 60 + now.getMinutes() - 5;
  const passed = `${pad(Math.floor(passedMinutes / 60))}:${pad(passedMinutes % 60)}`;

  const harness = makeHarness({ booking: { bookingDate: localToday(), bookingTime: '23:55:00' } });
  const { statusCode, payload } = await harness.call({ body: { proposedTime: passed } });
  assert.equal(statusCode, 400);
  assert.match(payload.message, /already passed today/);
});

test('a booking already at that time, an absurd offset, and a missing time are all refused', async () => {
  const same = makeHarness();
  assert.match((await same.call({ body: { proposedTime: '18:30' } })).payload.message, /already at that time/);

  const absurd = makeHarness({ booking: { bookingTime: '09:00:00' } });
  assert.match((await absurd.call({ body: { offsetMinutes: 600 } })).payload.message, /at most 240 minutes/);

  const empty = makeHarness();
  assert.match((await empty.call({ body: { reason: 'late' } })).payload.message, /proposedTime or offsetMinutes required/);

  const zero = makeHarness();
  assert.match((await zero.call({ body: { offsetMinutes: 0 } })).payload.message, /how many minutes/);
});

test('a booking of another salon is unauthorized, and nothing is written', async () => {
  const harness = makeHarness({ booking: { salonId: 'salon-9' } });
  const { statusCode } = await harness.call({ body: { offsetMinutes: 15 } });
  assert.equal(statusCode, 403);
  assert.equal(harness.transactionCount(), 0);
  assert.equal(harness.pushes.length, 0);
});

test('cancelled and completed bookings cannot be re-timed', async () => {
  for (const status of ['cancelled', 'completed']) {
    const harness = makeHarness({ booking: { bookingStatus: status } });
    const { statusCode, payload } = await harness.call({ body: { offsetMinutes: 15 } });
    assert.equal(statusCode, 400);
    assert.match(payload.message, new RegExp(status));
  }
});

test('an unknown booking is a 404, a missing salonId is a 404, a missing id is a 400', async () => {
  assert.equal((await makeHarness({ booking: { bookingId: null } }).call({ body: { offsetMinutes: 15 } })).statusCode, 404);
  assert.equal((await makeHarness().call({ body: { offsetMinutes: 15 }, salonId: '' })).statusCode, 404);
  assert.equal((await makeHarness().call({ params: {}, body: {} })).statusCode, 400);
});

test('a response window can be chosen, and is clamped to something sane', async () => {
  const shorter = makeHarness();
  await shorter.call({ body: { offsetMinutes: 10, responseWindowMinutes: 5 } });
  assert.match(shorter.pushes[0][2], /within 5 minutes/);

  const silly = makeHarness();
  await silly.call({ body: { offsetMinutes: 10, responseWindowMinutes: 9999 } });
  assert.match(silly.pushes[0][2], /within 120 minutes/);
});

test('a customer with no device token still gets the in-app notification', async () => {
  const harness = makeHarness({ booking: { user: { deviceToken: null } } });
  const { statusCode } = await harness.call({ body: { offsetMinutes: 15 } });
  assert.equal(statusCode, 200);
  assert.equal(harness.pushes.length, 0);
  assert.equal(harness.notifications.length, 1);
});

test('columns the model does not declare are skipped instead of throwing', async () => {
  // Everything the proposal wants to record is commented out of their model
  // today; the change still has to go through to the customer.
  const harness = makeHarness({ missingColumns: OPTIONAL_COLUMNS });
  const { statusCode, payload } = await harness.call({ body: { offsetMinutes: 15 } });

  assert.equal(statusCode, 200);
  assert.equal(harness.record.bookingStatus, 'delay_requested');
  assert.equal(harness.record.proposedBookingTime, undefined);
  assert.equal(payload.data.proposedBookingTime, '18:45:00');
  assert.equal(harness.pushes.length, 1);
});

test('a missing queue row does not block a legitimate time change', async () => {
  const harness = makeHarness({ queue: null });
  const { statusCode, payload } = await harness.call({ body: { offsetMinutes: 15 } });
  assert.equal(statusCode, 200);
  assert.equal(payload.data.queueNumber, null);
  assert.equal(harness.pushes[0][3].queueNumber, null);
});

test('a failed write rolls the transaction back and reports it', async () => {
  const harness = makeHarness({ failUpdate: true });
  const { statusCode, payload } = await harness.call({ body: { offsetMinutes: 15 } });
  assert.equal(statusCode, 500);
  assert.match(payload.message, /deadlock/);
  assert.equal(harness.pushes.length, 0);
});
