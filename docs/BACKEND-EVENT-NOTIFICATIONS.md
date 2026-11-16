# Event notifications — admin panel **and** salon

*Owner's ask: "admin panel must receive notifications for a new order, a new salon
registration, a subscription renewal, a distributor action and a new booking
request — and the salon must get them too."*

Two patches and one SQL file:

| File | Repo |
| --- | --- |
| `patches/backend-9-event-notifications.patch` | `rightserveinfotechsystems/my_naai_backend` |
| `patches/admin-panel-5-event-notifications.patch` | `rightserveinfotechsystems/my-naai-frontend` |
| `patches/migrations/2026-11-06-admin-event-notifications.sql` | the backend's PostgreSQL |

There was no *missing* patch to find: the five events simply had no notification
path on either side (the salon got a push for a new booking request only; nothing
reached the admin panel at all, and orders, registrations and renewals were
silent). This is that path.

---

## 1. The five events

| Event | Where it is raised | Admin panel | Salon |
| --- | --- | --- | --- |
| New shop order | `services/shopOrder.service.js` → `createOrder` | "New shop order — *Rita Rao placed order NAI-XXXX · ₹1,240 · cash on delivery*" | "Order placed" (only when the order belongs to a salon) |
| New salon registration | `controller/razorpay/createSalonWithPlan.js` | "New salon registration — *Glow Studio (Rita Rao) registered on the SILVER plan*" | "Welcome to My Naai" (plan + end date) |
| Subscription renewal | `controller/razorpay/renewSalonPlan.js` | "Subscription renewed — *Glow Studio renewed the SILVER plan until 21/11/2026*" | "Subscription renewed" (queue and history open again) |
| Delivery-partner action | `services/shopOrder.service.js` → `assignDistributor`, `acceptOrder`, `rejectOrder`, `distributorUpdateStatus` | assigned / accepted / rejected (with the reason) / picked up / shipped / delivered | the same, worded for the salon ("Delivery partner assigned", "Order delivered", …) |
| New booking request | `controller/bookingRequest/bookingRequest.js` | "New booking request — *Rita requested Hair Cut at 4:30 PM on 06/11/2026*" | already existed: push + inbox row + socket event, unchanged |

"Distributor action" is read as the delivery partner acting **on a shop order**
(assign, accept, reject, picked up, shipped, delivered) — the actions that change
what the salon and the customer see — not as admin edits to a distributor's
profile.

## 2. Two audiences, one service

`services/eventNotification.service.js`:

```js
notifyAdmins({ title, body })                     // → the admin panel's inbox
notifySalon({ salonId, title, body, data })       // → the salon's inbox + FCM push
notifyAdminsAndSalon({ salonId, ...copy })        // → both, the common case
```

**A notification can never break the action it describes.** Every function
catches and logs its own errors and resolves normally, so `createOrder` places the
order whether or not Firebase answered, and `createSalonWithPlan` creates the salon
whether or not an inbox row could be written.

## 3. Why a new target type — `ADMINS`

`admin_notification.target_type` was `ALL | ALL_USERS | ALL_SALONS`, and those
values *mean something to the other side*: the salon's notification list includes
`targetType IN ('ALL','ALL_SALONS')` on purpose (an admin broadcast to all salons
must appear there), and the customer list includes `('ALL','ALL_USERS')`.

An internal event written as `ALL` would therefore have appeared in every salon's
notifications. So the internal rows use a fourth value, **`ADMINS`**, which no
salon or customer query asks for:

```sql
ALTER TYPE enum_admin_notification_target_type ADD VALUE IF NOT EXISTS 'ADMINS';
```

The panel's own list is widened to include them:

```js
// services/adminNotification.service.js → getAdminNotificationList
const where = {
  [Op.or]: [
    { createdBy: adminId },        // what this admin sent
    { targetType: 'ADMINS' },      // system events — for every admin
  ],
};
```

Run `patches/migrations/2026-11-06-admin-event-notifications.sql` with the deploy.
It is idempotent, additive, and has no `BEGIN`/`COMMIT` (PostgreSQL refuses
`ALTER TYPE … ADD VALUE` inside a transaction block on older servers). Without it
the insert fails with *invalid input value for enum
enum_admin_notification_target_type: "ADMINS"* and the event is dropped — logged,
never thrown, so orders and registrations still succeed.

## 4. The admin panel

`src/pages/PushNotifications.jsx`:

* a shared `targetBadge()` labels **All / Users / Salons / Event**, so an event is
  not mislabelled "All" any more (both the table and the phone cards use it);
* the list re-fetches every 60 seconds, so an order placed while the page is open
  appears without a manual reload;
* the existing delete control still works — deleting an event row removes it for
  every admin, which is the intended "dismiss".

No new page, no new endpoint: the events land in the Notifications tab the panel
already has.

## 5. Verification

* Both patches were applied to clean clones of the two repositories
  (`git apply --check`, then a real apply) — the admin panel was built with
  `vite build`, the backend files were syntax-checked with `node --check`.
* `backend-9` does not touch anything `backend-8` (shop category authority)
  edits, so the two are independent; `backend-7` (five-minute window) is already
  in `main`.
* The salon side is a plain `notifications` row plus the same
  `firebase/sendNotification` call the booking flows already use, so no client
  change is needed: the partner app's notifications screen reads that table, and
  the payload carries `type` (`SHOP_ORDER`, `SALON_REGISTERED`, `PLAN_RENEWED`,
  `SALON_EVENT`) for any client that wants to deep-link.
