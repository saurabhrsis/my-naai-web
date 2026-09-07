# MyNaai web portal guide

This document describes the responsive MyNaai customer and salon-partner web portal, the mobile-app compatibility decisions, and the current notification/time-update workflows.

## 1. What the portal is

The portal is a Vite/React single-page PWA for the two roles already present in the mobile app:

- **Customer**: discover salons, view services and specialists, choose a slot, create booking requests, view bookings, respond to a salon delay request, browse products, update the profile and read notifications.
- **Salon partner**: view the live customer queue, open a booking request, accept or reject it, ask the customer to accept a small time delay, mark a service complete, review history, manage products, edit salon details, manage open/closed status, manage a subscription and sign out from the account screen.

The UI uses the same REST endpoint names and payload conventions as `rightserveinfotechsystems/my_naai_app`. The production API default is `https://backend.mynaai.in`. In Vite development, `/api`, `/getFiles` and `/socket.io` use the configured proxy. The image path deliberately keeps the mobile app’s case-sensitive spelling: `/getFiles/<path>`.

Uploaded files are only served by that route, but the payload paths are inconsistent (`/public/uploads/x.jpg`, `public/uploads/x.jpg`, a full backend URL, or an already-prefixed `/getFiles/...`). Every `<img>` therefore goes through `getFileUrl()` in `src/lib/api.js`, which normalises all four shapes onto `${API_BASE_URL}/getFiles/<relative path>`. Never concatenate `API_BASE_URL` with a stored path directly — that produced `https://backend.mynaai.in/public/uploads/…` and the ads carousel rendered blank tiles.

## 2. Run and build

```bash
npm install
npm run dev
```

For a production build:

```bash
npm run lint
npm run build
npm run preview
```

A deployed production site should use HTTPS, serve the SPA fallback for hash routes, and expose the generated `dist` directory. Copy `.env.example` to `.env.local` and fill only the values needed by the deployment. Do not commit `.env.local`.

## 3. Startup and authentication

There is deliberately no multi-second web splash screen. The app reads its session synchronously from `localStorage` and renders the authenticated shell immediately. First-time visitors see the onboarding slides; returning visitors go directly to the login form or their saved workspace.

The web session uses these keys:

| Key | Purpose |
| --- | --- |
| `mynaai` | JSON-wrapped bearer access token, matching the mobile storage shape |
| `mynaaiUser` | Last authenticated user/salon object |
| `userType` | `USER` or `SALON` |
| `isLoggedIn` | Boolean-like string used to restore the session |
| `isNewSalon` | Salon registration state |
| `FCM_TOKEN` | Browser-only Firebase registration token, when push is configured |
| `hasSeenOnboarding` | Local onboarding preference |

A successful OTP verification/onboarding stores the token and role. A browser restart therefore preserves the login until the API token expires or the user signs out. If the API returns `JWT_FAILED` or another JWT failure response, `src/lib/api.js` clears the stored session and dispatches `mynaai:session-expired`, which immediately returns the React app to authentication. A manual logout also deletes the browser FCM token.

The app listens for relevant `localStorage` changes, so signing out or changing the session in another tab updates the open tab as well.

### Required browser notifications

The first-load onboarding/login experience offers a visible **Enable alerts** action only when notification permission or token setup needs attention. Authenticated pages stay focused on their work; a retry action is available from the Account screen when permission is missing or blocked. Technical Firebase configuration details are never shown to users. The action can be retried after the user changes the site permission in browser settings.

Real customer and salon authentication is blocked until Firebase Web Push returns a non-empty registration token. That token is sent as `deviceToken` in the OTP verification/onboarding contract and is cached as `FCM_TOKEN`.

### Incomplete salon profile guard

After salon login, `isNewSalon` or `profileCompleted: false` routes to **Complete salon profile** before the queue/dashboard is rendered. The editor requires owner/salon/contact/type/address information, valid services and specialists, browser coordinates, and valid hours. A successful update clears the incomplete flag and moves the partner to the subscription choice before normal salon navigation.

## 4. Salon queue changes

### Walk-in customer is disabled

The walk-in customer flow is not exposed in the web portal. The legacy `walkInBooking` API method remains only because the REST client must preserve the mobile API surface; no screen calls it.

### Token number is no longer displayed

Queue token numbers are not shown in the portal. The queue now focuses on the customer name, appointment date/time, services, specialist and phone action. The summary card shows the next appointment time and customer instead of a token number. The API may still return `queueNumber`; it is simply not rendered by the web UI.

## 5. Salon profile update contract

