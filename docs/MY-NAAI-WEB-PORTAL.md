# MyNaai web portal guide

This document describes the responsive MyNaai customer and salon-partner web portal, the mobile-app compatibility decisions, and the current notification/time-update workflows.

## 1. What the portal is

The portal is a Vite/React single-page PWA for the two roles already present in the mobile app:

- **Customer**: discover salons, view services and specialists, choose a slot, create booking requests, view bookings, respond to a salon delay request, browse products, **shop the admin's Naai Shop catalog and track those orders**, update the profile and read notifications. The shop is also browsable **and fillable without an account** at `/shop` on the public website: a visitor can add to the cart and keep it on the device, and the account is asked for at the moment of purchase (`/shopCheckout`), where one OTP sign-in also carries that cart onto the account.
- **Visitor (no account)**: the whole storefront (`/shop`, `/shopProduct?productId=…`), the home page's *Shop now* band, the navbar's **Shop** link and the footer's **Shop grooming products** link.
- **Salon partner**: view every booking REQUEST as a lead (received / accepted / rejected / auto-cancelled, with the answer rate) in the **Booking requests** tab, view the live customer queue, open a booking request, accept or reject it, ask the customer to accept a small time delay, mark a service complete, review history, manage products, edit salon details, manage open/closed status, manage a subscription and sign out from the account screen.

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

There is deliberately no multi-second web splash screen — and no login wall. Browsing is public: a first-time visitor (or someone who simply signed out) lands **directly** on the **guest shell** — the same salon discovery list as signed-in customers, plus a `Login / Register` pill and the install pill in the top bar. No startup permission screen stands in front of home; the only permission home itself raises, right as the salon list loads, is the browser's **location** popup — it powers distances and nearest-first sorting (§7). Every other ask (notifications, install) belongs to the **login** page. Signing-in users resume their saved workspace immediately.

