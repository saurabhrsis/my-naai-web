# Live booking requests — salon, admin and the customer's own tab

*Owner's ask (one message, four parts):*

> 1. "Button labels are too big and spill outside the buttons — 'Save and
>    continue to payment' etc. On mobile they are not looking good. Check the
>    website panel and the admin panel, all of it."
> 2. "Remove the subtitles in the admin panel" — e.g. *"Customer enquiries, salon
>    answers and missed leads. Opens on today (IST); every filter narrows the
>    list."* — "especially on mobile devices."
> 3. "Add the socket for Booking request: when a customer applies for a booking
>    request it must update live on the salon side (no refresh), and in the admin
>    panel too."
> 4. "A booking a customer requests must appear in a Booking Request tab with a
>    five-minute countdown until the salon owner or admin accepts / rejects it, or
>    it is auto-rejected because nobody acted. No user actions in that tab — it is
>    just history."

| Part | Where it lives | Delivered by |
| --- | --- | --- |
| 1 | `src/styles.css` (web) · `src/index.css` (admin) | this branch · `patches/admin-panel-8-compact-headers.patch` |
| 2 | `src/pages/{BookingRequests,PushNotifications,PlansAndTrials,ShopSettings}.jsx` | `patches/admin-panel-8-compact-headers.patch` |
| 3 | `src/lib/socket.js`, `src/components/SalonLeads.jsx` · `src/services/liveSocket.js`, `src/pages/BookingRequests.jsx` | this branch · `patches/admin-panel-9-live-booking-requests.patch` · `patches/backend-11-live-customer-booking-requests.patch` |
| 4 | `src/components/CustomerBookingRequests.jsx`, `BookingsScreen` | this branch · `patches/backend-11-live-customer-booking-requests.patch` |

Apply order: `backend-8 → 6 → 7 → 9 → 10 → 11`; `admin-panel-2 → 3 → 4 → 5 →
6 → 7 → 8 → 9`. The admin panel needs `npm ci` once (9 adds
`socket.io-client`).

---

## 1. A button holds its own label

Two stylesheets, one rule, three causes:

| Cause | Where | Fix |
| --- | --- | --- |
| `white-space: nowrap` on `.btn` | `src/styles.css` | `white-space: normal` + `overflow-wrap: anywhere` |
| a flex row that could not shrink | `.editor-actions`, `.delay-actions`, `.request-actions`, `d-flex` footers | `min-width: 0` on the button, `flex: 1 1 100%` on phones |
| a label too big for a 320px screen | both panels | one notch smaller under 520px (web) / 575.98px (admin) |

Reported example: **"Save and continue to payment"** next to **"Cancel"** in the
salon profile editor's sticky action bar. The label was longer than the half-width
button and, because the button refused to wrap, it was painted past the rounded
edge and off the card. On a phone the bar now stacks (one button per row) and the
label drops to 12.5px.

Checked across the website's screens — the booking review sheet, the delay sheet,
the subscription screen's "Continue to payment", the shop checkout, the request
cards — and across the admin panel — the request footer's "Accept for salon" /
"Decline for salon", the Notifications composer's "Send Notification", the shop
and plan forms. A stylesheet test (`src/styles.buttonFit.test.js`) pins the new
rules so a future edit cannot put `nowrap` back on `.btn`.

## 2. Page subtitles are gone from the admin panel

Removed outright (not hidden behind a breakpoint) from the four pages that had
one:

| Page | The line that went |
| --- | --- |
| Booking requests | "Customer enquiries, salon answers and missed leads. Opens on today (IST); every filter narrows the list." — and the filter card's "Search, filter and page through every request on the platform." |
| Notifications | "Everything the admin panel receives — new shop orders, salon registrations, subscription renewals, delivery-partner updates and booking requests. Opening this tab marks them read." |
| Plans & Trials | "What a salon pays, how long each plan runs and how long a new salon is free. The website and the app read this list — a change here reaches both without an app release." |
| Shop Settings | "Configure delivery charges, discounts, and Cash-on-Delivery rules for Naai Shop. Changes apply immediately to new orders." |

Each restated what the control underneath it already said, and each cost a full
row above the fold on a phone — the reason the owner asked for this "especially on
mobile". Section headings and field labels stay: those orient, they do not
narrate.

## 3. The socket: one event, three screens

