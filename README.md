# MyNaai web portal

A mobile-first, responsive PWA for the MyNaai customer and salon partner experiences. The portal mirrors the REST contract used by `rightserveinfotechsystems/my_naai_app` and defaults to the production API at `https://backend.mynaai.in`.

## Run locally

```bash
npm install
npm run dev
```

Build a production bundle with `npm run build` and serve the generated `dist` directory from a host that supports SPA fallbacks and HTTPS for installable PWA behaviour.

## Run the tests

```bash
npm test
```

A Vitest (+ jsdom) suite covers the notification routing/buzzer/token logic and the in-app confirmation dialog (including a guard that fails if a native `window.confirm`/`alert`/`prompt` call comes back). The full mobile→web parity map and what was and wasn't testable here are in [`docs/TESTING-AND-PARITY.md`](docs/TESTING-AND-PARITY.md).

## Environment

Create `.env.local` when pointing to another environment:

```bash
VITE_API_BASE_URL=https://your-api.example.com
VITE_RAZORPAY_KEY_ID=rzp_live_your_public_key_id
```

`VITE_RAZORPAY_KEY_ID` is a public Razorpay key ID, never a secret. The Razorpay checkout script is loaded in `index.html`; payment order creation and subscription completion still go through the existing MyNaai APIs.

For browser push, create a Firebase Web app and add its public config plus the Web Push certificate key to `.env.local` (the complete list is in `.env.example`):

```bash
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project
VITE_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_VAPID_KEY=...
```

Enable the **Web Push certificates** API in Firebase Cloud Messaging and copy the public VAPID key. Because push notifications are a core MyNaai feature, the portal requires a non-empty browser `deviceToken` before OTP verification/onboarding, and the backend can keep the field required. Without these values or browser permission, authentication is intentionally blocked until Web Push is configured.

## API compatibility

`src/lib/api.js` preserves the mobile app's endpoint names and payload conventions, including OTP login, salon discovery, bookings, queue actions, services, products, notifications, image upload and subscription flows. Auth state uses the same storage keys (`mynaai`, `mynaaiUser`, `userType`, `isLoggedIn`, and `isNewSalon`) so a migrated web session follows the same shape. The browser FCM token is kept in `FCM_TOKEN` and removed on logout.

The complete portal behavior and operational notes are in [`docs/MY-NAAI-WEB-PORTAL.md`](docs/MY-NAAI-WEB-PORTAL.md). Firebase setup, browser token generation and notification payload processing are documented in [`docs/FIREBASE-WEB-PUSH.md`](docs/FIREBASE-WEB-PUSH.md).

## PWA

