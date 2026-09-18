// Tests for the salon "send updated time" controller.
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
  'requestedDelayMinutes', 'delayMinutes', 'expiresAt', 'bookingTime', 'bookingDate',
];

function makeHarness({ booking = {}, includeExpiresAt = true, failUpdate = false } = {}) {
  const pushes = [];
  const notifications = [];
  const emitted = [];
  let transactions = 0;

  const attributes = {};
  COLUMNS.forEach(column => { attributes[column] = { field: column }; });
  if (!includeExpiresAt) delete attributes.expiresAt;

  const record = {
    bookingId: 'bk-1',
    bookingStatus: 'confirmed',
    bookingDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    bookingTime: '18:30:00',
    salonId: 'salon-1',
    userId: 'user-1',
    bookingRequestId: 'req-1',
    // The two associations the controller includes and reads from.
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
    if (request === '../../firebase/sendNotification') {
      return async (...args) => { pushes.push(args); };
    }
    if (request === '../../utils/timeFormat') {
      return { formatTo12Hour: value => String(value || '') };
    }
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

  return { call, record, pushes, notifications, emitted, db, attributes, transactionCount: () => transactions };
}

test('a later proposal writes delay_requested and tells the customer, signed', async () => {
  const harness = makeHarness();
  const { statusCode, payload } = await harness.call({ body: { offsetMinutes: 30 } });

  assert.equal(statusCode, 200);
  assert.equal(payload.status, 'SUCCESS');
  assert.equal(harness.record.bookingStatus, 'delay_requested');
  assert.equal(harness.record.ownerAction, 'delayed');
  assert.equal(harness.record.originalBookingTime, '18:30:00');
  assert.equal(harness.record.proposedBookingTime, '19:00:00');
  assert.equal(harness.record.requestedDelayMinutes, 30);
  assert.equal(harness.record.delayMinutes, 30);
  assert.equal(payload.data.proposedBookingTime, '19:00:00');
  assert.equal(payload.data.delayMinutes, 30);
  assert.ok(payload.data.expiresAt);

  // The push the customer's app routes on.
  assert.equal(harness.pushes.length, 1);
  const [token, title, message, data] = harness.pushes[0];
  assert.equal(token, 'user-token-1');
  assert.equal(data.type, 'DELAY_TIME_PROPOSAL');
  assert.equal(data.bookingId, 'bk-1');
  assert.equal(data.bookingRequestId, 'req-1');
  assert.equal(data.delayMinutes, 30);
  assert.equal(data.proposedTime, '19:00:00');
  assert.match(message, /respond within 15 minutes/);
  assert.match(String(title), /time/i);

  assert.equal(harness.notifications.length, 1);
  assert.deepEqual(harness.notifications[0].receiverType, 'USER');
  assert.equal(harness.notifications[0].receiverId, 'user-1');
  assert.equal(harness.emitted.filter(entry => entry.room === 'user_user-1').length, 1);
  assert.equal(harness.emitted.find(entry => entry.room === 'salon_salon-1').event, 'queue_updated');
});

test('an earlier slot stays negative all the way to the app', async () => {
  const harness = makeHarness();
  await harness.call({ body: { offsetMinutes: -15, reason: 'Chair freed up' } });

  assert.equal(harness.record.proposedBookingTime, '18:15:00');
  assert.equal(harness.record.delayMinutes, -15);
  const [, , message, data] = harness.pushes[0];
  assert.equal(data.delayMinutes, -15);
  assert.match(data.reason, /Chair freed up/);
  // Earlier means "earlier", never "running late" — the client reads the sign.
  assert.match(message, /Earlier|earlier/);
});

test('an exact clock time is accepted and converted to a signed offset', async () => {
  const harness = makeHarness();
  const { payload } = await harness.call({ body: { proposedTime: '17:45' } });

  assert.equal(harness.record.proposedBookingTime, '17:45:00');
  assert.equal(payload.data.delayMinutes, -45);
  assert.equal(harness.pushes[0][3].proposedTime, '17:45:00');
});

test('the web client\'s "delayMinutes" name works as the offset', async () => {
  const harness = makeHarness();
  const { statusCode, payload } = await harness.call({ body: { delayMinutes: 20 } });
  assert.equal(statusCode, 200);
  assert.equal(payload.data.proposedBookingTime, '18:50:00');
  assert.equal(payload.data.delayMinutes, 20);
});

test('a response window can be chosen, and is clamped to something sane', async () => {
  const shorter = makeHarness();
  await shorter.call({ body: { offsetMinutes: 10, responseWindowMinutes: 5 } });
  assert.match(shorter.pushes[0][2], /within 5 minutes/);

  const silly = makeHarness();
  await silly.call({ body: { offsetMinutes: 10, responseWindowMinutes: 9999 } });
  assert.match(silly.pushes[0][2], /within 120 minutes/);
});

test('a proposal that would cross midnight is refused, not silently moved', async () => {
  const harness = makeHarness({ booking: { bookingTime: '23:40:00' } });
  const { statusCode, payload } = await harness.call({ body: { offsetMinutes: 40 } });

  assert.equal(statusCode, 400);
  assert.match(payload.message, /another day/);
  assert.equal(harness.record.bookingStatus, 'confirmed');
  assert.equal(harness.pushes.length, 0);
  assert.equal(harness.transactionCount(), 0);
});

test('refuses a proposal for a day that has already gone', async () => {
  const harness = makeHarness({ booking: { bookingDate: '2020-01-05' } });
  const { statusCode, payload } = await harness.call({ body: { offsetMinutes: 15 } });
  assert.equal(statusCode, 400);
  assert.match(payload.message, /in the past/);
});

test('refuses a same-day time that has already passed', async () => {
  const now = new Date();
  if (now.getHours() === 0 && now.getMinutes() < 2) return; // the one window a day where "earlier today" does not exist
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const passedMinutes = now.getHours() * 60 + now.getMinutes() - 5;
  const passed = `${String(Math.floor(passedMinutes / 60)).padStart(2, '0')}:${String(passedMinutes % 60).padStart(2, '0')}`;

  const harness = makeHarness({ booking: { bookingDate: today, bookingTime: '23:55:00' } });
  const { statusCode, payload } = await harness.call({ body: { proposedTime: passed } });
  assert.equal(statusCode, 400);
  assert.match(payload.message, /already passed today/);
});

test('a booking that is already at that time is refused', async () => {
  const harness = makeHarness();
  const { statusCode, payload } = await harness.call({ body: { proposedTime: '18:30' } });
  assert.equal(statusCode, 400);
  assert.match(payload.message, /already at that time/);
});

test('an absurd offset is refused', async () => {
  const harness = makeHarness({ booking: { bookingTime: '09:00:00' } });
  const { statusCode, payload } = await harness.call({ body: { offsetMinutes: 600 } });
  assert.equal(statusCode, 400);
  assert.match(payload.message, /at most 240 minutes/);
});

test('a booking of another salon is unauthorized, and nothing is written', async () => {
  const harness = makeHarness({ booking: { salonId: 'salon-9' } });
  const { statusCode, payload } = await harness.call({ body: { offsetMinutes: 15 } });
  assert.equal(statusCode, 403);
  assert.equal(payload.status, 'FAILED');
  assert.equal(harness.transactionCount(), 0);
  assert.equal(harness.pushes.length, 0);
});

test('a cancelled or completed booking cannot be re-timed', async () => {
  for (const status of ['cancelled', 'completed']) {
    const harness = makeHarness({ booking: { bookingStatus: status } });
    const { statusCode, payload } = await harness.call({ body: { offsetMinutes: 15 } });
    assert.equal(statusCode, 400);
    assert.match(payload.message, new RegExp(status));
  }
});

test('an unknown booking is a 404, a missing salonId is a 404, a missing id is a 400', async () => {
  const missing = makeHarness({ booking: { bookingId: null } });
  assert.equal((await missing.call({ body: { offsetMinutes: 15 } })).statusCode, 404);

  const noSalon = makeHarness();
  assert.equal((await noSalon.call({ body: { offsetMinutes: 15 }, salonId: '' })).statusCode, 404);

  const noId = makeHarness();
  assert.equal((await noId.call({ params: {}, body: {} })).statusCode, 400);
});

test('no time and no offset is a 400 — not a booking moved to nowhere', async () => {
  const harness = makeHarness();
  const { statusCode, payload } = await harness.call({ body: { reason: 'running late' } });
  assert.equal(statusCode, 400);
  assert.match(payload.message, /proposedTime or offsetMinutes required/);
});

test('a customer with no device token still gets the in-app notification', async () => {
  const harness = makeHarness({ booking: { user: { deviceToken: null } } });
  const { statusCode } = await harness.call({ body: { offsetMinutes: 15 } });
  assert.equal(statusCode, 200);
  assert.equal(harness.pushes.length, 0);
  assert.equal(harness.notifications.length, 1);
});

test('columns the model does not declare are skipped instead of throwing', async () => {
  // `expiresAt` is commented out of the Booking model today; writing it anyway
  // would make Sequelize throw "Unknown attribute" and the salon would see a
  // 500 for a change that is otherwise valid.
  const harness = makeHarness({ includeExpiresAt: false });
  const { statusCode, payload } = await harness.call({ body: { offsetMinutes: 15 } });
  assert.equal(statusCode, 200);
  assert.equal(harness.record.expiresAt, undefined);
  assert.ok(payload.data.expiresAt);
});

test('a failed write rolls the transaction back and reports it', async () => {
  const harness = makeHarness({ failUpdate: true });
  const { statusCode, payload } = await harness.call({ body: { offsetMinutes: 15 } });
  assert.equal(statusCode, 500);
  assert.match(payload.message, /deadlock/);
  assert.equal(harness.pushes.length, 0);
});
