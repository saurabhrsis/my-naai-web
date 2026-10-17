# my_naai_backend
## Naai Shop e-commerce API

B2B shop: a salon buys stock for its own shop. The web portal (`my-naai-web`)
and the mobile app share the same **server-side** cart and orders, so an item
added on the web shows up when the same salon logs into the app — and the
order history follows the account, not the browser. All routes are `POST`
and answer `{ status, message, data }`.

### Two separate product tables

| Table          | Owner        | Shown to                          | API root                     |
| -------------- | ------------ | --------------------------------- | ---------------------------- |
| `products`     | each salon   | **customers** booking that salon  | `/api/products/*` (unchanged) |
| `shop_products`| the company  | **salons**, to buy stock          | `/api/shop-products/*`       |

`shop_products` has **no `salonId`** — the catalog is company-wide. It
carries the shop fields: `mrp` (drives the "% off" badge), `category`,
`gender` (`MALE|FEMALE|UNISEX` or NULL), `description`, `rating`,
`isAvailable` + `stockStatus`, soft-delete (`deletedAt`).

### Shop catalog — `/api/shop-products`

| Route | Token | Body | Result |
| ----- | ----- | ---- | ------ |
| `/list` | **user OR salon** (`authUserOrSalon`) — the mobile app browses as a user, the web shop as a salon | `{ page?, searchString? }` | The buyable catalog (soft-deleted rows excluded), newest first |
| `/admin-list` | admin | `{ page?, searchString? }` | Same catalog, for the admin panel |
| `/admin-create` | admin | `{ productName, price, rating?, isAvailable?, productImage?, mrp?, category?, gender?, description? }` | Adds a company product. `gender` `''`/absent = NULL (the UI infers from the name); no `salonId` anywhere |
| `/admin-update` | admin | `{ productId, …any of the above }` | Partial update; sending `isAvailable` also syncs `stockStatus` |
| `/admin-delete` | admin | `{ productId }` | Soft delete — cart lines are dropped at read time, placed orders keep their snapshot |

### Server cart — `/api/shop-cart` (salon token)

The cart belongs to the **buying salon's account** (table `shop_carts`,
one row per `salonId + productId`, qty 1–99). Only the qty is stored —
name/price/image are read live from `shop_products`, so an admin price
change updates the bill. Lines whose product was deleted are dropped; lines
whose product went unavailable are kept and flagged `available: false`.
Totals count available lines only.

| Route | Body | Result |
| ----- | ---- | ------ |
| `/get` | `{}` | `{ lines[], totals }` — `totals` = `{ itemCount, itemTotal, savings, deliveryFee, total, freeDeliveryAbove }`, recomputed server-side |
| `/add` | `{ productId, qty? }` | Adds or tops up a line (product must exist + be available); returns the fresh cart |
| `/set-qty` | `{ productId, qty }` | Absolute qty (the stepper); `0` removes the line; max 99 |
| `/remove` | `{ productId }` | Removes one line |
| `/clear` | `{}` | Empties the cart — called by the client after a successful order placement |

### Distributors — `/api/distributors` (admin token)

Delivery partners a shop order can be assigned to (table `distributors`:
`name`, `phone`, `email`, `area`, `address`, `isActive`).

| Route | Body | Result |
| ----- | ---- | ------ |
| `/list` | `{ page?, searchString? }` | Partners, searchable by name/phone/area |
| `/create` | `{ name, phone?, email?, area?, address?, isActive? }` | Add a partner |
| `/update` | `{ distributorId, …any of the above }` | Partial update |

### Shop orders — the two status tracks

Table `shop_orders` carries **two status columns** for the same order:

- **`status` — INTERNAL track** (what the company admin and the distributor
  see): `PENDING_ASSIGNMENT → ASSIGNED → PICKED → SHIPPED → DELIVERED`
  (`CANCELLED` terminal).
- **`customerStatus` — SALON track** (what the buying salon sees, derived):
  `PENDING → CONFIRMED → PROCESSING → SHIPPED → DELIVERED` (`CANCELLED`
  terminal).

| internal | customer |
| -------- | -------- |
| `PENDING_ASSIGNMENT` | `PENDING` |
| `ASSIGNED`           | `CONFIRMED` |
| `PICKED`             | `PROCESSING` |
| `SHIPPED`            | `SHIPPED` |
| `DELIVERED`          | `DELIVERED` |
| `CANCELLED`          | `CANCELLED` |

Salon-side responses expose `status` = the **customer** track and never
include `distributorId`/`distributor`; admin-side responses include both
tracks plus the assigned distributor.

#### Salon token

| Route | Body | Result |
| ----- | ---- | ------ |
| `/api/shop-orders/create` | `{ orderId?, items[], address{}, payment{ method, status, paymentId }, notes? }` | Order created. `orderId` is honoured when supplied (the web/app records the order locally first, so both ends share the id); a duplicate gets 409. Bill is **recomputed server-side** from `items`. New orders start `PENDING_ASSIGNMENT`; the customer track is `CONFIRMED` when the online payment is already `PAID`, else `PENDING`. |
| `/api/shop-orders/list` | `{ page? }` | The calling salon's own order history (customer track), newest first |
| `/api/shop-orders/get-by-id` | `{ orderId }` (uuid `id` also works) | One own order — 404 for other salons' orders |
| `/api/shop-orders/cancel` | `{ orderId, reason? }` | Free while the parcel has not left the depot (internal `PENDING_ASSIGNMENT`/`ASSIGNED`/`PICKED`); both tracks go `CANCELLED`, a paid online order is flagged `REFUND_REQUESTED` |

#### Admin token

| Route | Body | Result |
| ----- | ---- | ------ |
| `/api/shop-orders/admin-list` | `{ page?, status?, customerStatus?, salonId?, distributorId?, searchString? }` | Every salon's orders, both tracks + distributor; `distributorId` is the admin/distributor view |
| `/api/shop-orders/admin-get-by-id` | `{ orderId }` | Any order |
| `/api/shop-orders/admin-assign-distributor` | `{ orderId, distributorId, notes? }` | Hands the order to a delivery partner (must be active); a new order moves `PENDING_ASSIGNMENT → ASSIGNED` (salon sees `CONFIRMED`); re-assignment swaps the partner |
| `/api/shop-orders/admin-update-status` | `{ orderId, status, notes? }` | Moves the INTERNAL track; the customer track follows the mapping above. Terminal states cannot be reopened (except re-confirming `DELIVERED`) |

### Razorpay webhook

`POST /api/razorpay/webhook` — public, but **signature-verified**: HMAC-SHA256
over the raw body with `RAZORPAY_WEBHOOK_SECRET` (set in the Razorpay
dashboard → Webhooks, and in the server env) compared against the
`x-razorpay-signature` header.

- `payment.captured` → the shop order carrying that payment id is marked
  `PAID` and its **customer** track moves `PENDING → CONFIRMED` (the
  internal track still waits for a delivery partner)
- `payment.failed` / `payment.refunded` → the order's payment is flagged
- Anything else is acknowledged with 200 so Razorpay stops retrying

Env knobs: `SHOP_DELIVERY_FEE` (default `49`), `SHOP_FREE_DELIVERY_ABOVE`
(default `499`) — same thresholds as the shop UI's free-delivery bar.