- Startup is intentionally immediate: session state is restored synchronously from local storage instead of showing a timed splash screen.
- `public/manifest.webmanifest` defines the installable app shell and uses the MyNaai logo.
- `public/sw.js` caches the shell and falls back to the cached app when offline.
- **Installed-PWA layout.** An installed app draws edge to edge, so the device status bar sits on top of the page (iPhone with `black-translucent` — Safari and Chrome on iOS both use WKWebView — and Android with Chrome's edge-to-edge rendering). `index.html` keeps `viewport-fit=cover`, `src/styles.css` exposes `--safe-top/right/bottom/left` from `env(safe-area-inset-*)`, and every surface touching a screen edge is padded with them, so the app name and notification bell are no longer cut in half at the top and the bottom tab bar clears the gesture bar. The mobile header is sticky and painted with the app background, so scrolled content never shows through the status bar strip. `theme-color`/manifest colours match `--black`, and `apple-mobile-web-app-title` gives the iPhone Home Screen icon the name "My Naai" instead of a truncated `<title>`. In a plain browser tab every inset is `0px`, so nothing moves.
- **Image frames and defaults that hold up on any device.** Salon cards, product tiles, the detail hero and barber slots each use one `aspect-ratio` frame (with a pixel-height fallback) instead of per-breakpoint pixel heights, so a photo is cropped the same way at 320 px and at 1600 px. Missing photos fall back to on-brand SVG tiles — the My Naai logo for salons, `product-placeholder.svg` for catalog items and `person-placeholder.svg` for specialists — letterboxed by `.image-fallback-tile` on a branded gradient, because the old stock-picture defaults looked like wrong data and a square logo stretched into a wide frame looked broken. The header wordmark now sets both capitals (M, N) at the same size via `.brand-cap`/`.brand-lower` spans.
- **Responsive and browser-compatibility pass.** `--viewport-height` (`100vh`, then `100svh`) gives older iOS Safari/Chrome full-height screens; `-webkit-backdrop-filter` pairs with `backdrop-filter` on every blurred surface for Safari; plan-card and time-slot grids fall back to two readable columns at 320 px; a `@media (pointer: coarse)` rule keeps focused inputs at 16 px so iOS Safari never zooms the page mid-form; the profile editor's sticky action bar and the subscription gate carry the remaining safe-area insets.

- **Confirmations are the app's own sheet.** `src/components/ConfirmDialog.jsx` (`<ConfirmProvider>` + `useConfirm()`, promise-based) backs logout, cancelling a booking, marking a service done, deleting a product/service/specialist and replacing the service list with the type defaults. Native `window.confirm` is unstyled, ignores the safe areas, prefixes the message with the site origin, and is suppressed in some installed-PWA contexts (where it returns `false` and the button looks dead), so it is not used anywhere. The sheet is a bottom sheet on phones and a centred card on larger screens, closes as "cancel" on Escape/backdrop/Cancel, focuses the safe action for destructive prompts, traps Tab, restores focus and scroll-locks the page behind it. Booking-request and delay responses stay single-tap on purpose: they are already explicit choices and the request timer runs 60 seconds.
- `public/firebase-messaging-sw.js` receives Firebase background messages and maps notification clicks to the matching hash route (`#/bookings`, `#/delay`, or `#/bookingRequest`). Its `notificationclick` listener is registered before `firebase.messaging()` because the SDK's own click handler calls `stopImmediatePropagation()` and opens only `fcmOptions.link`, which made alert-bearing messages un-clickable; the worker also unwraps the SDK's `data.FCM_MSG` and skips its own `showNotification()` when the payload already carried a `notification` block, so each message produces exactly one clickable alert.
- Foreground Firebase messages use the same route mapping without reloading the app.
- Both Account screens carry a collapsible **Notification status** card that reports nine web-push checks (HTTPS, browser APIs, Firebase web config, permission, messaging client, service worker, push subscription, masked FCM token, last foreground message) with **Run again**, **Allow notifications** and **Copy report** for support, so "notifications are not working" is pinned to a specific layer on the device itself.
- Salon booking requests offer +10/+20 minute time updates; the mobile-compatible owner-action API sends the delay notification to the customer.
- **The Customer queue can reschedule an accepted booking.** Each queue card has **Update time** next to **Done**, for when a salon is running late *or* is free early. The salon either **shifts by minutes** (−30…+90 in one tap, or any value from −120 to +240) or **picks the exact time** on a clock, whichever matches how it is thinking; either way an optional note goes to the customer and the salon sees the resolved clock time — `6:30 PM → 6:50 PM · 20 minutes later` — before sending. Times are parsed as local wall-clock, hour/date rollover is handled, a midnight cross is called out and a time in the past is refused. It posts to the same `owner-action` DELAY endpoint, so the backend keeps sending the customer notification; the customer screen reads the sign and words an earlier offer as *"Your salon can see you earlier"*. A drop-in Express + Mongoose implementation of that endpoint ships in [`backend/`](backend/README.md).
- Foreground push is rendered by the app (browser notification + toast) and only time-critical types auto-navigate, so an informational message cannot pull a customer out of the booking flow.
- Time-critical alerts (a salon booking request, a delay proposal) replay the **exact MyNaai buzzer** the mobile app uses (the `buzzer` / `buzzer_old` WAV sounds in `public/assets/audio`), and pulse the device. The buzzer is decoded through the Web Audio API and unlocked + preloaded on the first user gesture because browsers block audio before an interaction; the foreground notification and the service worker also pass a best-effort `sound` URL and a `vibrate` pattern so supporting browsers can sound/vibrate the alert when the tab is hidden. **You do not need to set a `sound` field on the backend for the web buzzer** — the client owns it. When the PWA is installed and closed, browsers (especially Android Chrome) play the OS notification sound, not a custom file, so the reliable buzz is the Web Audio one that plays whenever the app is open (`src/lib/buzzer.js`).
- **Booking-request action buttons.** A `BOOKING_REQUEST` notification carries **Accept / Reject / Delay** action buttons, mirroring the mobile app. Clicking Accept or Reject calls the owner-action API directly from the service worker (the session token is mirrored into IndexedDB by `src/lib/api.js` so it works even when the PWA is closed) and closes the alert; Delay opens the request screen with the delay modal. Browsers cap notification actions at two (Chrome), so Accept + Reject are the visible buttons and Delay stays reachable by tapping the notification body — and every action is also available in the **Booking request** screen as a fallback for browsers that do not render action buttons.
- **Booking-request response timer.** A booking-request alert must be answered within 60 seconds, like the mobile app's Notifee chronometer. The web Notification API cannot render a live countdown, so the timer lives in the **Booking request** screen (`Respond in m:ss`), turns red in the final 15 seconds, and auto-closes the browser notification when it expires (the worker's `message` handler clears it by tag). If unsupported action buttons can't be used, the screen's Accept / Reject / Update-time buttons take over.
- Customer discovery sends browser latitude/longitude to `userSalonList`, sorts known distances nearest-first (while keeping the API list when location is unavailable), and offers a location retry. Unknown/API placeholder distances stay hidden; genuinely calculated near-zero distances render as `< 0.1 km`.
- The customer booking time picker shows only future, unbooked slots that do not overlap existing bookings and can fit the selected service duration before closing; an empty day directs the customer to choose another day.
- An incomplete salon login is locked to the full profile editor until the mobile-compatible `edit-salon-profile` body succeeds with valid contact, address, coordinates, hours, services and specialists. Every editor section is collapsed by default with its sub heading, live summary and a `N required` chip visible; required fields carry a red `*`; a failed save opens and scrolls to the offending section.
- Saving a new/incomplete profile continues to the payment screen (20-day free onboarding plan first); saving a routine edit — or any profile that already has an active plan — returns to the salon account screen instead of asking for a second payment.
- **Subscription plans** are ₹199 / 1 month, ₹299 / 2 months and ₹499 / 3 months, and a renewal costs the same as a new purchase (one price list in `src/lib/planDetails.js`).
- Razorpay Checkout reports every outcome explicitly: cancellation, gateway/bank failure (retry inside the sheet), a UPI app hand-off on mobile (Google Pay, PhonePe, Paytm, BHIM) with *Confirming your payment…* on return, redirect returns read from the URL, and a recovery card with the order ID plus support number if the tab was killed mid-payment. The gateway is loaded before the order is created, the order is read out of whatever response shape the backend returns, the registration flow authorizes the order with its temporary token, and the sheet is always closed when a payment ends.
- **Permissions explain themselves.** Notification permission is required to sign in (the API requires a device token), but a *blocked* permission cannot be re-prompted from JavaScript, so that state shows step-by-step settings instructions for the browser actually in use instead of an Enable button that cannot work. Location is optional, says so, and can be dismissed with **Not now**.
- The install action appears during onboarding/authentication and in the desktop workspace sidebar when the browser exposes the install prompt.
