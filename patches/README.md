# Patches for the other two repos

Two ready-to-apply patches, each generated against the current `main` of its
repo and verified with `git apply --check` on a clean checkout:

| Patch | Repo | What it does |
| --- | --- | --- |
| [`backend-shop-customers.patch`](backend-shop-customers.patch) | `rightserveinfotechsystems/my_naai_backend` | customers as a second buyer + the website's no-token API |
| [`admin-panel-shop-customers.patch`](admin-panel-shop-customers.patch) | `rightserveinfotechsystems/my-naai-frontend` | the admin panel shows who bought each shop order |

The earlier [`backend-distributor-location.patch`](backend-distributor-location.patch)
and [`admin-panel-distributor-location.patch`](admin-panel-distributor-location.patch)
are already merged; these two build on top of them.

## Apply

```bash
# backend
git clone https://github.com/rightserveinfotechsystems/my_naai_backend.git
cd my_naai_backend
git am /path/to/patches/backend-shop-customers.patch     # keeps the commit message
# or: git apply /path/to/patches/backend-shop-customers.patch

# admin panel
git clone https://github.com/rightserveinfotechsystems/my-naai-frontend.git
cd my-naai-frontend
git am /path/to/patches/admin-panel-shop-customers.patch
```

Both are ordinary `git format-patch` output, so `git am` preserves the commit
message; `git apply` works too if you prefer to commit yourself.

## Backend — what changes (23 files)

**Buyer identity.** `src/utils/shopBuyer.js` (new) answers "who is calling?"
from the token: a salon token (`request.salon.salonId`) or a user token
(`request.user.id`). It also exports `buyerWhere` / `buyerColumns` /
`buyerOwnsOrder` / `buyerActor`, so no service branches on the role and no
client can name its own buyer in the body.

**Models.** `shop_orders` and `shop_carts` gain `buyer_type`
(`SALON` | `CUSTOMER`, default `SALON`) and `customer_id` → `users(user_id)`;
`salon_id` becomes nullable; the cart's unique key becomes
`(buyer_type, salon_id, customer_id, product_id)`. A `customer` association is
added to both, so every admin / distributor payload carries the buyer's name
and phone.

**Routes.** `/api/shop-cart/*` and the buyer half of `/api/shop-orders/*`
(`create`, `list`, `get-by-id`, `cancel`) now accept **either** token via the
existing `authUserOrSalon` guard. The `/admin-*` and distributor routes are
untouched.

**New public API for the website** — no token, edge-cacheable, rate-limited:

```
POST|GET /api/shop-public/products/list
POST|GET /api/shop-public/settings/get
```

They reuse the existing `listShopProducts` / `getShopSettings` handlers (so the
shape cannot drift), add `Cache-Control` (60 s catalog, 5 min rules), a GET
mirror of each POST and a small per-IP limiter
(`src/utils/middleware/publicReadLimiter.middleware.js`). `/api/shop-products/list`
is also opened up: the catalog is company-wide, the payload carries only
published fields, and the website must be able to browse before sign-in.

**Services.** `createOrder` writes the buyer columns and picks the delivery
point by buyer (salon coordinates for a salon, the pin for a customer);
`listForBuyer`, `getById(..., { buyer })` and `cancelByBuyer` add ownership;
`listForAdmin` gains the `buyerType` filter, includes the customer, and searches
salon name / customer name / phone as well as order id.

**Migration.** `migrations/2026-10-22-shop-customers.sql` (PostgreSQL,
idempotent) for deployments that do not hit `GET /test-db`, which also creates
the columns via `sync({ alter: true })`.

## Admin panel — what changes (3 files)

- `pages/ShopOrders.jsx` — an exported `buyerOf(order)` helper, a **Buyer**
  column (salon name as before, or the customer's name with a **Customer**
  badge and phone), a **Buyer type** filter (All / Salons / Customers) sent as
  `buyerType`, and a search hint that mentions salon and customer.
- `components/ShopOrderDetailModal.jsx` — the "Ordered by" block switches to the
  customer, the savings line reads *Customer saved*, and the timeline knows the
  `CUSTOMER` actor type.
- `services/communication.jsx` — `shopOrderAPI.adminList` forwards `buyerType`.

A row without `buyerType` is treated as a salon order, so the panel can ship
before or with the backend.

## Verify after applying

```bash
# backend — syntax of every touched file
git show --stat HEAD && node --check src/services/shopOrder.service.js

# the open storefront answers with NO Authorization header
curl -X POST $API/api/shop-public/products/list -H 'Content-Type: application/json' -d '{"page":1}'
curl      "$API/api/shop-public/products/list?page=1"

# a customer token holds a cart and places a real order
curl -X POST $API/api/shop-cart/add -H "Authorization: Bearer $USER_TOKEN" \
  -H 'Content-Type: application/json' -d '{"productId":"<uuid>","qty":2}'
curl -X POST $API/api/shop-orders/list -H "Authorization: Bearer $USER_TOKEN" \
  -H 'Content-Type: application/json' -d '{"page":1}'
# → data.orders[0].buyerType === "CUSTOMER", customer.fullName set, salon === null

# a salon still sees only its own orders
curl -X POST $API/api/shop-orders/list -H "Authorization: Bearer $SALON_TOKEN" \
  -H 'Content-Type: application/json' -d '{"page":1}'

# the dashboard shows both kinds and can filter them
curl -X POST $API/api/shop-orders/admin-list -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' -d '{"page":1,"buyerType":"CUSTOMER"}'

# admin panel
npm install && npm run build
```
