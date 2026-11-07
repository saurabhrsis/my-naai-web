# Backend — booking-request (lead) API + admin/salon reporting

> **Implemented by** `patches/backend-2-booking-request-leads.patch` (the leads
> API, the four doors, the sweeper and the model changes),
> **`patches/backend-6-booking-request-admin-actions.patch`** (today-by-default
> ranges, filters that filter, per-status counts, and answering on a salon's
> behalf — §§4–5 below) and **`patches/backend-7-five-minute-window.patch`**
> (the five-minute answer window, §7).
> Apply instructions: `patches/README.md`.

Target repo: `rightserveinfotechsystems/my_naai_backend`
Web client already implemented: `src/lib/bookingLeads.js`, `src/components/SalonLeads.jsx`
Migration: `patches/migrations/2026-11-05-booking-requests-categories.sql`

> **Requests and bookings are different tables and different concepts.**
> A **booking request** is a lead: a customer asked for a slot and the salon has
> **five minutes** to answer (`WINDOW_SECONDS = 300` — it was sixty seconds
> until the window was widened, see `patches/backend-7-five-minute-window.patch`). A **booking** is the chair that exists after an accept
> (`booking` / `booking_list`, what the queue and History read). Nothing in this
> document reads one to answer a question about the other, and no endpoint below
> joins them except by the optional `booking_id` pointer written on accept.

Every response uses the house envelope:

```json
{ "status": "SUCCESS", "message": "", "data": { } }
```

Auth: `Authorization: Bearer <salon-token>` for the salon doors, admin token for
the `/admin` doors. `salon_id` in the body must belong to the caller.

---

## 1. `POST /api/bookingRequest/salon/list` — the salon's leads

The page the new **Booking requests** tab reads. Paged, filterable, newest
first.

```json
{
  "salonId": "…",
  "status": "ALL | PENDING | ACCEPTED | REJECTED | AUTO_CANCELLED | CANCELLED | DELAYED",
  "page": 1,
  "limit": 20,
  "fromDate": "2026-11-01",
  "toDate": "2026-11-30"
}
```

```json
{
  "status": "SUCCESS",
  "data": {
    "requests": [
      {
        "bookingRequestId": "req-…",
        "customerName": "Rohit Deshmukh",
        "customerPhone": "9876500001",
        "bookingDate": "2026-11-06",
        "bookingTime": "18:30:00",
        "barberName": "Imran",
        "status": "PENDING",
        "createdAt": "2026-11-05T13:04:00.000Z",
        "expiresAt": "2026-11-05T13:05:00.000Z",
        "respondedAt": null,
        "bookingId": null,
        "services": [
          { "serviceId": "s1", "serviceName": "Haircut", "price": "300.00" }
        ]
      }
    ],
    "pagination": { "page": 1, "limit": 20, "totalPages": 3, "totalRequests": 47 }
  }
}
```

Rules:

- `status: "ALL"` (or absent) returns every request, newest first.
- `totalPages` and `totalRequests` are required — the client pages with them.
- `price` may come back as a string (DECIMAL); the client coerces it.
- `expiresAt` is stored on insert (`created_at + 300s`, i.e. five minutes). If it is missing the
  client derives it from `createdAt`, so an un-migrated row still behaves.
- A `PENDING` row whose `expiresAt` has passed must be reported as
  `AUTO_CANCELLED` **by the server too** (the sweeper in §5 does this); the
  client already refuses to offer Accept after the window closes.

## 2. `POST /api/bookingRequest/salon/summary` — the counters

The tiles the tab leads with. Cheap: one query over the view
`salon_lead_counts`.

```json
{ "salonId": "…", "range": "TODAY | WEEK | MONTH | ALL" }
```

```json
{
  "status": "SUCCESS",
  "data": {
    "received": 47, "awaiting": 2, "accepted": 31, "rejected": 8,
    "autoCancelled": 5, "cancelledByCustomer": 1, "delayed": 0,
    "answered": 39, "answerRate": 83, "lastReceivedAt": "2026-11-05T13:04:00.000Z"
  }
}
```

