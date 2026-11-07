# Admin panel — Booking requests tab

> **Implemented by** `patches/admin-panel-1-booking-requests.patch` (the tab) and
> **`patches/admin-panel-2-booking-requests.patch`** (this document: today by
> default, filters that filter, answering for a salon). Real code:
> `src/pages/BookingRequests.jsx`, `src/components/BookingRequestDetailModal.jsx`,
> `src/components/Layout.jsx`, `src/services/communication.jsx`.
> Backend: `patches/backend-6-booking-request-admin-actions.patch`
> (contract: [`BACKEND-BOOKING-REQUESTS-API.md`](BACKEND-BOOKING-REQUESTS-API.md)).

Target repo: `rightserveinfotechsystems/my-naai-frontend` (admin panel)

A top-level tab beside **Shop Orders**: **Booking requests**.

> **Requests are not bookings.** This tab lists the leads a customer sent and
> what the salon did with them, from `booking_requests`. It must not read
> `booking` / `booking_list` to answer any question here — a booking exists only
> after a salon accepts, and mixing the two is what makes a "conversion rate"
> that adds up to more than 100%.

---

## 1. What the tab is for

The question the admin team actually asks: **are the salons getting leads, and
are they answering them?** And, when a salon's phone is dead and the customer is
standing at the counter: **can we take the chair for them?**

So the screen opens on **today**, leads with per-status counts for the window,
and the list under it is filterable by salon, status and date — every filter
applied in SQL, paged on the server.

## 2. Layout

```
Booking requests                                            [ Refresh ]

Filter requests
┌ Customer, phone or salon… ┐ ┌ Date range ▾ ┐ ┌ Salon ▾ ┐ ┌ Clear ┐
[ All 320 ] [ Awaiting 12 ] [ Accepted 251 ] [ Rejected 34 ] [ Auto-cancelled 35 ] …
18 requests matching · [Today] [Awaiting]              [Export CSV] [25 ▾] [< 1/2 >]

Customer requests                 18 total requests in Today
┌───────────────────────────────────────────────────────────────────────┐
│ CUSTOMER           SALON            REQUESTED      VALUE  STATUS   …  │
│ Rohit D.           Glow Studio      Thu, 06 Nov      ₹450  Awaiting    │
│ 98765 00001        Pune             18:30 · Haircut                     │
└───────────────────────────────────────────────────────────────────────┘

Salon performance                                          [ Most missed ▾ ]
```

Two things this layout is strict about:

- **Counts come from the server.** The number on a chip is
  `statusCounts[chip]` from the same response that filled the table, so the chip
  and the rows it produces are one number. They describe the selected **range and
  salon**; the search box has its own total on the results line, labelled, so the
  screen never claims two different numbers are the same thing.
- **Width.** The table is `table-layout: fixed` with explicit column widths, and
  every text cell is a single ellipsised line (`title` carries the full value).
  A 120-character salon name shortens; it does not widen the page. `Layout.jsx`
  gives the main column `min-width: 0`, which is the actual fix for content
  escaping past the sidebar — a flex item's default `min-width: auto` lets a wide
  child push the whole rail.

## 3. The detail sheet

Clicking a request opens it without leaving the tab:

- **Customer**: name, phone (click-to-call), city.
- **Requested**: services with prices, estimated total, date, time, chosen
  barber (or "any").
- **Lifecycle** — `sent → (accepted | rejected | auto-cancelled)`, each with a
  timestamp and the seconds it took. An auto-cancel reads **"No answer within 60
  seconds — the slot was released automatically"**, never "rejected". When My Naai
  answered, the event says so (`Accepted by My Naai`, with the admin's note on a
  rejection) — read from `onBehalfOfSalon`, never guessed.
- **Booking**: if `bookingId` is set, the request became booking #…. If not, the
  sheet says it never became one.

## 4. Answering on the salon's behalf

