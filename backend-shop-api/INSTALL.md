# Naai Shop e-commerce API — install these files into the backend repo

This folder contains the **complete file set** the Naai Shop work changed in
`rightserveinfotechsystems/my_naai_backend` (relative to base commit
`0825e96`). It **replaces** the previous 27-file bundle: the shop now runs on
its own tables and the legacy product API is back to its original shape.

> **Why the files are here:** the backend repo could not be pushed from the
> Arena sandbox (the sandbox GitHub login can only write to *this* frontend
> repo). So the files travel through the frontend repo and you push them to
> the backend from your machine — where your account has access.
>
> **Note:** the two key files that live in the backend repo's `main`
> (`gcp-key.json`, `src/firebase/myNaai-firebase.json`) are deliberately
> NOT included here — this frontend repo's security rules block them. They
> already exist in your backend clone, so nothing is missing.

## What this bundle does (request 24)

- **Two separate product tables.** The salons' customer-facing products
  (`products`) are untouched again — the 7 legacy product files in this
  folder are byte-identical to base `0825e96` and exist only to overwrite
  the copies from the previous bundle, if you applied it. The shop catalog
  is the new company-owned `shop_products` table (no `salonId`).
- **Server-side cart per buying salon** (`shop_carts`) — the same account
  sees the same cart on the web and the mobile app.
- **Distributors** (`distributors`) — delivery partners the company admin
  assigns orders to (`/api/shop-orders/admin-assign-distributor`).
- **Two status tracks on `shop_orders`** — an INTERNAL track for
  admin/distributor (`PENDING_ASSIGNMENT → AWAITING_ACCEPTANCE → ASSIGNED →
  PICKED → SHIPPED → DELIVERED`) and a SALON track (`customerStatus`:
  `PENDING → CONFIRMED → PROCESSING → SHIPPED → DELIVERED`); salon responses
  only ever carry the salon track, never the distributor. The customer track
  never regresses (a paid order stays CONFIRMED even when a distributor
  rejects).
- **Distributor accept / reject / re-assign.** Assigning a distributor
  requests them (`AWAITING_ACCEPTANCE`); the distributor (or the admin on
  their behalf) accepts or rejects with a reason. A rejection sends the
  order back to `PENDING_ASSIGNMENT` for re-assignment.
- **Complete order record** — a new `shop_order_events` table logs every
  action (placed, assigned, accepted, rejected + reason, every status move,
  cancellation) with actor, before/after status and note. Admin order
  views include the full event list.
- **Distributor portal login** — `distributors` gains `password` (bcrypt,
  set by the admin at create/update) and `deliveryCapability`;
  `POST /api/distributors/login` (phone or email + password) returns a JWT
  the accept/reject endpoints accept — alongside the admin token, so the
  admin can record a decision taken over the phone.
- **Shop settings** (this change) — a single-row `shop_settings` table the
  admin edits from the new **Shop Settings** tab: `freeDeliveryAbove`
  (min item total for free delivery), `deliveryFee`, `discountPercent`
  (% off the whole item total, 0–100), `codThreshold` (max item total that
  may still pay COD, 0 = no limit) and `codCharges` (extra fee when COD is
  chosen). The row self-seeds on first read with the historic defaults
  (₹499 / ₹49 / 0 / 0 / 0), so an untouched deployment behaves exactly as
  before. **Every bill is recomputed from these values server-side** in
  `createOrder`, so a tampered client can never change what it owes.
- **Distributor carries the parcel** (this change) — after accepting, the
  distributor advances their own order `ASSIGNED → PICKED → SHIPPED →
  DELIVERED` (next step only, no skipping, no going back, no cancelling —
  that stays the salon's/admin's call). Re-submitting the current status is
  a no-op, so a double-tap never errors. The admin token is accepted on
  their behalf. Each move lands in the event record.
- **Razorpay webhook** confirms the payment on the salon track only.
- **`GET /test-db` now syncs in passes** — models auto-load alphabetically,
  but a table can only be created once its foreign-key targets exist
  (`shop_carts` → `shop_products`). A model that fails on one pass is
  retried on the next, so the four new tables create themselves in the
  right order. Existing tables are unaffected (only new tables are created).
- **Deletes** the four admin product controllers the previous bundle added
  (they managed the merged table that no longer exists).

## Method A — one command in your terminal (fastest)

In your `my_naai_backend` clone:

```bash
cd my_naai_backend
git fetch https://github.com/saurabhrsis/my-naai-web.git naai-backend/shop-ecommerce-api-files
git checkout FETCH_HEAD -- .
git add -A
git commit -m "Naai Shop e-commerce API: separate shop_products table, server cart, distributors, two status tracks"
git push origin HEAD:feature/naai-shop-ecommerce-api
```

