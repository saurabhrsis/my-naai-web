# Admin panel — Booking requests tab

> **Implemented by** `patches/admin-panel-1-booking-requests.patch` (real code:
> `src/pages/BookingRequests.jsx`, the detail drawer, the service, the tab and the
> route). Apply instructions: `patches/APPLY-2026-11-05.md`.

Target repo: `rightserveinfotechsystems/my-naai-frontend` (admin panel)
Backend contract: `docs/BACKEND-BOOKING-REQUESTS-API.md` §4

A new top-level tab beside **Shop Orders**: **Booking requests**.

> **Requests are not bookings.** This tab lists the leads a customer sent and
> what the salon did with them, from `booking_requests`. It must not read
> `booking` / `booking_list` to answer any question here — a booking exists only
> after a salon accepts, and mixing the two is what makes a "conversion rate"
> that adds up to more than 100%.

---

## 1. What the tab is for

The question the admin team actually asks: **are the salons getting leads, and
are they answering them?** So the screen leads with counts and answer rates, and
the list under it is filterable by salon, status and date.

## 2. Layout

```
Booking requests                        [ Today ▾ ]  [ Refresh ]

┌ Received ┐ ┌ Accepted ┐ ┌ Rejected ┐ ┌ Auto-cancelled ┐ ┌ Answer rate ┐
│   320    │ │   251    │ │    34    │ │      35       │ │     89%     │
└──────────┘ └──────────┘ └──────────┘ └───────────────┘ └─────────────┘

[ Salon ▾ ] [ Status ▾ ] [ Date range ]      [ search customer / phone ]

┌──────────────────────────────────────────────────────────────────────┐
│ Rohit Deshmukh · 9876500001        Glow Studio        Awaiting answer │
│ Haircut, Beard trim · ₹450         6 Nov, 18:30                        │
│ sent 0:12 ago · expires in 0:48      [ View ]                         │
├──────────────────────────────────────────────────────────────────────┤
│ Sana Khan · 9876500002             Blush Salon        Accepted        │
│ Hair spa · ₹900                    6 Nov, 12:00      answered in 18s │
├──────────────────────────────────────────────────────────────────────┤
│ Neha Patil · 9876500003            Fade Factory       Auto-cancelled  │
│ Global colour · ₹2,400             6 Nov, 19:00      no answer in 60s │
└──────────────────────────────────────────────────────────────────────┘
```

Tiles (from `POST /api/bookingRequest/admin/summary`):

| Tile | Field | Note |
|---|---|---|
| Received | `received` | every request in the range |
| Accepted | `accepted` | became a booking |
| Rejected | `rejected` | salon said no |
| Auto-cancelled | `autoCancelled` | **nobody answered in 60s** — its own tile, never folded into Rejected |
| Answer rate | `answerRate` | `(accepted + rejected) / received` |

Under the tiles, a **per-salon table** (the report the team asked for):

```
Salon            Received  Accepted  Rejected  Missed  Answer rate  Median reply
Glow Studio          42        38        1        3        93%          22s
Blush Salon          30        12        5       13        57%          51s
Fade Factory         28         3        1       24        14%           —
```

Sortable by *Missed* (default: worst first) — that is the list an account
manager works from.

## 3. The detail drawer

Clicking a request opens it without leaving the tab:

- **Customer**: name, phone (click-to-call), city.
- **Requested**: services with prices, estimated total, date, time, chosen
  barber (or "any").
- **Lifecycle** — the part that makes this tab worth building:
  `sent → (accepted | rejected | auto-cancelled)`, each with a timestamp and the
  seconds it took. An auto-cancel reads **"No answer within 60 seconds — the slot
  was released automatically"**, never "rejected".
- **Booking**: if `bookingId` is set, a link to the booking (the queue record).
  If not, the drawer says the request never became a booking.
- **Salon**: name, phone, current open/closed status.

## 4. Filters and exports

- **Salon** (searchable select), **Status** (`All`, `Awaiting answer`,
  `Accepted`, `Rejected`, `Auto-cancelled`, `Cancelled by customer`, `Delayed`),
  **Date range** (Today / 7 days / 30 days / custom).
- Search matches customer name, phone and salon name.
- **Export CSV** of the filtered list with the same columns as the API, plus
  `responseSeconds`. Operations will ask for this in week one.

## 5. Rules

- **Read-only.** The admin does not accept or reject on a salon's behalf; the
  only write is an internal **note** field on a request (optional in v1).
- Do **not** show a "convert request" button: conversion happens when the salon
  accepts, and a second path would produce two bookings.
- A `PENDING` request older than its window is displayed as **Auto-cancelled**
  even if the sweeper has not written the row yet (the API does the same).
- Timezone: show timestamps in **Asia/Kolkata** everywhere, with the same
  formatter the rest of the panel uses.
- Live updates are a nice-to-have; a 20-second poll of the summary is enough for
  v1 and costs one query.

## 6. Acceptance checks

1. The tab reads only `booking_requests`; a request that was accepted and then
   completed shows as **Accepted** here and links to the booking — the numbers do
   not double count.
2. `Accepted + Rejected + Auto-cancelled + Awaiting + Cancelled by customer =
   Received` for every date range.
3. A request with no answer for 60 seconds appears under **Auto-cancelled** and
   is *not* counted in **Rejected**.
4. The per-salon table sorts by Missed, and the median reply is blank (—) for a
   salon that never answered.
5. Export CSV matches the filtered rows on screen.
6. Times are IST for every viewer.