The web editor mirrors the mobile app's `EditSalonProfileScreen`: the same collapsible groups (**Owner Information**, **Salon Information**, **Address & Location**, **Salon Images**, **Business Hours**, **Salon Services**, **Barbers**) and the same field labels (Salon Owner Name, Mobile Number, Email Address, Salon Name, Salon Type, Agent Code, Complete Address, Landmark / Address Line 2, City, State, Pincode, Opening Time, Closing Time, Weekly Off, Service Name, Price, Duration, Description, Barber Name, Availability). **Every group is collapsed by default** (including during onboarding) and each collapsed card still carries three readable lines: the group title, the mobile app's sub heading (for example *Name, phone number and email*) and a live summary of what is inside it, plus a red `N required` chip when something mandatory is missing. Required fields are marked with a red `*` exactly like the mobile `FieldLabel`, inputs use a larger 15px body size with a lighter border and placeholder, and a status bar above the form counts the outstanding required details with an **Expand all / Collapse all** control. A failed save opens the offending group, scrolls it into view and focuses its first input. Individual service and barber cards expand exactly like the mobile editor, and an incomplete service or barber is flagged while collapsed. The web editor sends the same complete body shape used by the mobile salon editor to `POST /api/salons/edit-salon-profile`. It includes profile/contact/address fields, numeric `latitude` and `longitude`, `imageUrl`, `imagesArray`, a detailed `businessHours` array, `isActive`, `profileCompleted`, and separate service/specialist collections:

```json
{
  "salonId": "...",
  "ownerName": "...",
  "salonName": "...",
  "phoneNumber": "...",
  "email": "...",
  "genderType": "UNISEX",
  "agentCode": null,
  "addressLine1": "...",
  "addressLine2": null,
  "city": "...",
  "state": "...",
  "pincode": "...",
  "latitude": 21.1458,
  "longitude": 79.0882,
  "existingServices": [{ "serviceId": "...", "serviceName": "Haircut", "durationMinutes": 30, "price": "299", "description": "..." }],
  "newServices": [],
  "existingBarbers": [{ "barberId": "...", "fullName": "...", "profileImageUrl": null, "ratingAverage": "4.8", "isAvailable": true }],
  "newBarbers": [],
  "businessHours": [{ "scheduleId": "...", "openingTime": "09:00:00", "closingTime": "22:00:00", "breakStartTime": null, "breakEndTime": null, "holidayDays": [] }],
  "isActive": true,
  "profileCompleted": true
}
```

New services and specialists intentionally omit their IDs; existing records retain `serviceId`/`barberId`. The editor preserves the schedule ID and break times, and refuses to submit missing/invalid coordinates or malformed contact, service, barber and time values.

Coordinates that already exist on the profile are kept as-is; the browser location prompt only runs automatically when the salon has **no** saved pin, so an existing partner editing their menu from home never has the salon location silently replaced. **Detect current location** remains available on demand.

### Where a save takes the partner

| Profile state when the editor opened | Active plan | After a successful save |
| --- | --- | --- |
| New salon / profile not completed | none or expired | **Payment screen** (`#/subscription`) — free 20-day onboarding plan first, then the paid plans |
| New salon / profile not completed | already active | **Salon account** (`#/account`) — never a second payment for the same save |
| Complete profile (routine edit) | any | **Salon account** (`#/account`) |

Sign-in, session restore and the salon account screen all force an incomplete profile back into this editor (`isNewSalon` / `profileCompleted === false`, or a profile missing owner name, salon name, address, salon type, coordinates, services or business hours), so a new salon always reaches the editor first and the payment screen second.

### Live updates socket

Both realtime screens (salon **Customer queue** and customer **My bookings**) share one socket.io connection managed by `src/lib/socket.js`. It mirrors the mobile app's global socket approach: it joins the `join_salon`/`join_user` room for the signed-in identity, re-joins rooms after every reconnect, listens for `queue_updated`/`booking_status_updated`, and starts with polling before upgrading to WebSocket so a blocked `wss` upgrade degrades to polling instead of failing (the earlier websocket-only connections produced "WebSocket is closed before the connection is established" during React StrictMode remounts and never recovered behind proxies without an upgrade path). Local development connects same-origin through the Vite `/socket.io` ws proxy; production uses `VITE_API_BASE_URL`. The connection is rebuilt on logout and session expiry.

### Plan prices

One price list serves the whole portal (`PLAN_PRICES` in `src/lib/planDetails.js`): **₹199 / 1 month**, **₹299 / 2 months**, **₹499 / 3 months**. `RENEWAL_PLANS` is derived from `PARTNER_PLANS` and only overrides the supporting note, so a renewal costs exactly what a new purchase costs. The two arrays previously carried independent prices and had drifted (renewals were still on an old ₹99 / ₹179 / ₹249 ladder), which showed a partner one price on the plan card and charged another on the next screen.

### Active plan display

`src/lib/planDetails.js` keeps the plan catalog (same ids, titles, prices and durations as the mobile `SubscriptionsPlan`/`RenewalSubscriptionsPlan` screens) and normalizes the subscription fields returned by `get-salon` (root fields such as `planType`/`planExpiryDate` or nested `subscription`/`plan` objects). The salon account screen shows an active-plan card (plan title, price, start/expiry dates, days remaining, status, manage/renew action) and the profile editor shows a compact plan strip. When the backend response carries no plan fields, the account screen falls back to a "Plan details unavailable" card that deep-links to the subscription picker instead of guessing.

