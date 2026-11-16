# Admin panel — the Notifications tab

*Owner's ask: "In admin panel we don't have a notification tab. Add that and
integrate it too. Add it in notification for role access."*

| File | Repo |
| --- | --- |
| `patches/admin-panel-6-notifications-tab.patch` | `rightserveinfotechsystems/my-naai-frontend` |
| `patches/admin-panel-7-mobile-notification-bell.patch` | `rightserveinfotechsystems/my-naai-frontend` |
| `patches/backend-10-admin-notification-inbox.patch` | `rightserveinfotechsystems/my_naai_backend` |

Apply order: `backend-9` → `backend-10`; `admin-panel-5` → `admin-panel-6` →
`admin-panel-7`. (9 and 5 create the event rows and the "Event" badge; 10 and 6
make the tab a real inbox with a role key, a badge, server-side feeds and deep
links; 7 opens the tab on the received feed and puts the bell in the phone
topbar.)

---

## 1. What the tab is

The tab is the admin's **inbox**, so it opens on **Received** — the rows the
panel was sent. "All" and "Sent by admin" are secondary views.

| Feed | Rows | Where they come from |
| --- | --- | --- |
| **Received** (default) | a new shop order, a new salon registration, a subscription renewal, a delivery-partner action (assigned / accepted / rejected / picked up / shipped / delivered), a new booking request | the API's own rows, `admin_notification.target_type = 'ADMINS'` — written by `services/eventNotification.service.js` (backend-9). Internal only: no salon or customer list ever asks for `ADMINS`. |
| **Sent by admin** | every push an admin sent from this screen | `admin_notification` rows with `created_by = <that admin>` |

**All** shows both. The chips ask the server (`feed: 'events' | 'sent' | ''`), so
pagination counts what is actually on screen, and each feed has its own empty
state ("Nothing new — the panel has received no updates yet" / "No notifications
sent yet").

An **event row opens the tab it is about**: order and delivery rows →
**Shop Orders**, salon registration → **Salons**, renewal → **Plans**, booking
request → **Booking Requests**. The mapping is in `eventLinkFor()` in
`src/pages/PushNotifications.jsx`, keyed on the API's own titles; a row with no
match is simply not clickable.

## 2. Role access

The tab's key is **`notifications`**, and it is the checkbox in
**User Management → Add/Edit admin → Access Tabs** (`src/utils/TabArray.js`). The
label there is now **"Notifications"** (it used to read "Push Notifications",
which is only half of what the screen does). Existing roles that already hold
`notifications` keep working — the key did not change.

Two visibility rules in `src/components/Layout.jsx`:

* `accessTab.includes('notifications')` — the grant;
* `accessTab.includes('user')` (role management) — **rides along**, exactly like
  Plans & Trials. This is what fixes the owner's panel: the super admin's stored
  access list predates the tab, so without the ride-along there is no way to open
  the inbox at all (and no way to grant it to anyone else).

Opening `/notifications` directly without either key shows a "No access to
notifications" card rather than the list — the same refusal the Booking Requests
tab uses.

## 3. The phone topbar bell

On a phone the inbox is one tap from anywhere: a **bell beside the profile
button** in the topbar (`src/components/Layout.jsx`) opens the Notifications tab
and carries the same unread badge (99+ cap; nothing when the count is zero). It
is only rendered when the role can open the tab, so a role without
`notifications` / `user` never sees a bell that leads to a refusal. Opening the
tab from the bell clears both badges at once — they read the same count and the
same `notifications:read` event.

## 4. The unread badge

* `POST /api/adminNotification/get-admin-notification-count` — unread `ADMINS`
  rows. Always `SUCCESS` with a number: `0` on a fresh install, and `0` if the
  query itself fails, because a badge is not worth an error toast.
* The sidebar item (and the phone **More** drawer / its badge on the More button)
  shows the count, polled every 60 s.
* Opening the tab calls `POST /api/adminNotification/mark-admin-notifications-read`
  once and dispatches `notifications:read`, so the badge clears immediately
  instead of waiting for the next poll. **Mark all read** does the same on demand.
* Only event rows are marked: a push an admin sent was never unread *to them*, so
  it never carries a badge.

## 5. The list query

`getAdminNotificationList({ adminId, page, searchString, feed })` builds its
`where` as an AND of three things:

1. the permission scope — `createdBy = adminId OR targetType = 'ADMINS'`;
2. the feed — `targetType = 'ADMINS'` (events) or `targetType <> 'ADMINS'` (sent);
3. the search — its own `OR` group over title/body.

Before this patch the search replaced the whole `where[Op.or]`, which widened the
list to every admin's rows the moment anything was typed into the box; the AND
shape keeps it scoped.

## 6. Verification

* `npm run notification:test-inbox` (backend, no database and no Firebase) —
  7 checks: the badge filter, the mark-read filter and its return value, an empty
  inbox, a failing count, both feed filters, and that a search narrows instead of
  widening. All pass on a clean clone with the patches applied.
* The patches were applied in order to clean clones (`git apply`), the backend
  files were `node --check`ed, and the panel was built with `vite build` — 
  five, six and seven together build clean.
* Nothing in this patch touches the website or the partner app: the salon side of
  the same events is `backend-9` (`notifications` row + FCM push).
