# MyNaai Admin Panel — Shop Tabs + Distributor Portal (frontend)

This bundle completes the shop-ecommerce frontend for `rightserveinfotechsystems/my-naai-frontend`
(the admin panel). It works together with the **backend files already delivered** in
`backend-shop-api/` of this repo — install the backend first and hit `GET /test-db` once so the
new tables/enum values exist, then install this bundle.

**Nothing in this bundle deletes anything.** It only adds new files and overwrites the listed
existing files with newer versions. No database data is touched (the panel is read/write through
APIs only).

---

## What's new

| Feature | Where | Notes |
|---|---|---|
| **Shop Products** tab | `pages/ShopProducts.jsx` + `components/ShopProductModal.jsx` | Add / edit / hide / delete catalog products (name, price, MRP, image, category, gender, rating, description, live toggle) |
| **Distributors** tab | `pages/Distributors.jsx` + `components/DistributorModal.jsx` | Add / edit delivery partners, set portal login password, activate / disable |
| **Shop Orders** tab | `pages/ShopOrders.jsx` + `components/ShopOrderDetailModal.jsx` | Central dashboard: status filter chips, order detail with items/address/payment/amounts, **full order-history timeline** (who did what, when, rejection reasons), assign / re-assign distributor, advance status, or record a distributor's accept / reject taken over the phone |
| **Distributor Portal** | `pages/DistributorPortal.jsx` | Separate simple screen (no admin sidebar). Distributor logs in with phone/email + the password the admin set. Sees orders waiting for their reply → **Accept** or **Reject with reason**; plus all their past orders |
| Login screen | `pages/Login.jsx` | Admin / Distributor toggle |

Wiring (small changes to existing files):
- `services/communication.jsx` — new `shopProductAPI`, `distributorAPI`, `shopOrderAPI`; the 401 interceptor now also clears the `role` key.
- `utils/TabArray.js` — 3 new tab keys (`shopProducts`, `distributors`, `shopOrders`). This automatically makes the tabs appear in the **User Edit modal permission checkboxes** and the **Role Management** labels — assign the tabs to an admin there.
- `components/Layout.jsx` — 3 new sidebar items (visible only when the admin has the tab permission).
- `App.jsx` — 4 new routes + `DistributorOnlyRoute` guard.
- `contexts/UserContext.jsx` — skips the admin profile call for distributor tokens (their token is not an admin token; without this they'd be logged straight out).
- `vite.config.js` — dev-server only: `allowedHosts: true` so the dev server also works when reached through a remote/preview tunnel. No effect on `npm run build`.

---

## Install (copy files over the existing repo)

> Run this from the folder of the copied bundle, **next to** your `my-naai-frontend` checkout:
> `./copy-to-frontend.sh /path/to/my-naai-frontend`

Or copy the 14 files manually (paths below are relative to the repo root):

**New files (7):**
```
src/pages/ShopProducts.jsx
src/pages/Distributors.jsx
src/pages/ShopOrders.jsx
src/pages/DistributorPortal.jsx
src/components/ShopProductModal.jsx
src/components/DistributorModal.jsx
src/components/ShopOrderDetailModal.jsx
```

**Overwrites (7):**
```
src/App.jsx
src/pages/Login.jsx
src/services/communication.jsx
src/utils/TabArray.js
src/components/Layout.jsx
src/contexts/UserContext.jsx
vite.config.js
```

> Prefer applying the patch instead? From the repo root:
> `git apply SHOP-TABS-FRONTEND.patch`
> (it contains exactly the same 14-file change.)

**No new npm packages are needed** — the bundle only uses libraries the panel already has
(react-bootstrap, react-toastify, lucide-react).

## Build & deploy

```bash
npm install        # only if node_modules is missing / packages changed
npm run build      # production bundle in dist/ — deploy as before
```

## After deploying

1. Make sure the backend files are installed and `GET /test-db` was hit once (creates the new tables/columns — it never deletes anything).
2. Log in as an existing admin → open **Role Management** (or edit the admin user) → tick the three new checkboxes: **Shop Products**, **Distributors**, **Shop Orders** → save.
3. Add distributors from the **Distributors** tab — set each one's portal password there.
4. Share with each distributor: the panel URL, their phone or email, and their password. They pick the **Distributor** login option on the same login screen.

## Quick demo script (what the panel should show)

- **Shop Orders** tab: one order per stage — To Assign → Awaiting Distributor → Assigned → Picked → Shipped → Delivered, plus an order whose distributor **rejected** (open it: the timeline shows the rejection reason and the re-assignment).
- Open an order in **Awaiting Distributor**: click **Record Accept** / **Record Reject** (type a reason) — it lands in the timeline just like when the distributor does it from their portal.
- **Distributor login** with a distributor's phone + password: their queue shows the order waiting for their reply; Accept moves it to Assigned, Reject asks for a reason and returns it to To Assign.