## 6. Salon subscriptions and onboarding

The subscription route follows the mobile `SubscriptionsPlan` contract:

- An incomplete, already-created salon is sent to the profile editor first. After a successful profile save, the partner sees the default **20-day free trial** choice and can start it without opening Razorpay. The editor clears the incomplete-session flag while keeping the partner on the subscription route; the free-plan action then refreshes the authenticated hash route into the salon queue.
- A new salon reaches the same route after registration OTP, with the temporary token returned by `verify-otp-register`. Paid plans first call `POST /api/salons/create-payment-order` with the plan amount in INR, open Razorpay Checkout with the returned order ID, and send the payment ID, order ID and signature to `POST /api/salons/create-salon-with-plan` with the temporary bearer authorization. The response must contain both a salon ID and a permanent session token; otherwise the portal does not mark registration as complete.
- A logged-in partner can choose a renewal plan from the account subscription entry. The browser creates the Razorpay order and sends `{ planType, paymentId, totalAmount }` to `POST /api/salons/renew-salon-plan` with the persisted salon session. A successful renewal returns to the partner account without replacing the session with a temporary token.
- An expired salon subscription is a hard partner-side paywall. On restore/login the portal revalidates the salon plan before mounting queue, history, products or account; an expiry date/status or a backend `PLAN_EXPIRED` response replaces the entire salon shell with the renewal payment screen. `src/lib/api.js` performs the same global response-interceptor check as the mobile Axios client on every API call, including failed HTTP responses, with a one-time redirect guard. The forced screen has no back/navigation path and remains in place until renewal succeeds. Customer sessions never enter this payment flow.

