# Admin panel — Shop tabs (integration spec)

Target repo: `rightserveinfotechsystems/my-naai-frontend` (the admin panel).
Backend: `rightserveinfotechsystems/my_naai_backend` — endpoints below are
delivered in this repo's `backend-shop-api/` folder (see its INSTALL.md) and
already implemented + tested.

New top-level tabs (alongside the existing ones):

1. **Shop Products** — product management
2. **Distributors** — delivery partners
3. **Shop Orders** — the central order dashboard + distributor portal access

Shared conventions (mirror the existing tabs):
- Same API base URL + `Authorization: Bearer <token>` as the admin login.
- Responses: `{ status: 'SUCCESS' | 'FAILED', message, data }`.
- All endpoints are `POST` with a JSON body.
- DECIMAL columns come back as **strings** — parse with `Number()` before
  display/math.
- Money is INR; order ids look like `MN…` (string, not UUID).

---

## 1. Shop Products tab

The company catalog — the products salons can buy. (The salons' own
customer-facing products are a different system and are NOT managed here.)

| Action | Endpoint | Body | Notes |
| --- | --- | --- | --- |
| List | `/api/shop-products/admin-list` | `{ page, search? }` | `data.products[]`, `data.pagination`; soft-deleted rows are hidden |
| Create | `/api/shop-products/admin-create` | `{ name, price, mrp?, category?, gender?, image?, description?, stockStatus? }` | `price` required; `mrp` optional (strikethrough price) |
| Update | `/api/shop-products/admin-update` | `{ productId, …same fields }` | partial update |
| Delete | `/api/shop-products/admin-delete` | `{ productId }` | soft delete — cart lines drop, existing orders keep their snapshot |

Product shape: `{ productId, productName, productImage, price, mrp, category,
gender ('MALE'|'FEMALE'|'UNISEX'|null), description, rating, isAvailable,
stockStatus ('available'|'out_of_stock'), createdAt, updatedAt }`.

UI: table (image, name, price, mrp, category, stock) + search + create/edit
modal + delete with confirm.

## 2. Distributors tab

| Action | Endpoint | Body | Notes |
| --- | --- | --- | --- |
| List | `/api/distributors/list` | `{ page, searchString? }` | `data.distributors[]` (never includes the password) |
| Create | `/api/distributors/create` | `{ name, phone?, email?, area?, deliveryCapability?, address?, password?, isActive? }` | `password` (min 6) enables the distributor portal login |
| Update | `/api/distributors/update` | `{ distributorId, …same fields }` | `password: ''` clears it (disables login) |

UI: table (name, phone, email, area, capability, active) + create/edit modal
with a "portal password" field (write-only) + activate/deactivate toggle.

## 3. Shop Orders tab (central dashboard)

