# Patches for the other two repos

Ready-to-apply patches, each generated against the current `main` of its repo
and verified with `git apply --check` on a clean checkout:

| Patch | Repo | What it does |
| --- | --- | --- |
| [`backend-shop-customers.patch`](backend-shop-customers.patch) | `rightserveinfotechsystems/my_naai_backend` | customers as a second buyer + the website's no-token API |
| [`admin-panel-shop-customers.patch`](admin-panel-shop-customers.patch) | `rightserveinfotechsystems/my-naai-frontend` | the admin panel shows who bought each shop order |
| [`backend-shop-catalog-filters.patch`](backend-shop-catalog-filters.patch) | `rightserveinfotechsystems/my_naai_backend` | **apply after the first one** — search, filters, sort and paging on the server |
| [`backend-shop-schema-selfheal.patch`](backend-shop-schema-selfheal.patch) | `rightserveinfotechsystems/my_naai_backend` | **apply after the other two** — the API repairs the `salon_id` / `buyer_type` schema itself instead of 500-ing |

`backend-shop-catalog-filters.patch` is a follow-up: it edits
`listShopProducts.js`, which `backend-shop-customers.patch` already rewrote, so
apply them **in that order**. `backend-shop-schema-selfheal.patch` comes last —
it extends `shopOrder.service.js` / `shopCart.service.js` after both rewrites.

**What the last patch is for.** The code can ship before the SQL runs (it did:
every customer checkout returned *null value in column "salon_id" … violates
not-null constraint*). With it applied, `index.js` repairs the two-buyer schema
once at boot — the same idempotent DDL as the migration — and a write that still
trips the old constraint is replayed once after the repair. It is a no-op on a
migrated database, it cannot affect a salon order (dropping `NOT NULL` never
rejects a value), and it logs + gives up when the database user has no `ALTER`
right, so the shopper still gets the honest "not set up yet" message. The SQL
is still the fix of record; this only means the shop works without a psql
session.

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

# backend, in this order (each edits files the previous one rewrote)
git am /path/to/patches/backend-shop-customers.patch
git am /path/to/patches/backend-shop-catalog-filters.patch
git am /path/to/patches/backend-shop-schema-selfheal.patch

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

## Backend — catalog filters (1 patch, 2 files)

The storefront's search box, the three filter selects and the product count are
all driven by the API, so the API has to answer a filtered question.

`shopProduct.service.listCatalog` now accepts and applies:

| Field | Values | SQL |
| --- | --- | --- |
| `page` / `pageSize` | 1..N / 1..60 (default 20) | `LIMIT` / `OFFSET` |
| `searchString` | free text | `product_name ILIKE %x%` OR `description ILIKE %x%` |
| `category` | `hair-care`, `beard-grooming`, … | id, admin-typed label, empty, or unrecognised free text |
| `gender` | `men` / `women` / `unisex` | `MALE` / `FEMALE` / `UNISEX`, plus `NULL` (client infers) |
| `priceRange` | `under500`, `500to1000`, `over1000` | `< 500`, `BETWEEN 500 AND 1000`, `> 1000` |
| `sort` | `popular`, `price-asc`, `price-desc` | `rating DESC, createdAt DESC` / `price` |
| `inStock` | `true` | `is_available = true` |

Category and gender are **supersets on purpose**: `shop_products.category` is
optional free text and `gender` is nullable, and the client classifies those
rows from the product name. Returning them lets the grid do the final, exact
narrowing (it always did), so a filtered view can never hide a matching
product. The cost is a few extra rows per page, never a missing one.

`pagination` gains `applied` — the echo of what the server actually filtered:

```json
"pagination": { "page": 1, "limit": 24, "totalProducts": 63, "totalPages": 3,
  "applied": { "searchString": "", "category": "hair-care", "gender": "men",
               "priceRange": "under500", "sort": "popular", "inStock": true } }
```

The website reads that marker as a capability handshake: **with** it, the shop
pages the server's answer ("Show more products"); **without** it (a backend
older than this patch) the shop falls back to downloading the catalog and
filtering in the browser, exactly as before. So the two repos can deploy in
either order.

`listShopProducts.js` — the one controller behind **both** doors
(`/api/shop-products/list` and the token-free `/api/shop-public/products/list`)
— forwards all eight fields, so a visitor's request and a signed-in request are
byte-for-byte the same query.

## Admin panel — nothing to change this round

The catalog fields the filters now read (`category`, `gender`, `price`, `mrp`,
`isAvailable`) are the ones the admin product form already writes, and the
Customer buyer column / filter / detail block shipped in
`admin-panel-shop-customers.patch`. If you later want the admin form to
*choose* a category from the seven shop ids instead of typing one, that is a
separate change — the filters accept a typed label today.

## If a customer order fails with `salon_id` / not-null

```
null value in column "salon_id" of relation "shop_orders" violates not-null constraint
```

The **code** patch is deployed but its **database migration was not run**.
Sequelize's `allowNull: true` is a model declaration — it never alters a column
that already exists, so Postgres still requires a salon on every order and the
first customer order dies at the INSERT.

`backend-shop-schema-selfheal.patch` removes the need for a psql session: the
API runs this same DDL at boot and replays a blocked write once. If the message
still appears after that patch is deployed, the database user cannot `ALTER
TABLE` (check the deploy log for `[shop-schema] could not repair …`) — then the
SQL below is the only way.

Fix it once, either way:

```bash
# a) the SQL file (idempotent — safe to run even if part of it is already done)
psql "$DATABASE_URL" -f patches/migrations/2026-10-22-shop-customers.sql

# b) or hit the API's own sync endpoint once — it runs model.sync({ alter: true })
curl https://<api-host>/test-db
```

The two statements that actually unblock it are:

```sql
ALTER TABLE shop_orders ALTER COLUMN salon_id DROP NOT NULL;
ALTER TABLE shop_carts  ALTER COLUMN salon_id DROP NOT NULL;
```

`shop_carts` matters too: the customer's cart is mirrored to the server, and
that push is fire-and-forget — without the second statement it fails silently
and the cart only lives in the browser.

Verify:

```sql
SELECT table_name, column_name, is_nullable
FROM information_schema.columns
WHERE table_name IN ('shop_orders', 'shop_carts')
  AND column_name IN ('salon_id', 'buyer_type', 'customer_id');
-- salon_id → YES, buyer_type → NO, customer_id → YES (on both tables)
```

Until it is run, the website says *"My Naai's shop is not set up for customer
orders on this server yet"* and keeps the cart — it never shows the Postgres
error and never invents an order.

## Verify after applying

```bash
# backend — syntax of every touched file
git show --stat HEAD && node --check src/services/shopOrder.service.js

# the open storefront answers with NO Authorization header
curl -X POST $API/api/shop-public/products/list -H 'Content-Type: application/json' -d '{"page":1}'
curl      "$API/api/shop-public/products/list?page=1"

# the facets reach the database, and the response says so
curl -X POST $API/api/shop-public/products/list -H 'Content-Type: application/json' \
  -d '{"page":1,"pageSize":24,"category":"hair-care","gender":"men","priceRange":"under500","sort":"price-asc","inStock":true}'
# → data.pagination.applied carries the same five values back

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