That's it — the branch `feature/naai-shop-ecommerce-api` now exists in the
backend repo and you can open the PR from there. **Nothing is deleted:** the
sync only creates the missing shop tables, your existing data is untouched.

> *Optional cleanup (only if you applied the earlier 27-file bundle): it had
> added four admin product controllers that the new design doesn't use —
> `adminCreateProduct.js`, `adminDeleteProduct.js`, `adminListProducts.js`,
> `adminUpdateProduct.js` in `src/controller/product/`. No route loads them
> anymore, so leaving them is harmless; delete them only if you want the PR
> clean.*

## Method B — no terminal (copy & paste)

1. In this repo on GitHub, open branch `arena/b1135ded-my-naai-web` →
   **Code → Download ZIP** (or use the zip of branch
   `naai-backend/shop-ecommerce-api-files`, which contains only these files).
2. Copy the `backend-shop-api/` folder's contents (keeping the
   `src/...` structure, plus `index.js` and `README.md`) into your
   `my_naai_backend` clone, overwriting the old files.
3. In your backend clone: `git add -A`, commit, and push to
   `feature/naai-shop-ecommerce-api`.

(No deletion step is needed — see the optional cleanup note above.)

## Endpoint reference (shop)

All routes are `POST` and answer `{ status, message, data }`.

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `/api/shop-products/list` | salon or user | Company catalog for the shop |
| `/api/shop-products/admin-list` · `admin-create` · `admin-update` · `admin-delete` | admin | Product management tab |
| `/api/shop-cart/get` · `add` · `set-qty` · `remove` · `clear` | salon | Server-side cart (per salon account) |
| `/api/shop-orders/create` · `list` · `get-by-id` · `cancel` | salon | Salon's orders (salon status track) |
| `/api/shop-orders/admin-list` · `admin-get-by-id` | admin | Central order dashboard — responses include the full `events` record |
| `/api/shop-orders/admin-assign-distributor` | admin | Assign / re-assign a distributor → `AWAITING_ACCEPTANCE` |
| `/api/shop-orders/admin-update-status` | admin | Move the internal track (PICKED / SHIPPED / DELIVERED / CANCELLED …) |
| `/api/distributors/list` · `create` · `update` | admin | Distributors tab (`password` + `deliveryCapability` supported; hash never returned) |
| `/api/distributors/login` | public | Distributor portal login (phone or email + password) → JWT `{distributorId}` |
| `/api/shop-orders/distributor-orders` | distributor (admin rejected) | Orders on this distributor's plate; `status` filter, `AWAITING_ACCEPTANCE` = respond queue |
| `/api/shop-orders/distributor-accept` | distributor or admin | Accept the assigned order → `ASSIGNED` (salon sees CONFIRMED) |
| `/api/shop-orders/distributor-reject` | distributor or admin | Reject with `reason` (required) → back to `PENDING_ASSIGNMENT` |
| `/api/shop-orders/distributor-update-status` | distributor or admin | Advance an accepted order `PICKED` / `SHIPPED` / `DELIVERED` (next step only) |
| `/api/shop-settings/get` | public | Read the shop's commerce rules (the web shop shows honest delivery/COD copy from this) |
| `/api/shop-settings/admin-update` | admin | Save shop settings (all five fields optional — only what's sent changes) |

`/api/shop-settings/*` data shape:
`{ freeDeliveryAbove, deliveryFee, discountPercent, codThreshold, codCharges }`
(all numbers, `discountPercent` 0–100, `codThreshold` 0 = no COD limit).

`events` entry: `{ id, orderId, actorType: ADMIN|DISTRIBUTOR|SALON|SYSTEM,
actorId, actorLabel, action: ORDER_PLACED|PAYMENT_CONFIRMED|ASSIGNED|ACCEPTED|
REJECTED|PICKED|SHIPPED|DELIVERED|STATUS_CHANGED|CANCELLED, fromStatus,
toStatus, note, createdAt }`.

## Environment notes

- The new tables (`shop_products`, `shop_carts`, `distributors`,
  `shop_orders` incl. the new `customer_status` / `distributor_id` columns,
  and `shop_settings` — a single-row table, seeded on first read) are
  created by the existing `GET /test-db` table sync, same as every other
  model — nothing to run by hand, nothing is ever dropped.
- `RAZORPAY_WEBHOOK_SECRET` (webhook signature) must match the secret
  configured in the Razorpay dashboard → Webhooks.
- Optional env: `SHOP_DELIVERY_FEE` (default 49), `SHOP_FREE_DELIVERY_ABOVE`
  (default 499), `PAGE_LIMIT` (default 20). The first two are now only the
  **seed defaults** for a `shop_settings` row that has never been written —
  once the admin saves settings from the panel, the panel values win.