- `answerRate = round((accepted + rejected) / received * 100)`.
- **`autoCancelled` is not `rejected`.** They are separate numbers on purpose:
  a salon that misses requests has a staffing problem, a salon that rejects them
  has a pricing/capacity answer, and the client shows them in separate tiles.
- A customer's own cancellation (`CANCELLED_BY_CUSTOMER`) is a third bucket. It
  must never be counted as an auto-cancel.

## 3. Answering a request

Accept / Reject goes through the existing endpoint the notifications screen
uses, so the mobile app, the web tab and the alert card cannot disagree:

```
POST /api/bookingRequest/owner-action/{bookingRequestId}
{ "action": "ACCEPT" | "REJECT" | "DELAY", "delayMinutes": 20 }
```

Behaviour that matters to the tabs:

- On `ACCEPT`: create the queue entry and the booking, write `booking_id` on the
  request, set `responded_at`, and answer `SUCCESS` **once** (a second Accept
  fails with a clear "already actioned" message — the client turns that into a
  closed card).
- On `REJECT`: `status = REJECTED`, `responded_at = NOW()`.
- A request past `expires_at` refuses with
  `"This request has expired and was cancelled automatically"` — the client
  matches `expired` and marks the card auto-cancelled.
- Notify the customer on every outcome (accept / reject / auto-cancel).

**One implementation, two doors.** `owner-action` and the admin door (§5) both
call `services/bookingRequestAction.service.js`, which is where the whole answer
lives: the row is locked (`SELECT … FOR UPDATE`) for the transaction, an
already-answered request is refused, a request that carries a `booking_id` never
produces a second booking, and the answer is stamped with its actor. Copying the
accept into a second controller is the one thing that would put two customers in
one chair, so don't.

## 4. `POST /api/bookingRequest/admin/list` — the admin panel's tab

Same shape as §1 with admin scope, plus the filters the panel needs:

```json
{ "range": "TODAY | WEEK | MONTH | ALL", "salonId": "", "status": "ALL",
  "search": "rohit", "page": 1, "limit": 25, "fromDate": "", "toDate": "" }
```

**`range` defaults to `TODAY`** and means today in IST (midnight to midnight),
for every viewer. An explicit `fromDate` / `toDate` wins for that end. This is
the fix for the tab that opened on "Today" and listed every request the platform
had ever taken: the endpoint used to ignore `range` unless a from/to came with
it, and its default was all time. `range` and the dates it resolved to are
echoed back so the panel prints the window it is actually showing:

```json
{ "requests": [ … ], "pagination": { "page": 1, "limit": 25, "totalPages": 2,
    "totalRequests": 38 },
  "statusCounts": { "ALL": 38, "PENDING": 3, "ACCEPTED": 21, "REJECTED": 4,
                    "AUTO_CANCELLED": 8, "CANCELLED": 1, "DELAYED": 1 },
  "filters": { "range": "TODAY", "fromDate": "2026-11-04T18:30:00.000Z",
               "toDate": "2026-11-05T18:30:00.000Z", "status": "ALL",
               "salonId": null, "search": "" } }
```

`statusCounts` is the chip row: counts **for the selected range and salon,
before the status filter**, derived in SQL (`PENDING` past its window counts as
`AUTO_CANCELLED`, exactly as the row does), so the chips add up to `ALL` and
clicking one shows that many rows. It is deliberately not filtered by `search`
— a chip row that shuffles on every keystroke is not a filter.

Filters combine: `status` and `search` are separate `AND` groups. They used to be
flattened into one `OR`, so `AUTO_CANCELLED` + a customer name returned every
auto-cancelled request *or* anybody with that name — i.e. neither filter
filtered.

