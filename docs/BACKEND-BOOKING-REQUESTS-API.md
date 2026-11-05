# Backend — booking-request (lead) API + admin/salon reporting

> **Implemented by** `patches/backend-2-booking-request-leads.patch` (real code:
> service, four controllers, routes, the sweeper cron and the model changes).
> Apply instructions: `patches/APPLY-2026-11-05.md`.

Target repo: `rightserveinfotechsystems/my_naai_backend`
Web client already implemented: `src/lib/bookingLeads.js`, `src/components/SalonLeads.jsx`
Migration: `patches/migrations/2026-11-05-booking-requests-categories.sql`

> **Requests and bookings are different tables and different concepts.**
> A **booking request** is a lead: a customer asked for a slot and the salon has
> one minute to answer. A **booking** is the chair that exists after an accept
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
- `expiresAt` is stored on insert (`created_at + 60s`). If it is missing the
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

## 3. Answering a request — unchanged

Accept / Reject still goes through the existing endpoint the notifications
screen uses, so the mobile app, the web tab and the alert card cannot disagree:

```
POST /api/bookingRequest/owner-action/{bookingRequestId}/
{ "action": "ACCEPT" | "REJECT" | "DELAY", "delayMinutes": "20" }
```

Behaviour that matters to the new tab:

- On `ACCEPT`: create the booking, write `booking_id` on the request, set
  `responded_at`, and answer `SUCCESS` **once** (a second Accept must fail with
  a clear "already actioned" message — the client turns that into a closed
  card).
- On `REJECT`: `status = REJECTED`, `responded_at = NOW()`.
- A request past `expires_at` must refuse with
  `"This request has expired and was cancelled automatically"` — the client
  matches `expired` and marks the card auto-cancelled.
- Notify the customer on every outcome (accept / reject / auto-cancel).

## 4. `POST /api/bookingRequest/admin/list` — the admin panel's tab

Same shape as §1 with admin scope, plus the filters the panel needs:

```json
{ "salonId": "", "status": "ALL", "search": "rohit", "page": 1, "limit": 25,
  "fromDate": "", "toDate": "" }
```

Extra per-row fields for the panel: `salonName`, `salonPhone`, `city`,
`responseSeconds` (time from `created_at` to `responded_at`, null while
pending), `bookingId`, and `outcome` (`answered | missed | withdrawn`).

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

## 5. The auto-cancel sweeper

```
UPDATE booking_requests
   SET status = 'AUTO_CANCELLED', responded_at = NOW()
 WHERE status = 'PENDING' AND expires_at < NOW()
RETURNING booking_request_id, salon_id, customer_id;
```

- Run it every 15–30 s (cron, `setInterval`, or a BullMQ repeatable job).
- For each returned row: notify the customer (slot released) and, if the salon
  has notifications on, count it in their "missed" number — never as a rejection.
- Idempotent by construction: the `WHERE status = 'PENDING'` clause means a
  second run finds nothing.
- `expires_at` is written on insert. Do not let a client send it.

## 6. Indexes and the view

```sql
CREATE INDEX idx_booking_requests_salon_status
    ON booking_requests (salon_id, status, created_at DESC);
CREATE INDEX idx_booking_requests_pending_expiry
    ON booking_requests (expires_at) WHERE status = 'PENDING';
```

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

## 7. What the web client does until this ships

`SalonLeadsScreen` calls §1 first. A 404 / "unexpected" answer makes it fall
back to `POST /api/notifications/get-salon-notification-list` and keep only
`type === 'BOOKING_REQUEST'` rows, with a quiet note in the UI. That is why the
tab is useful on today's backend — accept/reject already work there — and why
the fallback disappears by itself the day §1 is deployed.

## 8. Acceptance checks

1. `POST /api/bookingRequest/salon/list` with `status: "ALL"` answers the last
   20 requests for the salon, newest first, with `pagination.totalPages`.
2. A `PENDING` row older than a minute comes back as `AUTO_CANCELLED` (or is
   counted as `autoCancelled` by §2) and **never** as `rejected`.
3. Accepting a request creates exactly one booking row and answers the second
   Accept with `already actioned`.
4. `summarize` numbers add up: `accepted + rejected + autoCancelled +
   cancelledByCustomer + awaiting + delayed === received`.
5. A salon cannot read another salon's requests (403 on a mismatched `salonId`).