The public Razorpay key is read from `VITE_RAZORPAY_KEY_ID` (with the mobile app's configured live key as the production fallback); no secret is placed in the browser. The payment order and subscription endpoints remain in `src/lib/api.js` with the mobile method names and bearer/body contracts.

### Payment outcomes, cancellation and UPI app hand-off

`src/lib/razorpay.js` wraps Checkout so every outcome is explicit instead of a silent `null`:

- **Amount** — the order is created in rupees (`{ amount, currency: 'INR' }`) and Checkout is opened with the order's own amount in paise; a ₹0 plan falls back to 100 paise, matching `paymentForMembership` in the mobile app so the gateway never rejects a zero-amount order.
- **Cancelled** — closing the sheet (back button, `Esc`, dismiss) reports *"Payment cancelled. No amount was charged."* and keeps the partner on the plan picker with the order ID for support. `modal.confirm_close` is on so an accidental back-tap while a UPI app is opening does not silently abandon the subscription.
- **Failed** — `payment.failed` shows the bank/gateway reason but leaves the sheet open so the partner can retry with another method; only a terminal validation failure resolves immediately. A failed attempt is never treated as success, and a retry that succeeds still activates the plan.
- **UPI app redirect (GPay / PhonePe / Paytm / BHIM)** — the sheet is kept alive while the tab is hidden (`visibilitychange` / `pagehide`), the UI switches to *"Waiting for your payment app…"* and then *"Confirming your payment… — please do not pay again"* when the partner returns. If Checkout hands the result back through a redirect instead, `razorpay_payment_id` / `razorpay_order_id` / `razorpay_signature` are read from the URL (search **or** hash query), matched to the stored order, used to finish `create-salon-with-plan` / `renew-salon-plan`, and then stripped from the address bar so a refresh cannot replay them.
- **Interrupted / killed tab** — the order, plan and (for registration) the registration payload are persisted before the sheet opens. On return the portal shows a recovery card with the order ID, **Try again** and a `tel:` link to 8380017393; a stale record (over 30 minutes) is discarded. If a payment succeeded but activation failed, the card switches to *"Payment received, plan not activated"*, hides **Try again** and shows the payment ID, so a partner is never invited to pay twice.
- **Gateway availability** — `checkout.js` is loaded on demand if the async tag in `index.html` was blocked, and the screen shows a live status line (`Secure payments powered by Razorpay` / `Preparing…` / `could not load` with **Retry**) instead of failing only when the partner taps pay. Checkout is loaded **before** the order is created, so a blocked gateway no longer strands a live unpaid order on the backend.
- **Order response shape** — `extractRazorpayOrder()` searches the response for a real `order_…` id instead of reading only `response.order.id`. `create-payment-order` has returned the order as `{ order }`, `{ data: { order } }`, `{ data: … }` and as the bare object, under both `id` and `orderId`; every other shape used to surface as *"the payment order came back empty"* even though the order existed. Ids that are not Razorpay order ids (a salon id, a booking id) are rejected rather than sent to Checkout.
- **Order authorization** — during registration there is no persisted session, so the temporary `verify-otp-register` token is sent as the `Authorization` header on `create-payment-order`. Backends that protect that route were returning a 401 that surfaced as *"could not start the payment"*. A logged-in renewal uses the normal session token.
- **Public key validation** — a `VITE_RAZORPAY_KEY_ID` that is not a real `rzp_(test|live)_…` id (empty, or a leftover placeholder) is rejected up front with a clear message and the support number, instead of being handed to Checkout and failing with an opaque gateway error.
- **Signature passthrough** — `renew-salon-plan` receives `orderId` and `signature` alongside the mobile contract's `planType` / `paymentId` / `totalAmount`, so a backend that verifies the Razorpay signature has what it needs and cannot reject an already-charged payment.
- **The sheet always closes** — a terminal failure or a success used to resolve the promise while the Razorpay iframe was still on screen, leaving the partner looking at a dead payment window while the app carried on underneath. `finish()` now closes Checkout explicitly on those paths.
- **Registration token** — the temporary `verify-otp-register` token is sent only as an `Authorization` header on `create-salon-with-plan`; it is no longer written into the session before payment, so a cancelled payment cannot leave the portal holding a temporary token.

### Cancelling out of the salon profile editor

The editor's **Cancel** button is never disabled. It used to render `disabled={isOnboarding}` while the header back arrow was hidden on the same condition, so during onboarding a partner saw a Cancel control that did nothing at all and had no way off the screen — the "cancel button not working" report. `session.isNewSalon` can also be stale-true after a failed profile fetch, which put an ordinary partner in that dead-end.

- **Routine edit** — Cancel asks *"Discard your changes?"* through the in-app sheet and returns to Account on confirm.
- **Onboarding** — Account does not exist yet, so Cancel explains that the profile has to be finished and offers **Sign out** (saved details are kept) rather than silently doing nothing.
- The header back arrow is always rendered and runs the same handler, so there are two ways out on every device.

Both paths use `useConfirm()`, never `window.confirm` — the native dialog is suppressed in some installed-PWA webviews, where it returns `false` and makes a button look dead on exactly one device.

## 7. Browser permissions

Notification permission is still required to sign in (the backend requires a `deviceToken`), but the portal explains it rather than demanding it, and always offers a next step:

- **Never asked yet** — *"Turn on booking alerts"* with an **Allow** button and a **Need help?** link.
- **Blocked** — a browser will not show its prompt a second time, so an Enable button there is a button that cannot work. That state shows **Show me how** instead, opening step-by-step instructions for the actual browser in use (Chrome on Android, Chrome/Edge/Firefox/Opera desktop, Samsung Internet, Safari and Chrome on iOS, Safari desktop) plus the support number.
- **iPhone** — web push only exists for Home Screen apps, so the card gives the Add-to-Home-Screen steps rather than pointing at a Settings toggle iOS does not have.
- **Location is optional and says so.** The card reads *"Show nearby salons first?"*, carries a **Not now** action that hides it for the session, and when blocked explains that salons are still listed, just without distances. It never blocks login.

## 8. Salon time update and customer notification

When a salon cannot start a booking at the selected time, the salon can open the booking request and choose **Update time**. The web flow offers the same delay options as the mobile app:

- **+20 minutes**
- **+40 minutes**
- **+60 minutes**

The salon sees that the customer will receive a delay request. Selecting an option calls the mobile-compatible endpoint:

```http
POST /api/bookingRequest/owner-action/{bookingRequestId}/
Content-Type: application/json
Authorization: Bearer <salon-access-token>

{
  "action": "DELAY",
  "delayMinutes": "10"
}
```

The web wrapper is `api.salonDelayBooking()`. The server-side `owner-action` implementation is responsible for saving the new delay state and sending the customer notification through the stored `deviceToken`, exactly like the mobile owner-action flow. The browser does not contain Firebase server credentials and does not send FCM messages directly.

### Updating the time from the Customer queue

The booking-request screen only exists during the 60-second response window. Once a booking is accepted it lives in the **Customer queue**, and until now a salon that fell behind had no way to tell the customer. Every queue card therefore carries an **Update time** action next to **Done**.

The modal (`UpdateTimeModal` in `src/components/SalonScreens.jsx`) works in **signed minutes** — negative means *earlier* — so one control covers both directions. A switch at the top picks how the salon expresses the new time, because the two situations are genuinely different: *"I'm about twenty minutes behind"* is an offset, while *"the chair frees up at quarter past seven"* is a clock time, and making the salon convert one into the other in its head is where mistakes come from.

**Shift by minutes**

- **Running late — push it later**: +10 / +20 / +30 / +45 / +60 / +90.
- **Free earlier — bring it forward**: −10 / −15 / −20 / −30. Deliberately shorter than the delay options: a customer still has to travel, so pulling them in by an hour is not a reasonable one-tap action.
- **Or enter minutes**: any whole number between −120 and +240 for anything else.

**Pick exact time**

- A native time input, pre-filled with the booking's current time so the salon nudges from where it already is rather than from midnight.
- The offset is *derived* from the picked time by `offsetForTargetTime()`, so a later pick sends a positive value and an earlier pick a negative one — the rest of the pipeline never learns which control was used.
- A late-night salon that picks `00:15` for a `23:45` booking means *thirty minutes later*, not twenty-three-and-a-half hours earlier, so a target more than 12 hours behind the booking is read as the next day. Beyond that window the literal reading wins, so an ordinary earlier pick still moves backwards.
- Picking the time it is already booked for is not an error, just a no-op: the send button stays disabled with *"That is the current booking time"*.

**Note to the customer** — an optional 200-character message (e.g. *"Previous service is running long"*) sent as `reason`, shown in both directions.

**Proper timing is the point of the feature**, so the salon always sees the resolved wall-clock time before sending — `6:30 PM → 6:50 PM · 20 minutes later` — not just an offset. The maths is in `src/lib/bookingTime.js` (plain, unit-tested functions, no React):

- Booking values are parsed as **local wall-clock** time. `new Date('2026-09-07T18:00:00Z')` would shift an Indian salon's 6 PM by 5h30m; a salon thinks in its own clock.
- Hour and date rollover is handled, and a shift that crosses midnight is called out (`moves to 08 Sept 2026`) instead of silently moving the appointment to another day.
- A new time that lands **in the past** is blocked with an explanation and the send button is disabled — notifying a customer about a slot that has already gone is worse than not notifying them.

Sending calls `api.salonUpdateBookingTime()`, which posts to the **same `owner-action` endpoint with the same `DELAY` action** as the mobile app, so there is one delay pipeline rather than two, and the backend keeps dispatching the customer notification:

```http
POST /api/bookingRequest/owner-action/{bookingRequestId}/

{
  "action": "DELAY",
  "delayMinutes": "-15",
  "proposedTime": "6:15 PM",
  "newBookingDate": "2026-09-07",
  "newBookingTime": "18:15:00",
  "reason": "Chair free early"
}
```

`delayMinutes` stays the mobile contract's stringified number; the extra fields are additive and are ignored by a backend that only reads `action` + `delayMinutes`. The queue row updates optimistically, rolls back on failure, and reloads so the Today/Tomorrow grouping is right after a day cross. Requests are addressed by `bookingRequestId`, falling back to `bookingId` for queue payloads that only carry the latter.

**Backend.** A ready-to-paste Express + Mongoose implementation of this endpoint lives in [`backend/`](../backend/README.md) — schema fields, the wall-clock maths, direction-aware FCM copy and both handlers, with 20 tests (`node --test backend/tests/*.test.js`). It is not part of the web build; copy it into the API repo. Two things it fixes that matter here: the notification copy respects the **sign** of `delayMinutes` (a negative offset reads *"Sharp Cuts can see you 15 minutes earlier"*, never *"delayed by -15 minutes"*), and when `newBookingTime` is present the server **recomputes** the offset from it rather than trusting the client's arithmetic. The proposed time is stored separately and only becomes the booked time once the customer accepts, so a customer who never replies keeps the slot they originally agreed to.

The web `DelayRequestScreen` already matches that copy: a negative offset renders *"Your salon can see you earlier"* with an **Earlier time available** heading, because telling a customer their booking "needs a little more time" when it has actually been pulled forward would make them arrive late.

The customer can receive the delay notification in the background or while the portal is open:

1. A notification click opens `#/delay?bookingRequestId=...&delayMinutes=...&proposedTime=...` (optionally `&reason=...`).
2. The `DelayRequestScreen` lets the customer accept or reject the proposed time. It reads the **sign** of `delayMinutes`, so an earlier offer is worded as one, spells the shift out in words ("15 minutes earlier" — `+20`/`-20` is easy to misread on a phone) and shows the salon's optional message.
3. The response calls `POST /api/bookingRequest/customer-delay-response/{bookingRequestId}/` with `{ "action": "ACCEPT" }` or `{ "action": "REJECT" }`.
4. The customer is returned to `#/bookings`.

## 9. Notification destinations

The notification route mapping is shared by foreground JavaScript and the Firebase messaging service worker:

| Mobile notification type | Web destination | Role |
| --- | --- | --- |
| `DELAY_TIME_PROPOSAL` | `#/delay` with booking ID, delay minutes and proposed time | Customer |
| `BOOKING_CONFIRMED` | `#/bookings` | Customer |
| `BOOKING_REJECTED` | `#/bookings` | Customer |
| `DELAY_RESPONSE` | `#/bookings` | Customer |
| `BOOKING_REQUEST` | `#/bookingRequest?bookingRequestId=...` | Salon |
| `DELAY_BOOKING` | `#/bookingRequest?bookingRequestId=...&openDelayModal=true` | Salon |

Foreground messages are rendered by the app itself (browser notification + in-app toast) and only time-critical types auto-navigate, so an informational message cannot pull a customer out of the booking flow; see [FIREBASE-WEB-PUSH.md](./FIREBASE-WEB-PUSH.md#foreground-delivery).

### Booking-request action buttons & response timer

A `BOOKING_REQUEST` notification carries the mobile app's **Accept / Reject / Delay** action buttons — and **only** that type. Every other notification type (`BOOKING_CONFIRMED`, `BOOKING_REJECTED`, `DELAY_RESPONSE`, `DELAY_TIME_PROPOSAL`, `DELAY_BOOKING`, etc.) has **no** action buttons; clicking it just opens the PWA/browser on its route. `firebase-messaging-sw.js` handles the action buttons in `notificationclick`: Accept and Reject call `POST /api/bookingRequest/owner-action/{bookingRequestId}/` directly from the worker (the salon token is mirrored into IndexedDB by `src/lib/api.js`, so this works even when the PWA is closed) and then close the alert; Delay opens `#/bookingRequest?bookingRequestId=...&openDelayModal=true`. Browsers cap notification actions at two (Chrome), so Accept + Reject are the visible buttons while Delay stays reachable by tapping the notification body — and every action is always available in the booking-request screen as a fallback for browsers that do not render action buttons.

The **audible background sound is client-side, not a backend `sound` field.** The worker passes the buzzer WAV as the notification `sound` and a `vibrate` pattern; browsers (especially Android Chrome) largely use the OS notification sound for web push and ignore a custom file, so the reliable buzz is the Web Audio one that plays whenever the app is open. Set a `sound` on the server payload only if you also send a `notification` block for the mobile app — it does not affect the web client, which reads the sound from the bundled WAV.

The mobile app shows a 60-second countdown on a booking-request alert and auto-cancels it after 70 seconds. The web Notification API cannot render a live chronometer, so the countdown is mirrored in the **Booking request** screen («Respond in m:ss», red in the final 15 seconds). When the timer expires, the app asks the worker (via a `MYNAAI_CLOSE_NOTIFICATION` message) to clear the matching notification and re-checks the request status.

Hash query parameters are parsed by `App.jsx`, so a notification click remains actionable after a cold start or browser restart. See [FIREBASE-WEB-PUSH.md](./FIREBASE-WEB-PUSH.md) for Firebase setup and payload details.

## 10. PWA service workers

Two workers have separate responsibilities and scopes:

- `public/sw.js` owns the root app scope and caches the offline shell.
- `public/firebase-messaging-sw.js` is registered only when Firebase push is configured, with scope `/firebase-cloud-messaging-push-scope`. It receives background FCM messages, shows a browser notification and handles click-through routing.

They must not be merged into one worker or registered with the same scope. The PWA install prompt is captured by the app and offered during onboarding/authentication and from the workspace sidebar when the browser supports it.

## 11. Device safe areas and in-app confirmations

### The top of the screen is never cut by the status bar

An installed PWA draws edge to edge, so the device status bar sits **on top of**
the page: on iPhone (`apple-mobile-web-app-status-bar-style: black-translucent`;
Chrome on iOS behaves identically because every iOS browser uses WKWebView) and
on Android once Chrome renders installed web apps edge to edge. The app name and
the notification bell in `.mobile-shell-bar` were the first things clipped.

- `index.html` keeps `viewport-fit=cover`. Without it every
  `env(safe-area-inset-*)` resolves to `0px` and no CSS can fix the clipping.
- `src/styles.css` exposes `--safe-top/right/bottom/left` on `:root`, and every
  surface that touches a screen edge is padded with them: the app header, the
  workspace content, the subscription-gate content (which hides the header), the
  bottom tab bar, modals, confirmations, toasts, the onboarding/login/salon
  registration pages and the desktop sidebar.
- `.mobile-shell-bar` is `position: sticky` and painted with the app background,
  so scrolled content never shows through the status bar strip and the app name
  and bell stay reachable on a long queue or home screen. `.workspace` became a
  column flex box at the same time: `.workspace-content` used to carry its own
  `min-height: 100svh` *below* the header, making every screen one header taller
  than the device.
- In a normal browser tab all four insets are `0px`, so the layout is unchanged
  there.
- `theme-color` and the manifest colours now match `--black` (`#080a0a`). Android
  paints the status bar with `theme-color`, and the old `#0b0c0c` showed up as a
  lighter band above the header that also read as the top being "cut".
- `apple-mobile-web-app-title` names the iPhone Home Screen icon **My Naai**.
  Without it iOS falls back to `<title>`, a marketing line that was truncated to
  "My Naai — your s…". Android uses the manifest `short_name`.
- `public/sw.js` moved to `mynaai-shell-v3` so already-installed PWAs drop the
  old shell cache and pick up the new `index.html` and manifest.

### Responsiveness across every screen and browser

A pass over all customer, partner and shared screens at 320 px, 375 px, 768 px,
1024 px and 1600 px closed the remaining layout and browser-compatibility gaps:

- **One image frame per component, everywhere.** `.salon-card-image-wrap` used
  five hard-coded pixel heights (157/177/195/205/220), so the same photo was a
  different crop on every breakpoint and portrait shots came out squat or
  face-cropped. Salon cards now use a single `aspect-ratio: 16 / 10` frame
  (pixel-height fallback for browsers without `aspect-ratio`), product tiles a
  capped `4 / 3`, the detail hero `3 / 2` and barber slots `1 / 1`, always with
  `object-position: center` (top for faces).
- **Default images look intentional.** `ImageWithFallback` letterboxes any SVG
  fallback (`.image-fallback-tile`: `object-fit: contain` + proportional padding
  on a branded gold/green gradient) instead of stretching the square logo tile
  across a wide frame, which is what made an empty salon card look broken. New
  on-brand placeholders replace the stock pictures that stood in for missing
  data: `public/assets/brand/product-placeholder.svg` (catalog items; the old
  default was an unrelated advert photo) and
  `public/assets/brand/person-placeholder.svg` (barbers/specialists; the old
  default repeated one person's face for every slot).
- **The wordmark reads the same everywhere.** "My Naai" is two `.brand-cap`
  spans (M and N, identical size) plus two `.brand-lower` spans; it was "M" at
  30 px and "y Naai" at 24 px before, so the two capitals disagreed. An
  `sr-only` span keeps the accessible name "My Naai".
- **Grids degrade instead of clipping.** `.plan-card-meta` uses
  `repeat(auto-fit, minmax(96px, 1fr))` and `.time-grid`
  `repeat(auto-fill, minmax(88px, 1fr))` (six columns from 760 px), so a 320 px
  phone gets two columns of readable chips instead of three crushed ones.
- **Older/quirky browsers.** `--viewport-height` declares `100vh` then `100svh`
  and every full-height surface uses it, so iOS Safari < 15.4 and Chrome < 108
  still get full-height screens; `-webkit-backdrop-filter` is paired with
  `backdrop-filter` on all seven blurred surfaces for Safari; `text-size-adjust`
  stops landscape text inflation; `touch-action: manipulation` removes the
  double-tap zoom delay on buttons and links.
- **iOS no longer zooms forms on focus.** Any focused control under 16 px made
  Safari magnify the page; a `@media (pointer: coarse)` rule lifts every text
  input, textarea and select to 16 px (the OTP field keeps its own size),
  scoped with `:not()` so checkbox/radio/range/color inputs and desktop are
  untouched.
- **Safe areas completed.** The salon profile editor's sticky action bar clears
  the home indicator (`bottom: max(8px, var(--safe-bottom))`), and the
  subscription gate pads its own content with the top and bottom insets because
  it hides the header.

### Confirmations are the app's own dialog, never the browser's

`src/components/ConfirmDialog.jsx` exports `<ConfirmProvider>` (mounted once, at
the top of `App.jsx`) and `useConfirm()`, which returns a promise-based
`confirm(options)` resolving `true`/`false`. It replaced every `window.confirm`
call and the `window.prompt` clipboard fallback in the notification diagnostics
card:

| Action | Where |
| --- | --- |
| Log out (shared `LOGOUT_CONFIRM` copy) | Customer account, partner account, desktop sidebar, expired-plan notice |
| Cancel a booking | Customer → My bookings |
| Mark a service done | Partner → Customer queue |
| Delete a product / service / specialist | Partner products and profile editor |
| Replace the service list with the type defaults | Profile editor: *Load Default Services* and a salon-type change (one shared "Use the default services?" sheet, *Replace* / *Keep mine*) |

Why: a native dialog cannot be themed, ignores the device safe areas, prefixes
the message with the site origin, and is suppressed outright in some installed
PWA contexts — where `window.confirm()` returns `false`, so the button looks
broken instead of asking anything.

Behaviour: a bottom sheet under 520px and a centred card above it; Escape, the
backdrop and Cancel all resolve `false`; a `danger` tone focuses Cancel so an
impatient Enter cannot delete data; focus returns to the control that opened the
sheet; Tab is trapped inside it; and the page behind is scroll-locked (iOS
ignores `overflow: hidden` on `<body>`, so the backdrop also cancels `touchmove`
that starts outside the sheet).

Deliberately **not** confirmed: accepting or declining a booking request and a
delay proposal. Those are already two explicit, labelled choices, and the booking
request runs a 60-second countdown that a second dialog would eat into.

`src/components/ConfirmDialog.test.jsx` covers the dialog behaviour and fails if
`window.confirm`, `window.alert` or `window.prompt` reappears anywhere in `src`.

## 12. Important source locations

| File | Responsibility |
| --- | --- |
| `src/App.jsx` | Auth, session restoration, logout/expiry state, hash routes and push startup |
| `src/lib/api.js` | Mobile-compatible REST client, bearer token and JWT cleanup |
| `src/lib/socket.js` | Shared salon/user live-update socket (room joins, polling→WebSocket) |
| `src/lib/planDetails.js` | Plan catalog and active-subscription normalization |
| `src/lib/devtoolsShield.js` | Swallows the known Chrome DevTools Performance-panel crash (also inlined in `index.html` so it runs before the bundle) |
| `src/lib/razorpay.js` | Checkout loader, amount rules, payment outcomes, UPI hand-off tracking and pending-payment recovery |
| `src/lib/bookingTime.js` | Signed-offset time maths for the queue time update: local wall-clock parsing, hour/date rollover, past-time and day-cross detection, exact-time→offset derivation, human offset labels |
| `backend/` | Standalone Express + Mongoose API for the time change (model fields, clock maths, FCM copy, controllers, routes, tests). Copied into the API repo, not built with the web app |
| `src/components/SubscriptionScreen.jsx` | Plan picker, Razorpay flow, cancellation/failure copy and payment recovery |
| `src/components/ConfirmDialog.jsx` | Promise-based in-app confirmation sheet that replaces every native browser dialog |
| `src/lib/push.js` | Firebase initialization, permission/token flow and notification route mapping |
| `public/assets/brand/naai-mark.svg` | Official MyNaai mark (inherits `currentColor`) used by the in-app brand chip |
| `public/assets/brand/naai-logo-dark.svg` | Official logo on the dark app tile; the default image fallback everywhere |
| `public/firebase-messaging-sw.js` | Background push display and notification click routing |
| `src/components/UserScreens.jsx` | Customer screens, bookings and delay response |
| `src/components/SalonScreens.jsx` | Salon queue, booking request, delay action and partner screens |
| `src/main.jsx` | Root offline shell worker registration |
| `src/styles.css` | Responsive mobile-first layout through large desktop widths, with the device safe-area padding for installed PWAs |

## 13. Validation checklist

Before deployment:

```bash
npm run lint
npm run build
node --check public/firebase-messaging-sw.js
git diff --check
```

Then test on an HTTPS deployment with a real customer and salon account:

- Sign in, reload, close the browser and reopen it.
- Let an expired JWT make an API request and confirm the UI returns to login.
- Sign out and confirm the local session is removed.
- Send a `BOOKING_REQUEST` notification to a salon and click it.
- Send a `DELAY_TIME_PROPOSAL` notification to a customer and test both responses.
- Test push permission denied, browser refresh, foreground delivery and background delivery.
- Confirm the existing offline shell worker still works independently of Firebase Messaging.
- Open **Edit salon profile**: every card starts collapsed with its sub heading visible, `*` marks the required fields, and a failed save opens and scrolls to the offending card.
- Save a new/incomplete profile and confirm it lands on the payment screen; save a complete profile and confirm it returns to **Salon account**.
- On a phone, start a payment, choose UPI, switch to Google Pay/PhonePe, come back and confirm the portal shows *Confirming your payment…* and activates the plan.
- Open Checkout and press back/close: confirm the *Payment cancelled — no amount was charged* notice and that **Continue** starts a fresh order.
- Install to the Home Screen on an iPhone and an Android phone: the app name and the notification bell sit **below** the status bar (not cut in half), the bottom tab bar clears the gesture bar, and the Home Screen icon is labelled "My Naai".
- Tap Logout, Cancel booking, Mark done and Delete service/product: the confirmation is the app's own sheet, with the same dark theme, on both iPhone (Safari and Chrome) and Android.
- Load the home screen with a salon that has no photo (or block the image URLs): the card shows the My Naai tile centred on the branded gradient, never a stretched or half-cropped logo; products and barbers show their neutral placeholder tiles.
- View the app at 320 px and 375 px: plan cards, time slots and every grid keep readable two-column chips, and tapping a login/search/profile field on an iPhone does not zoom the page.
- Check the header wordmark: the M and the N are the same size on the login page, the mobile header and the desktop sidebar.
## 14. Known console noise (not a MyNaai bug)

While Chrome DevTools is open, its Performance panel injects an anonymous helper script that can throw:

```text
Uncaught TypeError: Cannot read properties of undefined (reading 'startTime')
    at et.reportAllChanges (<anonymous>:2:19429)
```

This comes from DevTools itself (the same signature is reported in `angular/angular#70464`), not from the portal — the only `startTime` read in this codebase is `details?.startTime` in `BookingRequestScreen`, which is optional-chained. `index.html` installs a capture-phase guard before the bundle loads and `src/lib/devtoolsShield.js` keeps it active afterwards; both suppress **only** that exact signature (`reading 'startTime'` plus `reportAllChanges`/anonymous source) so real errors still surface. It only appears with DevTools open and never reaches users who do not open DevTools.
