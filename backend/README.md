# Booking time-change API (Express + Mongoose)

Drop-in backend for the **Update appointment time** feature in the My Naai web
portal and mobile app. A salon owner moves an accepted booking later *or*
earlier — by a quick offset or by picking the exact clock time — optionally with
a note, and the customer is notified and asked to confirm.

Nothing here is imported by the web app. These are standalone files meant to be
copied into your Node/Express/Mongoose backend.

---

## Files

| File | What it is |
| --- | --- |
| `models/bookingRequest.model.js` | The fields this feature reads and writes. Merge into your existing schema — do not replace it. |
| `lib/bookingClock.js` | Wall-clock date/time maths. Pure functions, no DB, no timezone traps. |
| `lib/notifyCustomer.js` | Builds and sends the FCM message. Swap in your own sender if you already have one. |
| `controllers/bookingTimeChange.controller.js` | The two request handlers. |
| `routes/bookingRequest.routes.js` | Route wiring. |
| `tests/bookingClock.test.js` | Tests for the maths (`node --test backend/tests/*.test.js`). |

## Wiring it up

```js
// app.js
const bookingRequestRoutes = require('./routes/bookingRequest.routes');
app.use('/api/bookingRequest', bookingRequestRoutes);
```

The routes expect two middlewares you almost certainly already have:

```js
const { requireAuth } = require('../middleware/auth');       // sets req.user = { _id, role }
```

Adjust the import paths at the top of each file to match your tree.

---

## Endpoints

### `POST /api/bookingRequest/owner-action/:bookingRequestId/`

The existing owner-action endpoint. This code adds the `DELAY` branch; keep your
`ACCEPT` / `REJECT` branches as they are.

**Auth:** salon owner Bearer token. The handler verifies the booking belongs to
the caller's salon.

**Body — quick offset** (what the chips send):

```json
{ "action": "DELAY", "delayMinutes": "20", "reason": "Previous cut running long" }
```

**Body — exact time** (what the time picker sends):

```json
{
  "action": "DELAY",
  "delayMinutes": "45",
  "newBookingDate": "2026-09-07",
  "newBookingTime": "19:15:00",
  "proposedTime": "07:15 pm",
  "reason": "Chair frees up at quarter past"
}
```

`delayMinutes` is **signed**: positive = later, negative = earlier. `-15` means
the salon can see the customer fifteen minutes sooner.

**Precedence:** if `newBookingTime` is present the server treats it as the
source of truth and recomputes `delayMinutes` from it. `proposedTime` is a
display string only — it is never trusted or stored as data. The client's
arithmetic is never taken at face value.

**Success `200`:**

```json
{
  "status": "SUCCESS",
  "message": "Customer notified about the new time.",
  "data": {
    "bookingRequestId": "…",
    "delayMinutes": 45,
    "direction": "LATER",
    "previousBookingDate": "2026-09-07",
    "previousBookingTime": "18:30:00",
    "proposedBookingDate": "2026-09-07",
    "proposedBookingTime": "19:15:00",
    "proposedTimeLabel": "07:15 pm",
    "reason": "Chair frees up at quarter past",
    "timeChangeStatus": "PENDING",
    "notified": true
  }
}
```

**Failures** — all `{ "status": "FAILURE", "message": "…" }`:

| Code | When |
| --- | --- |
| `400` | `delayMinutes` missing/zero/not a whole number, out of the −120…+240 range, malformed `newBookingDate`/`newBookingTime`, or the new time is in the past |
| `401` | no/invalid token |
| `403` | the booking does not belong to the caller's salon |
| `404` | no such booking request |
| `409` | the booking is not in a state that can be moved (already completed, cancelled, rejected) |

The `409` matters: without it a salon can "delay" a booking the customer already
walked out of, and the customer gets a notification about an appointment that no
longer exists.

### `POST /api/bookingRequest/customer-delay-response/:bookingRequestId/`

Unchanged contract, but it now applies the stored proposal.

**Body:** `{ "action": "ACCEPT" }` or `{ "action": "REJECT" }`

On `ACCEPT` the proposed date/time is written onto the booking and
`timeChangeStatus` becomes `ACCEPTED`. On `REJECT` the original time stands and
the status becomes `REJECTED`. Either way the salon owner is notified. Responding
twice returns `409` rather than moving the booking a second time.

---

## Notification payload

The FCM `data` block is all strings, because FCM coerces everything to strings
and the mobile handler reads them raw:

```js
{
  type: 'BOOKING_TIME_CHANGE',
  bookingRequestId: '…',
  bookingId: '…',
  delayMinutes: '-15',        // signed, as a string
  direction: 'EARLIER',
  proposedTime: '06:15 pm',
  proposedBookingDate: '2026-09-07',
  proposedBookingTime: '18:15:00',
  reason: 'Chair is free now',
  salonName: '…'
}
```

The **copy is direction-aware**, which is the point of the signed value:

| Direction | Title | Body |
| --- | --- | --- |
| Later | `Your appointment is running late` | `Sharp Cuts needs 15 more minutes. New time: 06:45 pm. Can you still make it?` |
| Earlier | `Earlier time available` | `Sharp Cuts can see you 15 minutes earlier, at 06:15 pm. Can you make it?` |

Telling a customer their slot has been "delayed by -15 minutes" is the exact bug
this replaces.

---

## Schema additions

```js
proposedBookingDate: String,       // 'YYYY-MM-DD'
proposedBookingTime: String,       // 'HH:mm:ss'
delayMinutes:        Number,       // signed
timeChangeReason:    String,
timeChangeStatus:    String,       // NONE | PENDING | ACCEPTED | REJECTED
timeChangeRequestedAt: Date,
timeChangeRespondedAt: Date,
timeChangeHistory:   [ … ],        // audit trail, newest last
```

`timeChangeHistory` exists so a disputed "but you told me seven o'clock" has an
answer. It records every proposal and every response with timestamps.

## A note on time zones

All booking times are stored and compared as **wall-clock strings**
(`'2026-09-07'`, `'19:15:00'`) — never as UTC `Date` objects. A 7:15 pm haircut
is 7:15 pm in the salon regardless of where the server runs. `lib/bookingClock.js`
does the arithmetic on those strings and only builds a `Date` for the
past-time check, using `SALON_TIME_ZONE` (default `Asia/Kolkata`, override with
the env var). If you deploy in a single region you can ignore this entirely; it
is here so a UTC container does not reject valid evening bookings as "in the
past".
