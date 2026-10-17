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
  `AWAITING_ACCEPTANCE`; after that show the current status.

## Flow (what the user asked for)

1. Salon owner places an order in the MyNaai app → it appears on the
   dashboard as `PENDING_ASSIGNMENT` (event: ORDER_PLACED).
2. Admin picks a distributor (location / capability) → assigns →
   `AWAITING_ACCEPTANCE`; the distributor sees it in their portal queue.
3. Distributor checks the order → **Accept** (`ASSIGNED`, salon sees
   CONFIRMED) or **Reject** with a reason (back to `PENDING_ASSIGNMENT`;
   reason recorded in the event timeline).
4. On rejection the admin re-assigns another distributor → repeat step 3.
5. Admin moves the parcel: PICKED → SHIPPED → DELIVERED; every step is in
   the record with who/when/why.

## Delivery status

- **Backend**: delivered in `backend-shop-api/` of this repo (install + `/test-db`).
- **Frontend**: delivered in `admin-panel-shop-tabs/` of this repo — 14 files
  (7 new + 7 overwrites, nothing deleted) for `my-naai-frontend`, built and
  verified end-to-end against a live instance of the backend.