| Action | Endpoint | Body |
| --- | --- | --- |
| List | `/api/shop-orders/admin-list` | `{ page, status?, customerStatus?, salonId?, distributorId?, searchString? }` |
| Detail | `/api/shop-orders/admin-get-by-id` | `{ orderId }` |
| Assign / re-assign | `/api/shop-orders/admin-assign-distributor` | `{ orderId, distributorId, notes? }` |
| Move status | `/api/shop-orders/admin-update-status` | `{ orderId, status, notes? }` |
| Distributor advances | `/api/shop-orders/distributor-update-status` | `{ orderId, status: PICKED|SHIPPED|DELIVERED }` | next-step-only (ASSIGNED→PICKED→SHIPPED→DELIVERED), distributor's own orders only; the admin's token works here too (recorded as the distributor's action) |

Order shape (admin view): the salon-view fields **plus** `status` (internal
track), `customerStatus` (salon track), `distributor {distributorId, name,
phone, area}` and `events[]` — the complete record, oldest first.

Internal statuses (filter chips):
`PENDING_ASSIGNMENT` → new/rejected, waiting for a distributor
`AWAITING_ACCEPTANCE` → requested, distributor has not responded yet
`ASSIGNED` → distributor accepted, in fulfilment
`PICKED` / `SHIPPED` / `DELIVERED` / `CANCELLED`

Order detail drawer:
- Header: order id, salon (name + phone), placed at, payment method/status,
  totals (parse DECIMAL strings).
- Two status pills: INTERNAL + SALON.
- Items list, delivery address, current distributor.
- **Record / timeline** — render `events[]` as a timeline: icon per action,
  `actorLabel` ("Admin", "City Express", salon name), `fromStatus →
  toStatus`, `note` (this is where REJECTION REASONS show up), timestamp.
- Actions:
  - *Assign distributor* — pick from `/api/distributors/list` (show area +
    capability to help the admin choose); optional note. Available while the
    order is not DELIVERED/CANCELLED.
  - *Mark status* — PICKED / SHIPPED / DELIVERED / CANCELLED (+ optional
    note); CANCELLED on a paid order flags `REFUND_REQUESTED` server-side.
  - *Record acceptance / rejection* (admin acting for the distributor, e.g.
    after a call) — same endpoints the portal uses:
    `distributor-accept { orderId }`, `distributor-reject { orderId, reason }`.
    Accept/reject only work while `AWAITING_ACCEPTANCE`.

## 4. Distributor portal (login + their orders)

Login screen (separate from the admin login):
- `POST /api/distributors/login` `{ identifier, password }` — identifier is
  the distributor's **phone or email**.
- On success: `data.distributor {distributorId, name, phone, email, area,
  deliveryCapability}` + `data.token`. Store the token the same way the
  admin token is stored (the JWT carries `role: 'distributor'`, so the panel
  can switch its UI to the distributor view).
- Wrong/missing credentials → 401 with a message.

Distributor home (token from above):
- Queue: `POST /api/shop-orders/distributor-orders` `{ page, status? }` —
  default to `status: 'AWAITING_ACCEPTANCE'` (the "respond to these" list);
  an "All my orders" toggle drops the filter.
- Each order card: salon + address + items + totals + payment method.
  Buttons: **Accept** (`distributor-accept`) and **Reject**
  (`distributor-reject`, reason required, min 3 chars) — only visible while
  `AWAITING_ACCEPTANCE`; after acceptance the single next-step button shows
  instead — **Mark Picked Up → Mark Shipped → Mark Delivered**
  (`distributor-update-status`), one tap per step, every step landing in the
  order timeline and the salon's tracker; after that show the current status.

## 5. Shop Settings tab (bill rules)

One settings row on the backend (`shop_settings`, self-seeded on first read
with free-above ₹499 / delivery ₹49 / no discount / COD unlimited / no COD
fee). The web shop reads the same row, so these are the values that bill.

| Action | Endpoint | Body | Notes |
| --- | --- | --- | --- |
| Read | `/api/shop-settings/get` | `{}` | **public** — the web shop calls it without a token; returns the current row |
| Save | `/api/shop-settings/admin-update` | any subset of `{ freeDeliveryAbove, deliveryFee, discountPercent, codThreshold, codCharges }` | admin only; partial upsert — unsent fields keep their value; each sent value must be a number ≥ 0 and `discountPercent` ≤ 100, otherwise the whole request is rejected with 400 |

Field semantics (shown in the panel, mirrored on the shop):
- `freeDeliveryAbove` — orders with an **after-discount** subtotal at/above
  this pay no delivery fee (0 = delivery always free).
- `deliveryFee` — flat fee below the threshold.
- `discountPercent` — order-wide discount off the item total (0 = none).
- `codThreshold` — COD is refused above this item total (0 = no limit).
- `codCharges` — flat COD surcharge added to COD orders (0 = none).

## Flow (what the user asked for)

1. Admin sets the bill rules once in **Shop Settings** (free-shipping
   threshold, delivery fee, discount %, COD limit, COD charges) — the shop
   bills, and its delivery/COD copy, from these values.
2. Salon owner places an order in the MyNaai app → it appears on the
   dashboard as `PENDING_ASSIGNMENT` (event: ORDER_PLACED); the server
   recomputed the bill from the settings and refused the order up front if
   it was a COD order over the limit.
3. Admin picks a distributor (location / capability) → assigns →
   `AWAITING_ACCEPTANCE`; the distributor sees it in their portal queue.
4. Distributor checks the order → **Accept** (`ASSIGNED`, salon sees
   CONFIRMED) or **Reject** with a reason (back to `PENDING_ASSIGNMENT`;
   reason recorded in the event timeline).
5. On rejection the admin re-assigns another distributor → repeat step 4.
6. The distributor moves the parcel themselves — **Picked Up → Shipped →
   Delivered** — one tap per step from their portal (next-step-only, their
   own orders only); the admin can still move it from the dashboard
   (`admin-update-status`); every step is in the record with who/when.

## Delivery status

- **Backend**: delivered in `backend-shop-api/` of this repo (install + `/test-db`).
- **Frontend**: delivered in `admin-panel-shop-tabs/` of this repo — 16 files
  (8 new + 7 overwrites + `vite.config.js`, nothing deleted) for
  `my-naai-frontend`, verified end-to-end against a live instance of the
  backend (shop settings get/save, order creation with the COD gate, the
  distributor accept → picked → shipped → delivered chain, and the salon's
  tracker mirroring each step).
