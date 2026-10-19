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
| **Shop Orders** tab | `pages/ShopOrders.jsx` + `components/ShopOrderDetailModal.jsx` | Central dashboard: status filter chips, order detail with items/address/payment/amounts (incl. discount + COD charges), **full order-history timeline** (who did what, when, rejection reasons), assign / re-assign via a distributor **select**, advance status, or record a distributor's accept / reject taken over the phone. Fullscreen on phones |
| **Shop Settings** tab | `pages/ShopSettings.jsx` | The five commerce rules the shop bills with: **Free Shipping Threshold (₹)**, **Delivery Charges (₹)**, **Discount Percentage (%)**, **COD Threshold (₹)** and **COD Charges (₹)** — saved to the backend's single `shop_settings` row; the web shop reads the same values |
| **Distributor Portal** | `pages/DistributorPortal.jsx` | Separate simple screen (no admin sidebar), responsive from phone to desktop. Distributor logs in with phone/email + the password the admin set. Sees orders waiting for their reply → **Accept** or **Reject with reason**; after accepting they carry the parcel forward with one tap per step — **Mark Picked Up → Mark Shipped → Mark Delivered**; plus all their past orders |
| Login screen | `pages/Login.jsx` | Admin / Distributor toggle |

Wiring (small changes to existing files):
- `services/communication.jsx` — new `shopProductAPI`, `distributorAPI`, `shopOrderAPI` (incl. `distributorUpdateStatus`) and `shopSettingsAPI`; the 401 interceptor now also clears the `role` key.
- `utils/TabArray.js` — 4 new tab keys (`shopProducts`, `distributors`, `shopOrders`, `shopSettings`). This automatically makes the tabs appear in the **User Edit modal permission checkboxes** and the **Role Management** labels — assign the tabs to an admin there. The **Shop Settings** tab also shows for any admin who already has one of the other shop tabs, so existing admins see it without a permission change.
- `components/Layout.jsx` — 4 new sidebar items (visible only when the admin has the tab permission — see the note above).
- `App.jsx` — 5 new routes + `DistributorOnlyRoute` guard.
- `contexts/UserContext.jsx` — skips the admin profile call for distributor tokens (their token is not an admin token; without this they'd be logged straight out).
- `vite.config.js` — dev-server only: `allowedHosts: true` so the dev server also works when reached through a remote/preview tunnel. No effect on `npm run build`.

---

## Install (copy files over the existing repo)

> Run this from the folder of the copied bundle, **next to** your `my-naai-frontend` checkout:
> `./copy-to-frontend.sh /path/to/my-naai-frontend`

Or copy the 15 files manually (paths below are relative to the repo root):

**New files (8):**
```
src/pages/ShopProducts.jsx
src/pages/Distributors.jsx
src/pages/ShopOrders.jsx
src/pages/DistributorPortal.jsx
src/pages/ShopSettings.jsx
src/components/ShopProductModal.jsx
src/components/DistributorModal.jsx
src/components/ShopOrderDetailModal.jsx
```

**Overwrites (7) + root config (1):**
```
src/App.jsx
src/pages/Login.jsx
src/services/communication.jsx
src/utils/TabArray.js
src/components/Layout.jsx
src/contexts/UserContext.jsx
vite.config.js
```

> Prefer applying the patch instead? `SHOP-TABS-FRONTEND.patch` is the
> **bulletproof-layout increment** — it applies on top of the shop bundle you
> already installed (the layout fix from commit `b20d1d9` of this repo). It
> re-builds the Shop Settings page and the order detail modal (plus the
> distributor portal and list pages) so that every structural style is inline
> **with `!important`**, which beats any rule in the panel's CSS — including
> its `!important` ones. From your admin frontend repo root:
> `git apply /path/to/admin-panel-shop-tabs/SHOP-TABS-FRONTEND.patch`
> If `git apply` reports a conflict on `src/pages/ShopSettings.jsx` (because a
> newer copy of that single file was placed by hand earlier), just run the
> copy script above — it overwrites files and always lands the complete
> 15-file state. A fresh install? Use the copy script too.

**No new npm packages are needed** — the bundle only uses libraries the panel already has
(react-bootstrap, react-toastify, lucide-react).

> **Layout note (important for future changes):** the panel's deployed CSS
> contains rules that override both utility classes and *ordinary* inline
> styles on nested divs and inputs — that is what made the shop screens
> collapse. Every shop screen therefore sets its structural styles (display,
> width, flex, gap, overflow) inline **with `!important`**, which sits above
> every author-stylesheet rule. When you add or edit shop UI, keep that
> pattern: no `row`/`col-*` grid, no reliance on any class for width or
> display, and structural inline styles carrying `!important`.

## Build & deploy

```bash
npm install        # only if node_modules is missing / packages changed
npm run build      # production bundle in dist/ — deploy as before
```

## After deploying

1. Make sure the backend files are installed and `GET /test-db` was hit once (creates the new tables/columns — it never deletes anything).
2. Log in as an existing admin → open **Role Management** (or edit the admin user) → tick the four shop checkboxes: **Shop Products**, **Distributors**, **Shop Orders**, **Shop Settings** → save. (An admin who already has any shop tab sees **Shop Settings** even before this is ticked.)
3. Add distributors from the **Distributors** tab — set each one's portal password there.
4. Share with each distributor: the panel URL, their phone or email, and their password. They pick the **Distributor** login option on the same login screen.
5. Open **Shop Settings** and set your rules — Free Shipping Threshold, Delivery Charges, Discount %, COD Threshold (0 = no limit), COD Charges. The web shop's cart/checkout/product pages bill and phrase everything from these exact values.

## Quick demo script (what the panel should show)

- **Shop Settings** tab: save e.g. Free Shipping ₹500, Delivery ₹40, Discount 10%, COD Threshold ₹1000, COD Charges ₹25 → on the web, a ₹550 COD order bills as 550 − 55 (discount) + 40 (fee) + 25 (COD) = ₹560, and a ₹1200 order cannot choose COD at checkout (it is greyed out with the reason).
- **Shop Orders** tab: one order per stage — To Assign → Awaiting Distributor → Assigned → Picked → Shipped → Delivered, plus an order whose distributor **rejected** (open it: the timeline shows the rejection reason and the re-assignment). Open the detail on a phone — it goes fullscreen; the assign flow is a dropdown; the bill shows discount/COD rows.
- Open an order in **Awaiting Distributor**: click **Record Accept** / **Record Reject** (type a reason) — it lands in the timeline just like when the distributor does it from their portal.
- **Distributor login** with a distributor's phone + password: their queue shows the order waiting for their reply; Accept moves it to Assigned; then **Mark Picked Up → Mark Shipped → Mark Delivered** — one tap per step, each landing in the order's timeline (and the salon's tracker) immediately.