```
                 ┌──────────────────────────────┐
customer sends → │  booking_request_created     │ → salon_<salonId>
                 │  booking_request_updated     │ → user_<customerId>
salon answers  → │  (ACCEPT / REJECT / DELAY /  │ → admin
admin answers  → │   AUTO_CANCELLED)            │
sweeper expires→ └──────────────────────────────┘
```

* **Rooms.** `salon_<salonId>` and `user_<customerId>` already existed. The
  `admin` room is new: a panel socket emits `join_admin` on connect
  (`index.js`), and every event fans out to all three rooms through one helper,
  `src/utils/bookingRequestEvents.js` — a new call site cannot reach two screens
  and forget the third.
* **Payload.** Ids and labels only: `bookingRequestId`, `salonId`, `salonName`,
  `customerId`, `customerName`, `bookingDate`, `bookingTime`, `status`,
  `createdAt`, `expiresAt`. **No phone numbers, no service lists, no rows.**
  Every screen re-reads its own authenticated list on the event, so a socket
  message can never make the UI show a request the database does not have.
* **Who emits.**

  | Emit | File |
  | --- | --- |
  | created (after commit) | `src/controller/bookingRequest/bookingRequest.js` |
  | accepted / rejected / delay proposed / expired-during-answer | `src/services/bookingRequestAction.service.js` |
  | auto-cancelled by the scheduled task | `src/controller/bookingRequest/autoCancelBookingRequest.js` |

  The cron sweeper's bulk `UPDATE` stays silent on purpose: it is the safety net
  for a lost task, and the salon tab still polls every 20 s while the customer's
  countdown is computed from `expiresAt` on the device.
* **Web client.** `src/lib/socket.js` rooms now carry several events (a booking
  requests tab listens for created *and* updated); before, the second event
  replaced the first for cross-tab relay.
* **Admin client.** `src/services/liveSocket.js` — one socket, `join_admin` on
  connect, `subscribeToAdminEvents(event, handler)`. `BookingRequests.jsx` puts a
  toast on `created` ("New booking request from Asha") and quietly refreshes the
  table and the tiles on either event. Without the patch the page still works;
  it just doesn't move on its own.

Verify (restart the API after applying the backend patch):

```bash
cd my_naai_backend && node scripts/test-booking-request-live.js   # 10 checks
```

Then, with the salon's Booking requests tab and the panel's own tab open, send a
request from the website: the card appears in both without a refresh.

## 4. The customer's Booking requests tab

`My bookings` now has a segmented switch: **My bookings** | **Booking requests**.
The second is the customer's half of the same table, read-only.

```
POST /api/bookingRequest/user/list       (Authorization: Bearer <user token>)
{ "page": 1, "limit": 20, "status": "ALL" }

→ { "status": "SUCCESS", "data": {
      "requests": [{
        "bookingRequestId": "…",
        "salonName": "Glow Studio", "salonCity": "Nagpur",
        "bookingDate": "2026-11-06", "bookingTime": "18:30:00",
        "status": "PENDING" | "ACCEPTED" | "REJECTED" | "AUTO_CANCELLED" | "CANCELLED" | "DELAYED",
        "createdAt": "…", "expiresAt": "…",
        "services": [{ "serviceName": "Haircut", "price": 300 }], "total": 300
      }],
      "pagination": { "page": 1, "limit": 20, "totalPages": 1, "totalRequests": 1 } } }
```

* **Identity from the token only.** There is no `userId` in the body — a body
  field would be a client choosing whose history to read.
* **Five-minute countdown.** `expiresAt` is the server's deadline (stamped at
  create time from `WINDOW_SECONDS = 300`). The card ticks it down every second
  and turns into **"No answer — expired"** at 0:00 by itself, whether or not the
  sweep has run — the same rule the salon's tab uses (`leadView()` in
  `src/lib/bookingLeads.js`).
* **No actions.** Accept / reject belong to the salon; cancelling a request is
  the existing flow on the booking. The only buttons are the three list filters
  and Refresh. `CustomerBookingRequests.test.jsx` asserts that nothing else can
  be clicked.
* **Arriving here.** The "Request sent" screen's primary button is now **Watch
  the request** → `bookings` with `{ tab: 'requests' }`, which is the side with
  the clock on it.

Nothing is written by this tab, and a deployment without the endpoint answers
404 — the tab then says *"Your request history appears here after the next
backend update"* instead of showing an empty history.