Extra per-row fields for the panel: `salonName`, `salonPhone`, `city`,
`responseSeconds` (time from `created_at` to `responded_at`, null while
pending), `bookingId`, `outcome` (`answered | missed | withdrawn | open`), and
the audit fields `answeredByRole` (`SALON | ADMIN`), `onBehalfOfSalon`,
`actedAt`, `adminNote`.

`POST /api/bookingRequest/admin/summary` returns §2's counters **plus**:

```json
{ "bySalon": [ { "salonId": "…", "salonName": "Glow Studio", "received": 12,
                 "accepted": 9, "rejected": 1, "autoCancelled": 2,
                 "answerRate": 83, "medianResponseSeconds": 22 } ],
  "platform": { "received": 320, "accepted": 251, "rejected": 34,
                "autoCancelled": 35, "answerRate": 89 } }
```

That is the report the admin team actually asked for: **which salons get leads
and which of them let them die.**

## 5. `POST /api/bookingRequest/admin/action/:bookingRequestId` — answering for a salon

Admin token. The panel's **Accept for salon** / **Decline for salon**.

```json
{ "action": "ACCEPT | REJECT | DELAY", "delayMinutes": 15, "reason": "Salon phone unreachable" }
```

```json
{ "status": "SUCCESS", "message": "Booking request accepted and confirmed",
  "data": { "bookingId": "…", "queueId": "…", "bookingDate": "2026-11-05",
            "bookingTime": "14:30:00", "actedByRole": "ADMIN",
            "onBehalfOfSalon": true } }
```

`reason` is optional for an accept and expected for a reject (max 500 chars). It
is stored on the request and shown to the salon; the **customer is never told an
admin answered** — from their side "the salon" is the service.

The salon the request belongs to is read from the row, never from the body. The
call runs `applyRequestAction` with `actorRole = ADMIN`, so it is the same
transaction as §3 and inherits every guard: row lock, "already actioned", the
five minute window, one booking per request. Failures are answers, not 5xx:

| Case | Answer |
| --- | --- |
| Request already has a booking / an answer | `FAILED`, `"This request was already actioned"`, `data.bookingId` set |
| Past `expires_at` | `FAILED`, `"This request has expired and was cancelled automatically"` (row marked `AUTO_CANCELLED`) |
| Cancelled by the customer | `FAILED`, `"Booking request already cancelled"` |
| Unknown request | 404 `"Booking request not found."` |
| Bad action | 400 `"Invalid action. Allowed values: ACCEPT, REJECT, DELAY"` |

On an accept, the request gains `booking_id` **and** the audit stamp below, the
queue entry is created exactly as a salon accept creates it, and the **salon** is
notified (in-app notification + `booking_request_answered_by_admin` on
`salon_<id>`) so nobody has to guess who moved the chair.

## 6. Who answered — schema

```sql
ALTER TABLE booking_requests
    ADD COLUMN IF NOT EXISTS acted_by_role      VARCHAR(16),   -- 'SALON' | 'ADMIN'
    ADD COLUMN IF NOT EXISTS acted_by_admin_id  VARCHAR(64),
    ADD COLUMN IF NOT EXISTS acted_at           TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS on_behalf_of_salon BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS admin_note         TEXT;
```

Null reads as **the salon answered**, which is what every pre-existing row was.
`migrations/2026-11-05-booking-request-admin-actions.sql` has the same DDL, and
`src/database/config/ensureShopSchema.js` runs it at boot, so a deploy that
forgets the file still works.

## 7. The auto-cancel sweeper

```
UPDATE booking_requests
   SET status = 'AUTO_CANCELLED', responded_at = NOW()
 WHERE status = 'PENDING' AND expires_at < NOW()
RETURNING booking_request_id, salon_id, customer_id;
```