The site chrome is a normal business website now (pattern taken from madhuprabhaconstructions.in): every public page ends in a **testimonial carousel** (`TestimonialSection` — swipeable track with prev/next arrows, dots and gentle auto-advance, short starter quotes, mixed customer + salon-owner roles but no locations, place for the owner to swap in real reviews). Each card is built as person → rating → quote (gold initials tile, name, role, then the stars and the quote, with an oversized decorative quote mark behind it), because a name that trailed the quote made a full-width phone card read as an unstructured block of grey text. The active review is index state, so the loop is **circular**: Next on the last review returns to the first and Previous on the first jumps to the last. Phones show exactly **one review per screen**, tablets two (640px+) and laptops/desktops three (900px+) — the wrap accounts for however many are visible, and the dot row doubles as the position indicator with a thumb-sized tap area under each tiny dot and a **multi-column footer** (`SiteFooter`): brand + shared `StoreBadges` (Play Store live, iOS-coming-soon chip) + web note, then **Explore** (Salons near you / About / FAQ / Contact), **Salon partners** (opportunities → `/salon-partner`, Register your salon, Partner sign in — both deep-link `/login?role=SALON` which pre-selects the partner role in `AuthFlow`), and **Support & legal** (`tel:8380017393`, `mailto:mynaai.in@gmail.com` — the support inbox everywhere it appears, including the contact form's `mailto:`, the FAQ answers and the Terms/Privacy contact lines, Terms, Privacy), with the copyright bottom bar. The navbar carries a dedicated **Salon partner** tab for owners; the About page reads like a company about page (welcome story, what-you-can-do, vision, mission, values) with an **About our app** section that reuses `StoreBadges`.

**`/salon-partner` is the salon-owner landing page** (`PartnerScreen`): it explains what a partner gets (nearby discovery, buzzer booking alerts, self-service listing management, calmer queues), the 3-step start (register → go live → receive bookings), and opens partner login/registration via `/login?role=SALON` — the owner's counterpart to the customer home page. Every salon keeps its own full public detail page (`/salon/<id>`, shareable, no login needed to view).

Login is only ever required at **booking intent**: tapping **Book now** on a salon card, **Continue/Login to book** on the salon page, or the bookmark star stashes the exact page in `sessionStorage` (`mynaaiPendingRoute`, see `src/lib/pendingRoute.js`) and opens the login form. OTP completion pops the stash and resumes that exact page via `resolveResumeRoute()` (validated against the role's routes — a customer salon link means nothing to a partner account). The login page itself carries a thin **Browse salons** back-link that returns to the stashed page (never to a gated route — guests bounce off those), so the auth detour never feels like a trap.

### Browser-history routing (no hashes)

The whole portal speaks **real path URLs** — `/` is home, `/salon/<id>` a salon's public page, `/<screen>?<query>` every other screen (`/bookings`, `/privacy-policy`, `/subscription?mode=RENEW…`). All URL creation/parsing lives in `src/lib/routes.js` (`routeToPath` / `parseRoutePath` + the `privacy` ↔ `privacy-policy` segment alias) and is consumed by `getRouteFromPath`/`navigate` in `src/App.jsx`. Old `#/…` links shared before the switch (including every notification tap written by the hash era) still open: `readLocationRoute()` upgrades them to the clean path with a `replaceState`. Navigation helpers used outside React (push notification taps, the service worker pipe) call `softNavigate(path)` — `pushState` + a synthetic `popstate` the router listens for.

**Protected/unprotected routing:** guests may open `home`, `salon`, `shop`, `shopProduct`, `shopCart`, `shopCheckout`, `about`, `faq`, `terms`, `privacy`, `contact` (plus `/login`); anything else — including `/shopOrders`, because order history belongs to an account — is stashed and bounced through login. `/shopCheckout` is public only because it renders the **purchase gate** for a visitor: the address and payment form is never shown without a session. Signed-in sessions resolve only their role's route list, can never see the public navbar (`/login` → dashboard home) and only logout returns to the public site.

**Deployment:** the dev server serves `index.html` for every path automatically; production must do the same (the repo ships `vercel.json` with a catch-all rewrite and `public/_redirects` for Netlify; for nginx: `try_files $uri /index.html;`). The service worker's navigation handler also falls back to `/index.html` offline.

Every salon has its own shareable link: `/salon/<salonId>` — the **Share** affordances (salon card footer, salon page header) use the native share sheet where available and copy to the clipboard otherwise. A guest opening a shared link lands directly on that salon's page — per-salon discovery links are a marketing channel, so they must never hit a login gate.

The informational pages `/about`, `/faq`, `/terms`, `/privacy-policy`, `/contact` are public too (no login gate). **Terms & Conditions** and **Privacy Policy** are separate full legal pages (effective date 09 January 2026, India support contact) rendered as document-style screens (`legal-screen`); the login legal sentence links both. The guest shell is a small modern site — a sticky blurred **navbar** that is a single non-wrapping row at every width (logo → home, desktop centre links *Home / About / Contact* with an active underline, install pill + a single **Login** pill + the menu toggle). Below 820px the four route links fold into a dropdown panel opened from a hamburger (`.site-nav-toggle`, `aria-expanded`/`aria-controls`, closes on navigation, Escape and any tap outside) while the brand, Install and the **Login** pill stay pinned in the bar — the old one-row bar overflowed a 320–430px phone and pushed the Login pill off the screen. The wordmark collapses to the mark alone beneath 820px and Install becomes an icon button; the routed page follows, then `SiteFooter`. Guests fetch discovery from the token-free twin endpoint `POST /api/salons/salon-list-public` (same payload as `salon-list`; signed-in customers keep the personalized `/salon-list`). All public pages end in the website footer (`SiteFooter` in `src/components/UserScreens.jsx`): brand, **Get the app** Google Play badge (`https://play.google.com/store/apps/details?id=com.mynaai`), a dashed **iOS — coming soon** badge with a note that the web app already works everywhere, quick links incl. Privacy Policy, the support number and the copyright bar. The PWA manifest uses `start_url: "/"` with standalone display, so an installed app with a saved session opens straight into the dashboard. Layout rails follow the shared 1460px `.screen` max-width with the responsive 1/2/3/4-column salon grid (phone → desktop). Salon discovery is **paged**: the list endpoints return 20 records per page (the mobile app's page size) and the home grid now keeps asking for the next page — `page` moves past 1, the sentinel under the grid auto-loads as the visitor scrolls (with a **Load more salons** button as the explicit fallback), the header count reads `N of M places` when the API reports a total, and a short-but-not-empty page ends the list with *That's every salon we found near you*. Every page is de-duplicated by salon id, so an API that ignores `page` cannot repeat the same twenty cards; `readSalonPagination()` accepts an explicit `hasMore` flag, `totalPages`/`pages` or a total count, and falls back to the full-page rule the app uses. The footer also splits **Explore** and **Salon partners** side by side below 560px (brand and Support & legal keep the full width), and `/faq` answers well over a dozen questions.

The web session uses these keys:

| Key | Purpose |
| --- | --- |
| `mynaai` | JSON-wrapped bearer access token, matching the mobile storage shape |
| `mynaaiUser` | Last authenticated user/salon object |
| `userType` | `USER` or `SALON` |
| `isLoggedIn` | Boolean-like string used to restore the session |
| `isNewSalon` | Salon registration state |
| `FCM_TOKEN` | Trimmed diagnostic copy of the last confirmed browser token; never an auth fallback |
| `mynaaiPendingRoute` | Session-scoped stash of the path a guest must resume after login (§3) |
| `mynaaiReminderList`, `mynaaiBookingRemindersEnabled` | Stored 30-minute reminder schedule + the Account-screen switch state (§3) |

A successful OTP verification/onboarding stores the token and role. A browser restart therefore preserves the login until the API token expires or the user signs out. If the API returns `JWT_FAILED` or another JWT failure response, `src/lib/api.js` clears the stored session and dispatches `mynaai:session-expired`, which immediately returns the React app to authentication. A manual logout also deletes the browser FCM token.

The app listens for relevant `localStorage` changes, so signing out or changing the session in another tab updates the open tab as well.

### Required browser notifications

There is exactly **one** notification permission funnel, and both push and booking reminders ride it. The login experience offers a visible **Booking alerts** row with one tap when notification permission or token setup needs attention; authenticated pages stay focused on their work, the **Alerts & permissions** card in either Account screen manages both permissions afterwards, and account-screen controls (the reminder toggle) re-ask only when permission is still neutral. Technical Firebase configuration details are never shown to users; the state fixes itself the moment the browser reports a change, without a reload or a re-login.

The login screen keeps reading to a minimum — phone users tap buttons, not paragraphs: a one-line subtitle, then two compact pills. `AllowAlertsButton` owns the notification permission sign-in depends on: one tap opens the browser's own Allow popup when it has never been asked, or the permission gate with the exact fix for that device (per-browser unblock steps, Add-to-Home-Screen on iPhone, open-in-new-tab when the page is embedded); the pill follows the live Permissions API and disappears once alerts are on, turning red as **Fix alerts** while blocked. `InstallControl` (rendered as the login pill, the sidebar row and the hamburger-menu entry) keeps install one tap away, and *always answers the tap*: it fires the captured native prompt when the browser still has one, and otherwise opens the 2–3 step guide for the detected browser (`INSTALL_STEPS`; iPhone gets the Share → Add to Home Screen sheet). The prompt is owned by `src/lib/install.js`, which uses it once (a spent `beforeinstallprompt` used to throw and leave the button dead), says **Opening…** while the browser's dialog is up, treats a dismissal as a decision (no nagging) and races the dialog against a 1.2 s timeout — a suppressed prompt can no longer look like a frozen page, it explains itself and shows the manual steps. Once the app runs standalone, install UI disappears by itself. The guest shell's top bar carries the same pill.

Customer and salon authentication is never blocked on web push. The login page asks for booking alerts with one labelled tap (and the Continue tap counts as one when the permission is still unanswered), the live Firebase token is sent as `deviceToken` in the OTP verification/onboarding contract, and a trimmed `FCM_TOKEN` copy is diagnostic only — it is never used when Firebase cannot confirm the current subscription. A visitor whose browser has blocked notifications still signs in; if the API insists on a token, a short sheet gives the exact fix and retries the request automatically.

### Booking reminders (the 30-minute alarm)

`src/lib/reminders.js` schedules a per-booking reminder **30 minutes before the slot** (`REMINDER_MINUTES_BEFORE`) using the same notification permission as push — no second funnel. Confirming a booking schedules it (`scheduleBookingReminder`, fire-and-forget so booking never blocks on it); cancelling a booking clears it (`cancelBookingReminder`); page reloads re-arm survivors from `localStorage` (`armStoredReminders`, mounted once in `AppRoot`). On browsers with `TimestampTrigger` the OS itself fires it even when the tab is closed; elsewhere an in-page timer falls back. The Account screen's **Booking reminders** switch (`remindersEnabled`/`setRemindersEnabled`) is the user control — turning it on while the browser permission is neutral is the moment the OS prompt is requested.

### Incomplete salon profile guard

After salon login, `isNewSalon` or `profileCompleted: false` routes to **Complete salon profile** before the queue/dashboard is rendered. The editor requires owner/salon/contact/type/address information, valid services and specialists, browser coordinates, and valid hours. A successful update clears the incomplete flag and moves the partner to the subscription choice before normal salon navigation.

## 4. Salon queue changes

### Walk-in customer is disabled

The walk-in customer flow is not exposed in the web portal. The legacy `walkInBooking` API method remains only because the REST client must preserve the mobile API surface; no screen calls it.

### The queue card is single-column, on purpose

An iPhone was showing the customer name, the appointment date and time as nothing at all — only **Update time** and **Done** rendered. Two faults stacked up in the old markup:

1. The heading row was `display: flex` with the identity block and the action buttons as siblings, and the buttons were `flex: none`.
2. The `@media (max-width: 420px)` rule then gave the button row `width: 100%` — inside a row that could not wrap. The identity block was the only child allowed to shrink (`min-width: 0`), so on every iPhone (375–430px, and 320px SE) it collapsed against its own `text-overflow: ellipsis`, and the 9px date line wrapped into an unreadable sliver.

`.queue-card` is now a single column: identity (initials tile, name, date + time + urgency chip), a details block (services, specialist, tap-to-call number), then the action row. Nothing competes with the buttons any more, so no width override is needed and the same order reads top to bottom on a tablet and a desktop table (details go three-across from 760px). Body copy moved from 9px to 11–13.5px, names wrap instead of truncating, and both actions are 46px tall.

The queue payload is unchanged — this is layout, not data. `queueNumber` is still returned and still not rendered (see above).

### Token number is no longer displayed

Queue token numbers are not shown in the portal. The queue now focuses on the customer name, appointment date/time, services, specialist and phone action. The summary card shows the next appointment time and customer instead of a token number. The API may still return `queueNumber`; it is simply not rendered by the web UI.

### Customer history shows the customer's mobile

The **Customer history** tab (`SalonHistoryScreen`) used to show the customer's
name, the date, the services, the specialist and the time — everything except the
one thing a salon actually needs to act on an old visit: the customer's number, to
call them back or to answer "who was that?" about yesterday's queue.

Each row now carries the mobile beside the barber and the time, as a **tap-to-call
link**:

```
Amit Jichkar                        04 Nov 2026
Haircut, Beard trim
[Ravi] [11:30 am] [📞 +91 98765 43210]
```

- **No backend change was needed.** `GET /api/booking/get-completed-bookings`
  already returns `userPhone` — the registered customer's number, or the number
  typed in for a walk-in (`salonOwnerCompletedBookings` in the API repo).
- **The site sends it as `tel:+919876543210`**, i.e. with the country code, so a
  tap dials from any phone. Ten-digit mobiles are printed the way they are read
  aloud (`+91 98765 43210`); anything that is not a ten-digit mobile is shown as its
  own digits rather than guessed at.
- **`0000000000` is never printed.** The API sends that literal placeholder when a
  walk-in left no number; a fake number on a row both reads as a bug and dials
  nothing, so the chip is simply absent and the rest of the row stays.
- **The number is read from whichever key the row carries** —
  `userPhone` (what the API sends today), `userPhoneNumber`, `customerPhone`,
  `mobileNumber`, `phoneNumber`, `walkinPhone`, or a nested
  `user.phoneNumber` / `customer.phoneNumber`. `src/lib/customerPhone.js` owns that
  contract, and the same helper formats and validates. The queue card keeps its own
  bigger **Call customer** block (with its own "Not provided" state), unchanged.

Tests: `src/components/SalonHistory.test.jsx` (7) — the row prints the number as a
`tel:` link and leaves the rest of the row alone, a walk-in's `0000000000` prints
nothing at all, and the helpers normalise `+91 98765 43210` / `919876543210` /
`098765 43210`, format ten-digit mobiles, and refuse to build a link out of an empty
or all-zero number. The dev preview
(`MYNAAI_DEV_MOCK_API=1 npm run dev`) now answers that endpoint with three rows — a
registered customer, a walk-in with a number, and one with the placeholder — so the
behaviour is visible without a backend.

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
| New salon / profile not completed | none or expired | **Payment screen** (`#/subscription`) — free onboarding trial first (90 days unless the admin changed it), then the paid plans |
| New salon / profile not completed | already active | **Salon account** (`#/account`) — never a second payment for the same save |
| Complete profile (routine edit) | any | **Salon account** (`#/account`) |

Sign-in, session restore and the salon account screen all force an incomplete profile back into this editor (`isNewSalon` / `profileCompleted === false`, or a profile missing owner name, salon name, address, salon type, coordinates, services or business hours), so a new salon always reaches the editor first and the payment screen second.

### Live updates socket

Both realtime screens (salon **Customer queue** and customer **My bookings**) share one socket.io connection managed by `src/lib/socket.js`. It mirrors the mobile app's global socket approach: it joins the `join_salon`/`join_user` room for the signed-in identity, re-joins rooms after every reconnect, listens for `queue_updated`/`booking_status_updated`, and starts with polling before upgrading to WebSocket so a blocked `wss` upgrade degrades to polling instead of failing (the earlier websocket-only connections produced "WebSocket is closed before the connection is established" during React StrictMode remounts and never recovered behind proxies without an upgrade path). Local development connects same-origin through the Vite `/socket.io` ws proxy; production uses `VITE_API_BASE_URL`. The connection is rebuilt on logout and session expiry.

### Plan prices

One price list serves the whole portal, and it is no longer compiled into the bundle: `src/lib/planCatalog.js` reads it from the backend (`POST /api/salons/plans/list`, no token) and falls back to the seed values only when that call fails. The admin panel owns the rows — prices, durations, notes, ribbons, order and the free-trial length — so a price change reaches the website and the app on their next load instead of needing a release. The seed is **₹199 / 1 month**, **₹299 / 2 months**, **₹499 / 3 months**, with the free trial at **90 days**. `RENEWAL_PLANS` and `PARTNER_PLANS` are both derived from the same catalog entries and only override the supporting note, so a renewal costs exactly what a new purchase costs and a plan cannot be advertised at one length and granted another. The catalog response is cached under `mynaai:plan-catalog:v2` for offline use, and durations are always re-derived from the day count (a backend row carrying only `days: 90` still renders as "3 Months (90 Days)").

- Backend contract (table, endpoints, amount guard, migration):
  [`docs/BACKEND-SALON-PLANS-API.md`](BACKEND-SALON-PLANS-API.md).
- The tab that edits it: [`docs/ADMIN-PANEL-SALON-PLANS.md`](ADMIN-PANEL-SALON-PLANS.md).
- The app reading the same list: [`docs/APP-SALON-PLANS.md`](APP-SALON-PLANS.md).

### Active plan display

`src/lib/planDetails.js` keeps the plan catalog (same ids, titles, prices and durations as the mobile `SubscriptionsPlan`/`RenewalSubscriptionsPlan` screens) and normalizes the subscription fields returned by `get-salon` (root fields such as `planType`/`planExpiryDate` or nested `subscription`/`plan` objects). The **subscription record's own fields — `isPlanActive` / `planStartDate` / `planEndDate`, exactly what `renew-salon-plan` rewrites on every renewal — are the arbiter** for whether the plan is over: `isPlanActive: true` is absolute (the renewal modal never shows while the flag is live — not even once `planEndDate` passes, and no date timer is armed against it), and without a live flag `planEndDate` is the hard bound of the window. Stale signals around them (a `subscriptionExpired` cache flag written before the renewal, a legacy `planExpiryDate` left at the salon root, a `PLAN_EXPIRED` status echoed from a cached document) never lock a salon whose record is live. The salon account screen shows an active-plan card (plan title, price, start/expiry dates, days remaining, status, manage/renew action) and the profile editor shows a compact plan strip. When the backend response carries no plan fields, the account screen falls back to a "Plan details unavailable" card that deep-links to the subscription picker instead of guessing.

## 6. Salon subscriptions and onboarding

The subscription route follows the mobile `SubscriptionsPlan` contract:

- An incomplete, already-created salon is sent to the profile editor first. After a successful profile save, the partner sees the free trial as the backend defines it — **90 days** by default, whatever the admin panel has set — and can start it without opening Razorpay. The editor clears the incomplete-session flag while keeping the partner on the subscription route; the free-plan action then refreshes the authenticated hash route into the salon queue.
- A new salon reaches the same route after registration OTP, with the temporary token returned by `verify-otp-register`. Paid plans first call `POST /api/salons/create-payment-order` with the plan amount in INR, open Razorpay Checkout with the returned order ID, and send the payment ID, order ID and signature to `POST /api/salons/create-salon-with-plan` with the temporary bearer authorization. The response must contain both a salon ID and a permanent session token; otherwise the portal does not mark registration as complete.
- A logged-in partner can choose a renewal plan from the account subscription entry. The browser creates the Razorpay order and sends `{ planType, paymentId, totalAmount }` to `POST /api/salons/renew-salon-plan` with the persisted salon session. A successful renewal returns to the partner account without replacing the session with a temporary token.
- An expired salon subscription is a hard partner-side paywall. On restore/login the portal revalidates the salon plan before mounting queue, history, products or account; an expiry date/status or a backend `PLAN_EXPIRED` response replaces the entire salon shell with the renewal payment screen. Every path into the forced screen (`mode=RENEW&forceRenewal=true`) re-checks the subscription record first — `isPlanActive` / `planStartDate` / `planEndDate` — so a stale `PLAN_EXPIRED` signal or a bookmarked paywall URL cannot lock a partner whose plan is active; the renewal screen itself does the same check and drops its "expired" copy when the record is live. `src/lib/api.js` performs the same global response-interceptor check as the mobile Axios client on every API call, including failed HTTP responses, with a one-time redirect guard. The forced screen has no back/navigation path and remains in place until renewal succeeds — but it is never a dead end: both of its sign-out controls (the expired-plan notice and the footer of the renewal card) ask for the standard in-app confirmation and then land on the **login page** with the salon role preselected (`logoutToLogin` in `src/App.jsx`), where the partner can sign back in with one OTP or take the page's own **Browse salons** link to the public website. Signing out clears exactly what a normal logout clears (token, session mirrors, device-token sync, live-updates socket). Customer sessions never enter this payment flow.

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

One notification permission does everything: booking alerts (the backend stores the browser's `deviceToken`), the salon buzzer, delay requests, and the 30-minute booking reminders (§3). It is asked compactly and always with a working next step — a labelled button on the login page, in the same tap as Continue with OTP, on the salon registration steps, and later from **Alerts & permissions** in either Account screen. Location is a separate, optional row asked in context (**Use my location**, the salon address editor, salon signup) and a dismissal is remembered:

- **Alerts depend on being configured.** The push wiring needs the Firebase web config + public VAPID key (see `docs/FIREBASE-WEB-PUSH.md` and `.env.example`). Until those values are set for a deployment the *permission* is still asked for on the login page and in the salon steps (the visitor can grant it, and the button opens the browser prompt as usual) — but no device token can be minted, so the Account card says **Notifications allowed — alerts not switched on yet** instead of claiming alerts arrive, and the buzzer test is hidden. The moment the values land, the whole funnel lights up with no code change.

- **Embedded page (preview pane, in-app browser)** — browsers refuse to show a permission popup inside another page's frame unless the embedder delegates the feature (`allow="notifications"`), and they answer `denied` to every question instead. The app reads the effective Permissions Policy (`document.permissionsPolicy` / `featurePolicy`) to tell "this frame cannot ask" apart from "the visitor blocked us", so the login row says **Notifications need their own tab** with an **Open in a new tab** action (and the sheets switch to a three-step "open it in its own tab" walkthrough) rather than sending people through browser settings that were never the problem.

- **Never asked yet** — the login page's **Notification permission** row (button **Allow notifications**) opens the browser's own popup inside that tap (`Notification.requestPermission()` is called synchronously so Safari keeps the gesture), and the same tap as **Continue with OTP** asks if it is still unanswered. The salon registration steps and the Account reminders switch offer it again later.
- **Blocked** — a browser will not show its prompt a second time, so the row becomes **Fix alerts** and opens the sheet: three short steps for the browser actually in use (Chrome on Android, Chrome/Edge/Firefox/Opera desktop, Samsung Internet, Safari and Chrome on iOS, Safari desktop), an **I allowed it — Try again** that re-reads the *live* permission (no reload, no logout), an extra-help disclosure, a reload escape hatch and the support number.
- **iPhone** — web push only exists for Home Screen apps, so the sheet gives the Add-to-Home-Screen steps rather than pointing at a Settings toggle iOS does not have.
- **Sign-in is never blocked.** A visitor whose browser has blocked alerts still gets their OTP. Only a `deviceToken` refusal from the API re-opens the sheet, with one plain sentence on the form and an automatic retry of the same request once a token lands.
- **Allowed means allowed.** The moment the browser's popup is answered with **Allow**, no surface may show an error about it: the login row removes itself, and minting the device token — our half of the job — is retried quietly in the background. A push subscription left behind by an older release is rebuilt rather than failing forever, every surface is told through the `mynaai:push-token` event, and if a sheet does appear it says **Alerts are allowed — finishing setup** with the real reason (no internet, a rejected VAPID key, a worker that will not start) as the Support report also records. "The last setup step did not finish — switch Notifications back on" is gone: it sent people who had already allowed alerts hunting through settings that were already correct. The live permission read is equally forgiving on the one platform that lies about it: an **installed iPhone app** can keep answering `prompt` through the Permissions API after a real grant, so a `granted` from either source wins — otherwise the portal keeps insisting *turn on booking alerts* to somebody who just tapped Allow, and never mints the token.
- **The buzzer is testable without signing in.** The partner landing page (`/salon-partner`) and the login page carry **Test booking buzzer** — the same one-tap check the salon gets in Account → **Alerts & permissions**. It plays the real WAV and the alert a booking request produces, so a device can be proven before an account exists, which matters most on iPhone: iOS only grants a notification permission to an app that is running, so a login wall made the buzzer unverifiable there. Signed in, **Send test alert** goes one better and pushes a real notification to this device's own token — the only check that covers the closed/background case (it uses the optional `POST /api/notifications/test-push`; without that endpoint the card says the server did not accept it instead of failing silently).
- **The buzzer is an alert, not a backlog.** It sounds at the moment the notification arrives and never when the app is reopened: nothing is queued while the page is in the background (a suspended AudioContext would flush the alarm on resume), pending bursts are cancelled when the page hides, and unlocking audio is silent. The service worker still raises the notification with sound + vibration for the window in which a page cannot play audio, and one push is turned into sound in exactly one place, so a booking request can no longer buzz twice.
- **The buzzer is device-specific.** Allowing the permission is not the whole story: the sheet names the Android app-level switch (`Settings → Apps → Chrome/Samsung Internet → Notifications`), the iPhone silent switch and the desktop volume, and the **Alerts & permissions** card can **Test buzzer** on the spot — the same notification + sound a booking request produces. Browsers on iOS that cannot receive web notifications at all (Chrome, Firefox, Edge) are routed to Safari → Add to Home Screen.
- **Location is optional and asked in context.** It powers distances and nearest-first sorting on discovery (the **Use my location** button), the salon address editor (**Allow location**) and salon signup. Each of those reads the live permission first: never-asked prompts, already-blocked shows the three-step settings sheet (a blocked permission can never be re-prompted — this is what made the old "Enable location" button look dead), and a granted permission just takes a fresh fix, which is handed straight to the salon list so distances appear without a second load. `requestLocation()` retries once with a longer timeout for a cold laptop fix. **Not now** is remembered, the app never nags, and the home list shows the unsorted salon list with an unobtrusive notice instead.

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

The booking-request screen only exists during the five-minute response window. Once a booking is accepted it lives in the **Customer queue**, and until now a salon that fell behind had no way to tell the customer. Every queue card therefore carries an **Update time** action next to **Done**.

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

Sending calls `api.salonUpdateBookingTime()`, which posts to the **queue time-update endpoint** — not to `owner-action`:

```http
POST /api/booking/salon/queue/update-time/{bookingId}

{
  "time": "18:15:00",
  "date": "2026-09-07",
  "reason": "Chair free early"
}
```

The salon sets the time and it is done. The backend writes it to the booking, moves the queue row with it, and notifies the customer — there is no accept/decline round trip, because the appointment is already confirmed and the salon owns the chair. Requests are addressed by `bookingId`, which is what every queue row carries. The row updates optimistically, rolls back on failure, and reloads so the Today/Tomorrow grouping is right after a day cross.

**Backend.** A ready-to-paste Express + Sequelize controller for this endpoint lives in [`backend/salonUpdateBookingTime.js`](../backend/salonUpdateBookingTime.js). It is not part of the web build; drop it in next to the other booking controllers. What it does, in order:

- refuses the only two states a time change cannot follow — `completed` and `cancelled` — with *"Booking is already Completed/Cancel you can't update time"*;
- resolves the new slot itself (`time`, or `offsetMinutes` for clients that still count minutes), handles the midnight rollover, and rejects a slot in the past or more than four hours away;
- writes the booking **and its queue row** in one transaction, and settles a leftover `delay_requested` booking back to `confirmed`;
- notifies the customer **in-app** (`Notification` rows) and by **FCM push** (`BOOKING_TIME_UPDATED`), with copy chosen by direction — an earlier time reads *"Glow Studio can take you earlier — please come at 6:15 PM instead of 6:30 PM"*, never *"delayed by -15 minutes"*;
- emits `booking_status_updated` to `user_{id}` and `queue_updated` to `salon_{id}`, so the customer's My Bookings screen and the salon's queue both refresh without a pull.

A push failure never fails the request: the time is already written, and a salon whose "Update" button errors out after the write would just press it again.

The **booking-request** delay proposal is the one flow that still asks the customer something. It arrives as `DELAY_TIME_PROPOSAL` and is answered in the app:

1. A notification click opens `#/delay?bookingRequestId=...&delayMinutes=...&proposedTime=...` (optionally `&reason=...`).
2. The `DelayRequestScreen` lets the customer accept or reject the proposed time. It reads the **sign** of `delayMinutes`, so an earlier offer is worded as one, spells the shift out in words ("15 minutes earlier" — `+20`/`-20` is easy to misread on a phone) and shows the salon's optional message.
3. The response calls `POST /api/bookingRequest/customer-delay-response/{bookingRequestId}/` with `{ "action": "ACCEPT" }` or `{ "action": "REJECT" }`.
4. The customer is returned to `#/bookings`.

## 8.0 Website chrome stays on the website

The review carousel and the multi-column footer are how the **marketing site**
closes a page (`SurfaceProvider` in `src/components/Shared.jsx`). The panel is the
app: it ends at its own bottom navigation, and on a phone the footer sat under
that fixed bar where it could not even be reached. Reported from the device as
"the website footer and testimonial are showing in the Discover tab after login".

Three locks, so it cannot come back:

1. `SiteFooter` returns `null` and `TestimonialSection` renders nothing when
   `useIsAppSurface()` is true — the shell sets `SurfaceProvider value="app"`.
2. The screens themselves ask for a guest: `HomeScreen` renders both behind
   `isGuest`, and `SalonDetailScreen` renders its footer behind
   `!session?.userId`, so a signed-in customer never sees them even if the shell
   around them changes. Both blocks stay exactly as they are on the public site.
3. A stylesheet lock — `.app-shell .site-footer, .app-shell .testimonial-section
   { display: none !important; }` — covering any future screen that mounts them by
   accident.

Tests: `src/App.test.jsx` mounts the real app and asserts the panel's Discover tab
has neither block (and no "What customers & salon owners say" text), that the
guest site still does, and that an info page inside the panel has none either.

## 8.1 Booking checkout — Pay at Salon

The last step of the customer booking flow (`ScheduleScreen` in
`src/components/UserScreens.jsx`) is a checkout: barber (optional), date, time,
**Payment**, then the sticky **Review & confirm** bar with the estimated total.
Payment used to be invisible until the salon counter; it is now a stated part of
the checkout.

**A review card stands between the bar and the API call** — `Review your booking`,
built on `Modal` with `.booking-review*` styles. Nothing is sent until the button
inside it is tapped, so the last thing read before the request leaves is a
line-by-line statement of what is being asked for:

| Line | What it says |
| --- | --- |
| Salon | name, plus the address/city the customer scrolled past earlier |
| Services | one row each, with its own price |
| Estimated total | the sum of those rows, the same number the sticky bar quoted |
| When | date, time, duration (the sum of the service durations) |
| Barber | the specialist chosen, or **Any available barber** |
| **Pay at Salon after Service** | `Pay ₹ N at the salon after your service — cash, UPI or card, whichever the salon accepts. Nothing is charged now.` |

The footer is `Back` (closes the card, sends nothing, and the bar opens it again)
and `Send booking request` (the only path to `createBookingRequest`, with its own
sending state). The bar itself no longer calls the API: it validates the slot and
services first — an empty time or an empty service list is refused with the same
message as before — then opens the card. Closing the card leaves nothing behind;
submitting closes it and lands on the *Request sent* screen.

- **One method, preselected: "Pay at Salon".** My Naai takes no payment for a
  booking (Terms §4; Privacy §2 says no card, UPI, wallet or bank details are
  collected), so the option is the only one and it is checked. It is rendered as
  a real `radio` inside `.schedule-pay-options` — the same shape as the shop's
  payment options — so an online method, if one is ever offered, drops into the
  same group instead of needing a new design.
- **The amount is named before you confirm.** The card says
  `Pay ₹ N at the salon after your service — cash, UPI or card, whichever the
  salon accepts. Nothing is charged now.` The sticky bar repeats
  **Pay at salon** under the total, so the last thing read before confirming is
  how the money is paid.
- **No payment form.** The only `<input>` on the checkout is that radio: no card
  number, expiry, CVV, UPI id or bank field exists, and a test fails if one is
  added without a deliberate decision.
- **Nothing payment-related is sent to the API.** `createBookingRequest` keeps its
  contract (`salonId`, `barberId`, `bookingDate`, `bookingTime`, `services`) — the
  backend stores no payment mode, so the method is a statement of fact to the
  customer rather than a record. A booking record that should carry
  `payment_mode: PAY_AT_SALON` is a backend change, not a web one.
- **The confirmation repeats it.** The *Request sent* screen adds
  `Pay ₹ N at the salon after your service — nothing was charged now.` beside the
  existing "your slot is held" and "we will alert you" points.

Styles: `.schedule-pay-options`, `.schedule-pay-option`, `.schedule-pay-icon`,
`.schedule-pay-copy`, `.schedule-pay-tick`, `.schedule-pay-note`,
`.schedule-total-pay` for the method; `.booking-review`, `.booking-review-salon`,
`.booking-review-services`, `.booking-review-total`, `.booking-review-facts`,
`.booking-review-pay`, `.booking-review-actions` for the review card — all in
`src/styles.css`, in the booking gold palette (the shop's `.shop-pay-*` is the
green equivalent).

Tests: `src/components/BookingFlow.test.jsx` — preselected option with the summed
amount, no card/UPI fields, the method repeated after the request is sent, and the
review card: it shows salon, services with prices, timing, barber and total; it
names the chosen barber instead of "any"; it carries the *Pay at Salon after
Service* note with the amount; `Back` sends nothing and can be reopened; and
`createBookingRequest` is called exactly once, from the card's own button, with
no `paymentMode` in the payload.

## 8.2 Salon → Booking requests (leads)

Requests and bookings are different things and different tables: a **request** is
a lead a customer sends, with a one-minute window to answer; a **booking** is the
chair that exists once the salon accepts (the queue and History read those). The
salon's new **Booking requests** tab (`SalonLeadsScreen` in
`src/components/SalonLeads.jsx`, route `/booking-requests`) is built on the
request side only.

- **The counters first**: Received · Accepted · Rejected · **Auto-cancelled**,
  plus an answer rate. Auto-cancelled is deliberately its own number — a request
  nobody answered is not a rejection, and folding the two together hides exactly
  the problem the tab exists to expose. A customer's own cancellation is a third
  bucket.
- **A live request is answered ON the card** (`Accept` / `Reject`, one tap, the
  same `owner-action` contract the notifications screen and the mobile app use).
  Opening anything first would be a step the salon does not have time for: the
  window is five minutes. An answer shows on the card immediately (a local override
  applied over every refresh) because the list API can answer a beat behind the
  action.
- **`Details` is read-only** (`src/components/LeadDetailSheet.jsx`): customer
  name, mobile (tappable), date, time slot, barber (or "any available
  specialist"), the services with prices and the requested value, plus what
  became of the request. No countdown, no Accept / Reject, no `Update time` — a
  request from last month cannot be answered, and the sheet never pretends
  otherwise. It is a sheet on the list, so closing it returns to the list (it used
  to navigate to the live-answer screen, whose back button dropped the salon in
  the Queue tab).
- **Only an answerable request has an answer.** The card and the sheet read the
  same rule (`leadView`): the server's status must still be open *and* the
  one-minute window must still be running. Accepted, rejected, cancelled,
  auto-cancelled and month-old pending requests render with their outcome and no
  buttons at all, so the salon is never offered an action the server will refuse.
- **It works on today's backend.** `POST /api/bookingRequest/salon/list` is the
  preferred source (`src/lib/api.js` → `salonBookingRequestList`); where that
  endpoint is not deployed yet the screen falls back to the notifications feed,
  keeps only `BOOKING_REQUEST` rows, and says so in one quiet line. Accept and
  Reject already work there, so the tab is useful before the backend ships.
- **It refreshes itself** (20 s poll, plus a 1 s tick so a countdown and the
  window's expiry are honest while the salon watches).
- States, filters and the status vocabulary live in `src/lib/bookingLeads.js`
  (`leadStateFromStatus`, `leadView`, `summarizeLeads`, `filterLeads`) — the same
  helpers the tests use, so the words on the card cannot drift from the numbers.
- **The live-request screen** (`BookingRequestScreen`, route `/bookingRequest`,
  opened by a booking-request push or from a notification) applies the same rule:
  while the window runs it shows the countdown and Accept / Reject / Update time;
  once the request is answered or the minute has passed it shows the outcome and
  the request's facts with **no actions**, and its back button goes to
  **Booking requests**. Accepting from it still ends in the Queue — an accepted
  request *is* a booking, so that is the one place the queue is right.
- **My Naai can answer for a salon.** When a salon's phone is unreachable and the
  customer is at the counter, an admin answers the request from the panel
  (`POST /api/bookingRequest/admin/action/:id`). It runs the *same* locked
  transaction the salon's own Accept runs, so one request still becomes exactly
  one booking, and the request row records who answered
  (`acted_by_role = ADMIN`, `on_behalf_of_salon`, `admin_note`). The salon is
  notified and its own tab reads **"Accepted by My Naai"** — the customer's
  notification keeps the salon-facing wording. The admin's answer is not a second
  write path, it is a second door onto the first.
- Backend contract: [`docs/BACKEND-BOOKING-REQUESTS-API.md`](BACKEND-BOOKING-REQUESTS-API.md)
  (list, summary, admin doors, the admin-answer endpoint, the auto-cancel
  sweeper). Admin panel tab:
  [`docs/ADMIN-PANEL-BOOKING-REQUESTS.md`](ADMIN-PANEL-BOOKING-REQUESTS.md).

## 8.3 One product-category list (admin → website → app)

The shop's **Category** filter is the admin panel's list, not the website's
opinion. `src/lib/shopCategories.js` is the reader: it fetches
`POST /api/shop-categories/list` (public twin for visitors), caches the answer in
`localStorage`, and renders the select from it. Before the first answer — or on a
deployment without the endpoint — the seed list is used, which is the same seven
ids, labels and order the backend patch inserts, so the two never disagree.

- A category added in the admin panel appears in the filter on the next load, with
  no front-end deploy.
- A product filed under a category the list no longer has still gets its own
  filter entry (the storefront appends those itself), so nothing silently lands
  in "All".
- A product whose stored `category` is a **label** rather than an id ("Waxing
  products") is resolved through this list before it is filtered or labelled
  (`resolveCategoryValue` / `resolveProductCategory` in
  [`src/lib/shopCatalog.js`](../src/lib/shopCatalog.js)), so the shop's filter
  and the admin panel's Category filter return the same products and the same
  count.
- Backend contract (table, endpoints, slug rule, delete/reassign rules):
  [`docs/BACKEND-SHOP-CATEGORIES-API.md`](BACKEND-SHOP-CATEGORIES-API.md).

## 8.4 Booking steps that survive Back, and the scroll that went away

Two customer reports, both from the salon booking flow.

**"I go back to change the service but the services are not showing."** The
booking steps only knew about the salon because the previous screen handed the
whole record over in memory (`navigate('services', { salon, salonId })`). The
router never puts objects in a URL, so anything that made the browser re-read the
address — Back, forward, a refresh, a shared link — landed on `/services` or
`/schedule` with no record and therefore an empty page.

Both steps are now addressable on their own terms, and the record is re-derivable:

| URL | What it carries |
| --- | --- |
| `/services?salonId=salon-42` | which salon's menu to show |
| `/schedule?salonId=salon-42&services=svc-1,svc-2` | the salon and the services ticked so far |

- `src/lib/routes.js` knows `SALON_BOOKING_SCREENS`; `parseRoutePath` turns
  `?services=a,b` into `params.serviceIds` and `routeToPath` writes the list back
  as a plain comma-separated string (not `a%2Cb`). Only ids travel in the URL —
  the salon record never does.
- `useBookingSalon(params)` resolves the salon in three steps: the in-session
  record, then the module-level `bookingSalonCache` (so Back is instant and needs
  no request), then `api.salonByIdInfo({ salonId })`. Only the third shows a
  loading state — a `Spinner` with *Loading services* / *Loading the salon* — and
  a failure shows an `EmptyState` with *Back to salons*, never an empty list.
- `bookingSelectionCache` remembers the ticked services, so stepping back from the
  schedule re-ticks exactly what was chosen; it is cleared once the request is
  sent.
- On `/schedule`, `serviceIds` from the URL are resolved against the salon's own
  menu (`useMemo`), so names, prices and durations after a reload are the salon's,
  not remembered ones. `createBookingRequest` also falls back to the URL's
  `salonId` when the record was fetched rather than handed over.

**"The time slot and the booking checkout modal show unnecessary scroll."** Two
separate boxes were scrolling inside a page that was already scrolling:

- `.time-grid` had `max-height: 330px` (and `380px` under 760px) with
  `overflow-y: auto`, so the slot buttons got their own scrollbar. The cap is
  gone, in both places; the page scrolls and the grid grows. The phone override
  keeps only its six-column layout.
- `.modal-card` became a flex column with `overflow: hidden`; `.modal-header` and
  `.modal-footer` are `flex: none`, and only `.modal-body` scrolls
  (`overflow-y: auto`, `overscroll-behavior: contain`). The title and the
  *Back* / *Send booking request* buttons stay put while a long review scrolls —
  the same `Modal` used elsewhere, so the shop's cart dialog benefits too. No
  global footer rule was added; the change is containment, not styling.

Tests: `src/components/BookingSteps.test.jsx` (10) — the salon loads from the id
in the URL (the exact case that used to render nothing), a loading state instead
of a flash of "no services", the in-session record is used without a second API
call, the id and the chosen services are written into the schedule URL, the picks
are re-ticked after going back, the services are resolved from their ids with the
salon's names and prices, the request still carries the salon id, and the two
stylesheet guarantees (no `max-height`/`overflow` on `.time-grid` in any media
query; a pinned header and footer with only `.modal-body` scrolling). It gives
every test its own salon id because the cache is module-level. `src/App.test.jsx`
adds the URL round-trip: `routeToPath` → `parseRoutePath` keeps the salon and the
service list.

## 8.5 The menu, edited on its own (`/edit-services`)

The salon account already had one **Edit** button, and it opens the whole profile
editor: seven collapsed cards, one of which is the menu — and that editor saves
everything at once, so changing "Haircut ₹250 → ₹300" also re-sends the address,
the photos, the business hours and the barbers.

The account screen now has a second button, **Edit services**, beside Edit, plus a
row in the partner menu and a tappable **Services** tile. All three open
`/edit-services` (`EditSalonServicesScreen`, `src/components/EditSalonServices.jsx`),
which edits services and nothing else.

**Every service is open, all the way down.** That is the whole design: the reported
need was *"open all services input so they can fill fast"*, and an accordion is the
opposite of that. Each row shows the four fields as real inputs from the first
paint — no tap to open, no tap to close:

| Field | Entry |
| --- | --- |
| **Service** | text, with the salon type's default names offered as you type |
| **Price (₹)** | number, `inputMode="decimal"` on a phone |
| **Duration** | select of the lengths salons use (10…120 min), plus the row's own value if it is unusual, so `45` can never become `450` |
| **Description** | optional, one line |

What makes a whole menu fast to type:

- **Enter walks the row** — Service → Price → Duration → Description — and Enter in
  the last field of the **last** row adds a new row and puts the cursor in it. A
  menu can be typed end to end without touching the mouse. (The hint under the
  header says so; it is hidden on a phone, where there is no Enter key.)
- **Add service** sits in the header, at the end of the list and in the sticky bar;
  a new row is marked **New** until it is saved.
- **↑ / ↓** re-order a row, and the order is what the customers see — it is sent as
  `displayOrder`, not sorted on the client.
- Rows are validated as you type (`Add the price`, `Name is too short`,
  `Two services have this name`); **Save services** stays off until something
  actually differs from what the server has, so an accidental double-save is not
  possible.
- A **Removed** strip lists what will go when you save, each name an **Undo**
  button that restores the whole row — price and duration included.
- **Back sits in the sticky bar**, beside **Add** and **Save services** — not only
  in the header. A salon with thirty services scrolls the header (and its back
  arrow) off a phone screen, and the reported problem was exactly that: no way back
  from the bottom of the list. Both back buttons go through the same guard, so
  unsaved edits ask first (`Discard your changes?`, with *Keep editing* as the safe
  answer).
- The header carries **no subtitle**: the summary card already says how many
  services are on the menu and what they total, so a second caption above it only
  pushed the first service further down a phone screen.
- An empty menu offers **Add your first service** and **Load defaults** (the same
  per-type default menu the profile editor uses).
- The sticky bar shows the count and the total of the menu, so a mistyped price is
  visible before saving.

**One request, and only about services.** `POST /api/salons/services/save`
(`api.salonServicesSave`) carries `{ services, removedServiceIds }` and nothing
else — no `salonId`, no address, no photos. The salon comes from the session token
on the server. The answer is the stored menu, and the screen repaints from it.

Removal is a **soft** removal on the server (`is_active = false`): customers stop
seeing the service, and past bookings that used it keep their rows. The confirmation
sheet says exactly that, because "delete" would be a lie.

A deployment that has not shipped
[`patches/backend-5-salon-services.patch`](../patches/backend-5-salon-services.patch)
answers 404, and the screen says *"Saving services needs the latest backend update"*
rather than blaming the partner's input. Contract:
[`docs/BACKEND-SALON-SERVICES-API.md`](BACKEND-SALON-SERVICES-API.md).

Styles live in `src/styles.css` under *"The menu editor (Edit services)"*:
`.service-editor-summary`, `.service-editor-list`, `.service-editor-row`,
`.service-editor-fields` (one row per service on a laptop; name on its own line,
price and minutes sharing the next one under 720px), `.service-editor-actions` (the
sticky save bar: count and total on the left, **Back · Add · Save services** on the
right, the three sharing one row under 720px), `.service-editor-removed`,
`.service-editor-hint`.

Tests: `src/components/EditSalonServices.test.jsx` (17) — the screen paints every
service as an input with no profile fields on it; the save carries services and
removals only and never the salon id; a new row is sent without a `serviceId`;
removal sends the id and Undo restores the whole row; a missing price blocks the
save; a 404 is reported as the missing backend; Save is off until something changes;
an empty menu offers the defaults; Enter walks a row and appends a new one; and the
helpers (normalising a row, ordering, validation, duplicate names, the payload,
name suggestions), the sticky **Back** beside Add and Save, and that leaving with
unsaved edits goes through the confirmation. `src/components/SalonAccountScreen.test.jsx`
(+1) covers the
button beside Edit, the partner-menu row and the Services tile.

## 9. Notification destinations

The notification route mapping is shared by foreground JavaScript and the Firebase messaging service worker:

| Mobile notification type | Web destination | Role |
| --- | --- | --- |
| `DELAY_TIME_PROPOSAL` | `#/delay` with booking ID, delay minutes and proposed time | Customer |
| `BOOKING_TIME_UPDATED` | `#/bookings` — a confirmed booking the salon moved; nothing to answer | Customer |
| `BOOKING_CONFIRMED` | `#/bookings` | Customer |
| `BOOKING_REJECTED` | `#/bookings` | Customer |
| `DELAY_RESPONSE` | `#/bookings` | Customer |
| `BOOKING_REQUEST` | `#/bookingRequest?bookingRequestId=...` | Salon |
| `DELAY_BOOKING` | `#/bookingRequest?bookingRequestId=...&openDelayModal=true` | Salon |

Foreground messages are rendered by the app itself (browser notification + in-app toast) and only time-critical types auto-navigate, so an informational message cannot pull a customer out of the booking flow; see [FIREBASE-WEB-PUSH.md](./FIREBASE-WEB-PUSH.md#foreground-delivery).

### Booking-request action buttons & response timer

**Notifications tab (salon).** Every `BOOKING_REQUEST` row in the salon's Notifications screen (`NotificationsScreen` in `src/components/UserScreens.jsx`) is itself actionable for the five-minute response window: the card shows a live **Respond in m:ss** countdown and **Accept / Reject / Delay** buttons (Delay opens the same +20 / +40 / +60 picker as the request screen), plus **Details** to open the full request. Accept and Reject post `{ action }` to `owner-action`; the card then shows the outcome in place (Accepted / Rejected / Delay sent) instead of stale buttons. When the five minutes have passed — or passes while the screen is open — the buttons go away, the card says **Time has gone**, and the request's server status is fetched once so it can also say whether it was accepted elsewhere, rejected or left unanswered. The list refreshes itself when a new push reaches the page, and a booking request that arrives while the salon is on this tab does not yank them to another screen. Every API call also has a 25-second timeout (`src/lib/api.js`), so an Accept that never answers surfaces a retryable error instead of an endless loader.

A `BOOKING_REQUEST` notification carries the mobile app's **Accept / Reject / Delay** action buttons — and **only** that type. Every other notification type (`BOOKING_CONFIRMED`, `BOOKING_REJECTED`, `DELAY_RESPONSE`, `DELAY_TIME_PROPOSAL`, `DELAY_BOOKING`, etc.) has **no** action buttons; clicking it just opens the PWA/browser on its route. `firebase-messaging-sw.js` handles the action buttons in `notificationclick`: Accept and Reject call `POST /api/bookingRequest/owner-action/{bookingRequestId}/` directly from the worker (the salon token is mirrored into IndexedDB by `src/lib/api.js`, so this works even when the PWA is closed) and then close the alert; Delay opens `#/bookingRequest?bookingRequestId=...&openDelayModal=true`. Browsers cap notification actions at two (Chrome), so Accept + Reject are the visible buttons while Delay stays reachable by tapping the notification body — and every action is always available in the booking-request screen as a fallback for browsers that do not render action buttons.

The **audible background sound is client-side, not a backend `sound` field.** The worker passes the buzzer WAV as the notification `sound` and a `vibrate` pattern; browsers (especially Android Chrome) largely use the OS notification sound for web push and ignore a custom file, so the reliable buzz is the Web Audio one that plays whenever the app is open. Set a `sound` on the server payload only if you also send a `notification` block for the mobile app — it does not affect the web client, which reads the sound from the bundled WAV.

A booking request is answerable for **five minutes** (`BOOKING_ACTION_WINDOW_MINUTES` in `src/lib/bookingLeads.js`; the server's `expires_at` is the authority, and the client only ever tightens to it). The mobile app shows a countdown on a booking-request alert and auto-cancels it once the window closes. The web Notification API cannot render a live chronometer, so the countdown is mirrored in the **Booking request** screen («Respond in m:ss», red in the final 15 seconds). When the timer expires, the app asks the worker (via a `MYNAAI_CLOSE_NOTIFICATION` message) to clear the matching notification and re-checks the request status.

Hash query parameters are parsed by `App.jsx`, so a notification click remains actionable after a cold start or browser restart. See [FIREBASE-WEB-PUSH.md](./FIREBASE-WEB-PUSH.md) for Firebase setup and payload details.

## 10. PWA service workers

Two workers have separate responsibilities and scopes:

- `public/sw.js` owns the root app scope and caches the offline shell.
- `public/firebase-messaging-sw.js` is registered only when Firebase push is configured, with scope `/firebase-cloud-messaging-push-scope`. It receives background FCM messages, shows a browser notification and handles click-through routing.

They must not be merged into one worker or registered with the same scope. The PWA install prompt is captured by the app and offered from the guest shell's top bar, the login page and the workspace sidebar when the browser supports it.

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
  capped `4 / 3`, the shop detail hero `1 / 1` and barber slots `1 / 1`, always
  with `object-position: center` (top for faces).
- **Naai Shop photos are shown whole, never cropped.** Product cards and the
  product-details hero frame the photo with `object-fit: contain` (square on a
  phone, 25:22 on a laptop for the card; square for the details hero at every
  width, since from 900 px it sits in its own column) and an inner gutter that
  keeps the product clear of the card's rounded corners; the card's hover zoom
  is gone, because scaling a contained photo crops it again. The band a
  non-square photo does not fill is a **blurred, over-scaled copy of it** (`.shop-card-backdrop` /
  `.shop-detail-hero-backdrop`, `z-index: -1` inside the frame's own stacking
  context), so a white product shot never sits in a black letterbox.
  **Upload spec for the catalogue team: square 1200 × 1200 JPG, white
  background, product at ~85% of the frame** — see
  [`docs/SHOP-IMAGE-GUIDE.md`](SHOP-IMAGE-GUIDE.md). The three shop facets
  (Category / For / Price) share **one line at every width** from 320 px up —
  the phone rules drop the decorative leading icon and tighten the gutters
  instead of wrapping the third filter onto its own row.
- **The product-details page is two columns on a laptop, one on a phone.**
  Reported with a screenshot: at ~1440 px the page was a single 1384 px column
  — a 400 px photo, then metre-wide cards holding one line of 12 px copy — so
  most of the window was empty and it read as a phone screen stretched
  sideways. From 900 px the photo takes a left column (`minmax(240px, 440px)`,
  square, `position: sticky` so it follows a long description) and tags, name,
  price, quantity, About and Delivery sit in the right one; the rating is
  grouped with the price at the left instead of being pushed to the far edge;
  the whole page is capped at 1180 px and centred, because a product page is
  read. Below 900 px the grid is one column in the same DOM order, so a phone
  stacks exactly as it did before (the stacked grid carries no `gap`, which
  would double the 14 px the tag row already has). Same markup for the
  customer dashboard and the public storefront.
- The cart's "Proceed to checkout" bar is an **overlay**: the Bill details card
  runs a few pixels underneath it (the phone clearance is set per shell, since
  the app reserves 100 px for its bottom nav and the public website, which has
  none, reserves 24–32 px), so the button reads as a layer over the bill rather
  than a block parked above it with dead space in between.
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
request runs a countdown that a second dialog would eat into.

`src/components/ConfirmDialog.test.jsx` covers the dialog behaviour and fails if
`window.confirm`, `window.alert` or `window.prompt` reappears anywhere in `src`.

## 11.1 The 2026 brand mark

`public/assets/brand/` now carries the 2026 logo: the **"m" monogram** on its own
(the artwork has no lettered wordmark any more), extracted from the supplied
2048² gold-on-black file and re-cut as **gold on transparent**
(`mynaai-mark.png`, 512²) with a padded square (`mynaai-logo.png`) for
compatibility. A single-colour copy (`mynaai-mark-white.png`) is kept for
surfaces that cannot take the brand gold.

**The tab and app icons keep that gold.** They used to be re-cut as a *white*
silhouette while being placed on the near-black plate, so every browser tab and
home-screen icon showed a white "m" while the logo on the page was gold — the
owner's report: *"don't change the colour of the logo in favicon, we need the same
as the logo, not white."* `scripts/brand-icons.sh` now trims the supplied artwork
and composes it on the `#0B0D0D` plate **without touching its colour**; the
monochrome conversion is kept for exactly one file, `badge-96.png`, because Android
draws status-bar badges as a silhouette by platform rule. Both service-worker
caches were bumped (`mynaai-shell-v13` / `v10`), so an installed app does not keep
serving the cached white icons.

Because the mark no longer contains the name, the `<Brand>` component in
`src/App.jsx` renders **mark + "My Naai" as text** (`.brand-word`), and drops the
wordmark below 1024 px — the same breakpoint that decides sidebar vs phone top
bar — where a 320 px bar has no room for it. The app icon, favicons, maskable
icon, PWA badge and the social card (`og-cover.png`, 1200×630) were regenerated
from the supplied app icon, so the tab, the installed app, the share preview and
the in-app brand are the same shape.


## 12. Important source locations

| File | Responsibility |
| --- | --- |
| `src/App.jsx` | Auth, session restoration, logout/expiry state, hash routes and push startup |
| `src/lib/api.js` | Mobile-compatible REST client, bearer token and JWT cleanup |
| `src/lib/socket.js` | Shared salon/user live-update socket (room joins, polling→WebSocket) |
| `src/lib/planCatalog.js` | The plan catalog as the admin panel publishes it: fetch, normalize, cache, `usePlanCatalog()` |
| `src/lib/planDetails.js` | Plan pricing derived from that catalog, plus active-subscription normalization |
| `src/lib/devtoolsShield.js` | Swallows the known Chrome DevTools Performance-panel crash (also inlined in `index.html` so it runs before the bundle) |
| `src/lib/razorpay.js` | Checkout loader, amount rules, payment outcomes, UPI hand-off tracking and pending-payment recovery |
| `src/lib/bookingTime.js` | Signed-offset time maths for the queue time update: local wall-clock parsing, hour/date rollover, past-time and day-cross detection, exact-time→offset derivation, human offset labels, and the `Due now`/`Overdue by` countdown chips on a queue card |
| `backend/salonUpdateBookingTime.js` | Drop-in Express + Sequelize controller for the queue time update (`POST /api/booking/salon/queue/update-time/:bookingId`). Copied into the API repo, not built with the web app |
| `src/lib/customerPhone.js` | The customer's mobile as the partner screens show it: which key it comes from, `+91` formatting and the `0000000000` placeholder |
| `src/lib/shopBuyer.js` | Who is shopping (salon / customer / visitor), the cart's storage namespace and the role-aware shop wording |
| `src/components/SalonLeads.jsx`, `src/lib/bookingLeads.js` | The salon's **Booking requests** (leads) tab: states, auto-cancel window, counters and the Accept/Reject actions |
| `src/lib/shopCategories.js` | The one product-category list, read from the admin's `shop_categories` (seed + cache for a deployment without the endpoint) |
| `src/lib/api.js` (`shopProductList[Public]`, `shopSettingsGet[Public]`) | The catalog and bill rules, read through the open `/api/shop-public/*` door for a visitor and the partner endpoint for an account, each falling back to the other |
| `src/components/SubscriptionScreen.jsx` | Plan picker, Razorpay flow, cancellation/failure copy and payment recovery |
| `src/components/ConfirmDialog.jsx` | Promise-based in-app confirmation sheet that replaces every native browser dialog |
| `src/lib/push.js` | Firebase initialization, permission/token flow and notification route mapping |
| `public/assets/brand/mynaai-mark.png` | Official My Naai monogram (**gold on transparent**, the supplied colour) — the app icon art, the default image fallback and the phone-size brand mark |
| `public/assets/brand/mynaai-logo.png` | Official lockup: the M monogram with **My Naai** lettered underneath — header, sidebar, login and registration |
| `public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png` | The app icon at every size the manifest, iOS and Android ask for (maskable padded for Android's mask) |
| `public/favicon.ico`, `public/icons/favicon-32.png`, `favicon-16.png` | Browser-tab icons |
| `public/icons/badge-96.png` | Monochrome notification badge (status-bar icon) |
| `public/assets/my_naai.png` | Raster brand tile for surfaces that need a PNG at a stable path (Razorpay checkout) |
| `public/assets/brand/og-cover.png` | Link preview (1200×630): the lockup centred on the app background |
| `public/firebase-messaging-sw.js` | Background push display and notification click routing |
| `src/components/UserScreens.jsx` | Customer screens, bookings and delay response |
| `src/components/SalonScreens.jsx` | Salon queue, booking request, delay action and partner screens |
| `src/components/EditSalonServices.jsx` | The menu editor (`/edit-services`): every service an open row, Enter-to-next, soft removal with Undo, one request that touches services only |
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
- Open **Customer queue** on an iPhone (or narrow any window to 320–375 px): every card shows the customer name, the date, the time, the services, the specialist and the call link, with **Update time** and **Done** on their own row below — the buttons must never push a detail off the card.
- **Tablets get their chrome back (760–1023px).** `.mobile-shell-bar` and `.mobile-nav` used to be hidden at 760px while the sidebar only appeared at 1024px, so the whole tablet/iPad-portrait range rendered with **no navigation at all** — no sidebar, no top bar, no bottom bar. The phone chrome (sticky top bar + bottom nav) now survives until the sidebar takes over at 1024px, the bottom nav becomes a centred 620px pill instead of a full-width strip, and `.workspace-content` keeps the bottom padding that clears it. The public navbar's route links fold into the dropdown below 1024px too, and the sidebar is 240px (274px from 1200px) so a 1024px iPad landscape keeps a comfortable content rail.
- **Width tiers are explicit:** phones < 560px (one column, stacked footer blocks, one review per screen), small tablets 560–759px (two-up partner benefits/steps, +10px body padding), tablets 760–1023px (two-column salon/product/plan grids, phone chrome), laptops 1024–1599px (sidebar, three salon columns, larger headings and promo band), and wide 1600px+ (four salon columns on the 1460px rail). The contact form's **Send message** button is full-width only while the form is one column and hugs its label from 640px up, and the partner three-step grid stays two-up until 900px because the number badge eats 60px of every card.
- View the app at 320 px and 375 px: plan cards, time slots and every grid keep readable two-column chips, and tapping a login/search/profile field on an iPhone does not zoom the page.
- Check the header wordmark: the M and the N are the same size on the login page, the mobile header and the desktop sidebar.
- Open a salon page and a salon card: **no** "Current wait" and no minutes anywhere, with the salon's opening hours in their place ([§13.1](#131-no-waiting-time-is-promised-while-booking)).
- In the shop, pick a category and read the load-more button: the number is that shelf's own size and reaches zero at the end — never "88" under a filter showing two products ([`docs/BACKEND-SHOP-CATEGORY-FILTER.md`](BACKEND-SHOP-CATEGORY-FILTER.md)).
- **Admin panel → Booking requests** opens on **Today (IST)**, not on all time; switching range/status/salon/search returns to page 1 and narrows the table; the chip counts add up to the total on the results line; a 120-character salon name ellipsises without moving the sidebar; and **Accept for salon** on an open request creates one booking, records `acted_by_role = ADMIN`, and tells the salon ([`docs/ADMIN-PANEL-BOOKING-REQUESTS.md`](ADMIN-PANEL-BOOKING-REQUESTS.md)).

## 13.1 No waiting time is promised while booking

The salon page used to carry a **Current wait** tile ("10–15 min"), and every
salon card carried the same number as a chip. Both are gone.

A waiting time is a claim about the chairs inside the salon, and a salon serves
walk-in customers: someone can sit down while the page is open, so the number is
wrong the moment it is printed, and the customer who arrives on the strength of
it is the one who waits. The customer is told when to arrive by the salon's own
answer to the booking request instead of by a number the portal invented.

What replaced it is a fact from the salon's own record:

| Where | Before | Now |
| --- | --- | --- |
| Salon card (`.salon-card`) | `.wait-copy` — the queue estimate, or `'Come back later'` | `.salon-hours-copy` — the salon's opening hours from `businessHours` (`09:00 am – 09:00 pm`), or `Open now` when the record has no schedule |
| Salon page stat row (`.detail-stat-grid`) | 3 tiles: Current wait, Services, … | 2 tiles: Services and the next real fact |

`normalizeSalon` no longer manufactures a `waitTime` (`src/components/Shared.jsx`
had a `'10–15 min'` default), and `salonHoursLabel()` formats the hours with the
same `formatTime` the detail page uses. Nothing else reads a wait time, so the
slot picker, the checkout modal and the booking request never showed one — the
estimate existed only where it was removed.

Pinned by `src/components/SalonWaitCopy.test.jsx`: the salon page and the card
must not contain "Current wait", "Estimated wait", or the minutes, even when the
API still sends `waitTime` / `totalWaitTime`.

## 14. Known console noise (not a MyNaai bug)

While Chrome DevTools is open, its Performance panel injects an anonymous helper script that can throw:

```text
Uncaught TypeError: Cannot read properties of undefined (reading 'startTime')
    at et.reportAllChanges (<anonymous>:2:19429)
```

This comes from DevTools itself (the same signature is reported in `angular/angular#70464`), not from the portal — the only `startTime` read in this codebase is `details?.startTime` in `BookingRequestScreen`, which is optional-chained. `index.html` installs a capture-phase guard before the bundle loads and `src/lib/devtoolsShield.js` keeps it active afterwards; both suppress **only** that exact signature (`reading 'startTime'` plus `reportAllChanges`/anonymous source) so real errors still surface. It only appears with DevTools open and never reaches users who do not open DevTools.