The footer offers **Accept for salon** / **Decline for salon** while the request
is answerable — `PENDING`, inside its five minute window, with no booking.
Anything else is read-only and the footer says which: *"The 5-minute answer
window has closed"* or *"Read-only · already answered"*.

Pressing either opens an **inline** confirm (not a second dialog, which would
cover the request being confirmed on a phone): the heading names the salon, the
note field is **required for a decline** and optional for an accept, and the
confirm button says *"Yes, accept booking"* / *"Yes, decline request"*.

Why a note is required to decline: the salon is told, in-app and over the socket,
that My Naai answered for it. A rejection with no reason is a phone call waiting
to happen.

What the server guarantees (and the panel relies on, see
`docs/BACKEND-BOOKING-REQUESTS-API.md` §5): the answer goes through the **same**
transaction the salon's own Accept uses, with the request row locked. If the
salon answered a second earlier, the call comes back `already actioned` — the
panel shows that message, refreshes, and the request is not offered again.

## 5. Filters, paging and exports

- **Date range**: Today (default) / Last 7 days / Last 30 days / All time,
  resolved in **IST** (midnight to midnight) by the server and echoed back in
  `filters` — the chip line prints the window actually applied, not the one that
  was asked for.
- **Status**: the chip row (§2). Clicking a chip narrows the table.
- **Salon**: a select built from the summary's per-salon report plus the rows on
  screen.
- **Search**: customer name, phone or salon name — server side.
- **Any filter change returns to page 1.** Filtering from page 3 of a one-page
  result asks for page 3 and shows nothing, which is exactly what "the filter is
  broken" looks like.
- **Rows per page**: 25 / 50 / 100, paged in SQL. Ordering is
  `created_at DESC, booking_request_id DESC` — stable, so paging cannot repeat or
  skip a row.
- **Export CSV** of the filtered list, one page at a time, with the same columns
  as the API plus `responseSeconds` and **Answered by** (Salon / My Naai).
- **Empty states are per filter**: "No requests today yet — widen the range",
  with one-tap **Last 7 days** and **Clear filters**.

## 6. Rules

- **Answering does not create a second path.** The button calls
  `POST /api/bookingRequest/admin/action/:id`, which runs the salon's own
  accept/reject transaction with `actorRole = ADMIN`. There is no "convert
  request" button and no panel-side booking creation.
- A `PENDING` request older than its window is displayed as **Auto-cancelled**
  even if the sweeper has not written the row yet (the API does the same), and it
  offers no buttons.
- Timezone: **Asia/Kolkata** everywhere, with the same formatter the rest of the
  panel uses.
- Live updates are a nice-to-have; a 20-second poll of the summary is enough and
  costs one query.

## 7. Acceptance checks

1. Open the tab: it says **Today** and lists only today's requests (IST). Compare
   with `SELECT count(*) FROM booking_requests WHERE created_at >= '<IST
   midnight>'` — the two numbers match.
2. Switch to **Last 7 days**, then back to **Today**: the table changes, page
   resets to 1, and the chip line names the window.
3. Pick **Rejected**, then type a customer name: both narrow the list (they used
   to cancel each other out server-side). Switch to page 2 and back: no repeats,
   no gaps.
4. Chip counts add up to the total on the results line, for every range.
5. Narrow the window to 1024 px and paste a 120-character salon name into the
   database: the row ellipsises and the sidebar does not move. Same at 375 px.
6. On an open request press **Accept for salon**: the heading names the salon,
   the confirm is inline, and after it the row reads **Accepted** with *by My
   Naai* under it, `bookingId` is set, and the salon's app shows the booking.
7. Answer the same request from the salon's app at the same moment: only one
   booking exists, and whichever screen lost says *"already actioned"*.
8. Decline with an empty note: the confirm refuses. Decline with a note: the
   customer sees the normal salon-facing rejection wording and the salon sees My
   Naai's note.