- **The window is five minutes.** `expires_at` is written as
  `created_at + WINDOW_SECONDS` with `WINDOW_SECONDS = 300` in
  `src/services/bookingRequestLead.service.js`; the sweeper cancels whatever is
  still `PENDING` at that timestamp, so the whole flow — the countdown the salon
  sees, the refusal message, the admin panel's read-only footer, the customer's
  "the salon did not respond" — is keyed off the same five minutes. No copy
  anywhere says sixty seconds.
- Run it every 15–30 s (cron, `setInterval`, or a BullMQ repeatable job).
- For each returned row: notify the customer (slot released) and, if the salon
  has notifications on, count it in their "missed" number — never as a rejection.
- Idempotent by construction: the `WHERE status = 'PENDING'` clause means a
  second run finds nothing.
- `expires_at` is written on insert. Do not let a client send it.

## 8. Indexes and the view

```sql
CREATE INDEX idx_booking_requests_salon_status
    ON booking_requests (salon_id, status, created_at DESC);
CREATE INDEX idx_booking_requests_pending_expiry
    ON booking_requests (expires_at) WHERE status = 'PENDING';
-- The admin tab's default view: every salon, today, newest first. The two
-- above cannot serve it because they both lead with salon_id.
CREATE INDEX idx_booking_requests_created_at
    ON booking_requests (created_at DESC);
CREATE INDEX idx_booking_requests_status_created
    ON booking_requests (status, created_at DESC);
```

Paging is `ORDER BY created_at DESC, booking_request_id DESC` — the id is the
tie-break that keeps a page boundary stable when two requests share a timestamp.

```sql
CREATE OR REPLACE VIEW salon_lead_counts AS
SELECT salon_id,
       COUNT(*) AS received,
       COUNT(*) FILTER (WHERE status = 'PENDING')            AS awaiting,
       COUNT(*) FILTER (WHERE status = 'ACCEPTED')           AS accepted,
       COUNT(*) FILTER (WHERE status = 'REJECTED')           AS rejected,
       COUNT(*) FILTER (WHERE status = 'AUTO_CANCELLED')     AS auto_cancelled,
       COUNT(*) FILTER (WHERE status = 'CANCELLED_BY_CUSTOMER') AS cancelled_by_customer,
       COUNT(*) FILTER (WHERE status IN ('ACCEPTED','REJECTED')) AS answered,
       MAX(created_at) AS last_received_at
  FROM booking_requests
 GROUP BY salon_id;
```

## 9. What the web client does until this ships

`SalonLeadsScreen` calls §1 first. A 404 / "unexpected" answer makes it fall
back to `POST /api/notifications/get-salon-notification-list` and keep only
`type === 'BOOKING_REQUEST'` rows, with a quiet note in the UI. That is why the
tab is useful on today's backend — accept/reject already work there — and why
the fallback disappears by itself the day §1 is deployed.

## 10. Acceptance checks

1. `POST /api/bookingRequest/salon/list` with `status: "ALL"` answers the last
   20 requests for the salon, newest first, with `pagination.totalPages`.
2. A `PENDING` row older than a minute comes back as `AUTO_CANCELLED` (or is
   counted as `autoCancelled` by §2) and **never** as `rejected`.
3. Accepting a request creates exactly one booking row and answers the second
   Accept with `already actioned`.
4. `summarize` numbers add up: `accepted + rejected + autoCancelled +
   cancelledByCustomer + awaiting + delayed === received`.
5. `admin/list` with no `range` lists **today's** requests (IST). With
   `range: "ALL"` it lists everything. The two differ on any real database.
6. `admin/list` with `status: "AUTO_CANCELLED"` and `search: "<a name that lives
   on an accepted request>"` returns nothing — the filters AND, they do not OR.
7. `statusCounts` sums to `ALL`, and `ALL` equals `pagination.totalRequests` when
   `status` is `ALL` and `search` is empty.
8. Two accepts racing (admin and salon, same request): exactly one booking row
   exists, the loser gets `already actioned`, and `booking_requests.acted_by_role`
   is not null on the winner.
5. A salon cannot read another salon's requests (403 on a mismatched `salonId`).
