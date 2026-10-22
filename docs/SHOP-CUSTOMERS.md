# Naai Shop for customers — backend + admin panel changes

The shop used to be **partner-only** (a salon buying stock for its chairs). It is
now also a **customer storefront**: the same admin-curated catalog
(`shop_products`) is sold to app users and to visitors on the public website.

The web app is already shipped for this. What it needs from the backend is
**one thing**: the cart and order endpoints must resolve the buyer from the
**token's role**, instead of assuming every caller is a salon.

Nothing about the product catalog changes. `shop_products` is untouched, the
admin keeps adding products exactly as today.

---

## 1. What the web app does now

| Surface | Behaviour |
| --- | --- |
| `mynaai.in/shop` (public website) | Whole catalog browsable with no account. Navbar link **Shop**, footer link **Shop grooming products**. |
| `mynaai.in/shopProduct?productId=…` | Public product page (price, gallery, delivery facts). |
| ADD as a visitor | Asks for a sign-in and resumes on the product page (`/login?…`, pending route). No guest cart is written — a cart belongs to a person, not to a browser. |
| Customer app (USER role) | **Shop** tab in the bottom bar (`Discover · Shop · Bookings · Account`), plus **Naai Shop** / **My shop orders** rows on the Account screen. The old **Products** tab is retired on both the customer and partner dashboards — it listed the legacy per-salon `products` table, so there were two different product lists in one app. |
| Salon app (SALON role) | Unchanged: **Shop** tab, same catalog, salon cart/orders. |
| Wording | Role-aware (`src/lib/shopBuyer.js`): a customer is never told the parcel goes to "your salon". |
| Cart/order storage | Salons keep the bare account id (`mynaaiShopCart:<accountId>`, unchanged). Customers are namespaced (`mynaaiShopCart:user:<userId>`) so one device can hold both. |

**Endpoints the web app calls — unchanged names, unchanged bodies:**

```
POST /api/shop-cart/get | add | set-qty | remove | clear
POST /api/shop-orders/create | list | get-by-id | cancel
POST /api/shop-products/list        (now also needed without a token)
POST /api/shop-settings/get         (already public)

# the website's own no-token door (new)
POST|GET /api/shop-public/products/list
POST|GET /api/shop-public/settings/get
```

The public website reads `/api/shop-public/*` while nobody is signed in and
falls back to `/api/shop-products/list` if that mount is not deployed yet; a
signed-in account reads the partner endpoint and falls back the other way. So
either deployment order leaves the storefront working, and anonymous browsing
never depends on the partner middleware chain.

The create body is the same contract for both buyers (no `salonId`, no
`buyerId` — the token decides):

```json
{
  "orderId": "MN17926482357024C4K",
  "items": [{ "productId": "<uuid>", "name": "Beard Oil", "price": 199, "qty": 1 }],
  "address": { "name": "Sneha Waghmare", "phone": "9876543210", "line1": "12 Main Road",
               "city": "Nagpur", "state": "Maharashtra", "pincode": "440010" },
  "payment": { "method": "COD", "status": "PENDING", "paymentId": "", "amount": 248 }
}
```

---

### The visitor's cart and the purchase gate (web)

A visitor on the public website can browse `/shop`, open `/shopProduct` and
**fill a cart** — no account, no OTP, and the shop says nothing about accounts
while they shop. The cart lives in the browser under the `guest` key
(`shopCart:guest`), exactly the shape an account's cart uses.

The account is asked for at **purchase**: "Proceed to checkout" opens a small
dialog (`ShopGuestGateDialog`, a `Modal`) that states why an account is needed
— a phone the delivery partner can call, an order that can be tracked and
cancelled, reordering from My orders — with **Sign in / Create account**
(USER role, `/shopCheckout` stashed as the resume route) and **Keep shopping**.
A visitor who lands on `/shopCheckout` directly gets the same dialog over the
bill; closing it returns them to the cart, and the address/payment form is
never rendered without a session.

On a successful sign-in `completeAuth` calls `adoptGuestCart(ownerId)`
(`src/lib/shopOrders.js`): the guest lines are merged into the account's cart
(a duplicate keeps the larger quantity), pushed to the server cart, and the
guest slot is cleared — so the resumed checkout shows the same items and a
shared device never holds two copies of the basket. Order history is not public:
`/shopOrders` stays behind the login and the shop header only offers it to a
signed-in account.

---

## 2. Database

PostgreSQL. Two nullable columns and a relaxed foreign key — no existing row is
touched, and every current row stays a salon order (`buyer_type` defaults to
`SALON`).

The runnable SQL ships **inside the backend patch** at
`migrations/2026-10-22-shop-customers.sql` (idempotent). It is only needed where
`GET /test-db` is not hit: that route runs `model.sync({ alter: true })`, which
creates the same columns on boot. The shape:

```sql
ALTER TABLE shop_orders
  ADD COLUMN buyer_type enum_shop_orders_buyer_type NOT NULL DEFAULT 'SALON',
  ADD COLUMN customer_id UUID,
  ALTER COLUMN salon_id DROP NOT NULL;

ALTER TABLE shop_orders
  ADD CONSTRAINT fk_shop_orders_customer
  FOREIGN KEY (customer_id) REFERENCES users (user_id) ON DELETE SET NULL;

ALTER TABLE shop_carts
  ADD COLUMN buyer_type enum_shop_carts_buyer_type NOT NULL DEFAULT 'SALON',
  ADD COLUMN customer_id UUID,
  ALTER COLUMN salon_id DROP NOT NULL;

-- One row per buyer + product, replacing the old (salon_id, product_id) key.
CREATE UNIQUE INDEX shop_carts_buyer_product_key
  ON shop_carts (buyer_type, salon_id, customer_id, product_id);
```

Postgres treats NULLs as distinct, so a salon row (`customer_id` NULL) and a
customer row (`salon_id` NULL) can both hold the same product — which is exactly
what the two carts need.

Sequelize models (`shopOrder.model.js` / `shopCart.model.js`):

```js
buyerType: { type: DataTypes.ENUM('SALON', 'CUSTOMER'), allowNull: false, defaultValue: 'SALON', field: 'buyer_type' },
customerId: { type: DataTypes.UUID, allowNull: true, field: 'customer_id' },
salonId: { type: DataTypes.UUID, allowNull: true, field: 'salon_id' },

// associations
ShopOrder.belongsTo(models.User, { foreignKey: 'customerId', as: 'customer' });
ShopCart.belongsTo(models.User, { foreignKey: 'customerId', as: 'customer' });
```

---

## 3. Buyer identity helper (new file)

`src/utils/shopBuyer.js` — one place that answers "who is calling?". Every cart
and order controller uses it, so no endpoint has to guess. The ready file is
`src/utils/shopBuyer.js`, added by
[`patches/backend-shop-customers.patch`](../patches/backend-shop-customers.patch)
(it also exports `buyerWhere`, `buyerColumns`, `buyerOwnsOrder` and
`buyerActor`, so services never branch on the role themselves).

```js
/**
 * Who is using the shop right now.
 *
 * The shop serves two kinds of buyer: a SALON buying stock for its chairs and a
 * USER (customer) buying for themselves. Both authenticate with the same
 * bearer token, so the buyer is read from the TOKEN — never from the request
 * body, which the client could lie about.
 *
 * In this codebase `authenticateSalon` / `authUserOrSalon` attach the Salon row
 * to `request.salon`, and a user token only gets `request.user = { id,
 * phoneNumber }` (no role), so their presence is the signal.
 *
 * Returns { buyerType, buyerId, isSalon } or null when the token carries no
 * usable identity.
 */
const resolveShopBuyer = (request) => {
  const salonId = request.salon && (request.salon.salonId || request.salon.id);
  if (salonId) return { buyerType: 'SALON', buyerId: String(salonId), isSalon: true };

  const userId = request.user && (request.user.id || request.user.userId);
  if (userId) return { buyerType: 'CUSTOMER', buyerId: String(userId), isSalon: false };

  return null;
};
```

The nine controllers are rewritten by
[`patches/backend-shop-customers.patch`](../patches/backend-shop-customers.patch).
They look like this (one example; the rest follow the same shape):

```js
// src/controller/shopOrder/createShopOrder.js
const { resolveShopBuyer } = require('../../utils/shopBuyer');

const createShopOrder = async (request, response) => {
  const buyer = resolveShopBuyer(request);
  if (!buyer) return response.status(401).json({ status: 'JWT_FAILED', message: 'Sign in to place this order' });

  const order = await shopOrderService.createOrder({
    ...buyer,                       // buyerType, buyerId, isSalon
    orderId: request.body.orderId,
    items: request.body.items,
    address: request.body.address,
    payment: request.body.payment,
    notes: request.body.notes
  });
  return response.status(200).json({ status: 'SUCCESS', message: 'Order placed successfully', data: order });
};
```

**Every existing controller that reads `req.user.salonId` must switch to
`resolveShopBuyer(req).buyerId`:**

`shopOrder/createShopOrder.js`, `listShopOrders.js`, `getShopOrderById.js`,
`cancelShopOrder.js`, `shopCart/getShopCart.js`, `addToShopCart.js`,
`setShopCartLineQty.js`, `removeFromShopCart.js`, `clearShopCart.js`.

### Services

`shopOrder.service.js`

- `createOrder({ buyerType, buyerId, isSalon, ... })`
  - sets `buyerType`, `customerId` (customer) **or** `salonId` (salon);
  - **salon orders**: today's behaviour — the delivery point comes from the
    salon record (`Salon.findByPk(salonId).latitude/longitude`), falling back to
    the address pin;
  - **customer orders**: the address pin from the body is the delivery point.
    A customer has no standing salon address, so *do not* look anything up;
  - the `ORDER_PLACED` event actor becomes
    `{ actorType: 'CUSTOMER', actorId: customerId, actorLabel: customer.fullName }`
    for a customer (same `logEvent` row shape, so the admin timeline renders as
    before);
  - the customer's name/phone are copied into the order snapshot from the
    `users` row (`fullName`, `phoneNumber`) — the address block stays the
    delivery address the buyer typed.
- `listForSalon(salonId)` → `listForBuyer({ buyerType, buyerId, page })`:
  `where { salonId }` becomes `where { salonId }` or `{ customerId }` depending
  on the buyer. Everything else (pagination, DESC order, the salon-facing
  `status` track) is unchanged.
- `getById(orderId, { buyer })` / `cancel(...)` must verify ownership against
  the buyer: a customer may only read/cancel **their own** order. Today these
  are salon-scoped; keep the same check with `customerId`.
- `decorateForFulfilment` / `listForAdmin` / distributor lists: include the
  customer (`{ model: db.User, as: 'customer', attributes: ['userId','fullName','phoneNumber'] }`)
  next to the salon include, and return `buyerType` on the order. When
  `buyerType === 'CUSTOMER'`, `salon` is `null` and the delivery location comes
  from `deliveryLatitude/longitude` — the admin dashboard and the distributor
  portal already read those columns, so the map and the KM work unchanged.

`shopCart.service.js`

- Every function takes `{ buyerType, buyerId }` instead of `salonId` and filters
  on the right column.
- `getCart` response shape is unchanged (`{ lines: [...] }`), so both roles
  read the same mapper in the client.

### Response shape

`list` / `get-by-id` / `create` add two fields and keep everything else:

```json
{
  "orderId": "MN…",
  "buyerType": "CUSTOMER",
  "customer": { "userId": "…", "fullName": "Sneha Waghmare", "phoneNumber": "9876543210" },
  "salon": null,
  "status": "PENDING",
  "items": [],
  "address": {},
  "payment": {},
  "amounts": {},
  "createdAt": "…"
}
```

The client already maps `buyerType` and falls back to
`customer.fullName` for the buyer's name (`mapServerOrder`).

---

## 4. Public catalog — the website without a token

The storefront is browsable **before login**, so there are two layers:

1. **Drop the guard from the partner list route** (one line), so existing
   clients that already call `/api/shop-products/list` anonymously keep
   working:

   ```js
   // src/routes/shopProduct.routes.js
   router.post('/list', shopProductController.list);        // was: auth, list
   ```

2. **A dedicated public mount** for the website, so its reads never depend on
   that route's middleware chain:

   ```js
   // src/routes/shopPublic.routes.js  (ready file in this repo)
   app.use('/api/shop-public', shopPublicRouter);
   // POST|GET /products/list   → the same list handler
   // POST|GET /settings/get    → the same settings handler
   ```

   `src/routes/shopPublic.routes.js` (in the backend patch) re-uses the two
   existing handlers (so the response shape cannot drift), adds
   a 60 s cache header on the catalog (5 min on the rules), a per-IP rate limit
   (`publicReadLimiter.middleware.js`) and a GET mirror of each POST.

`shop-products/list` returns only published/available columns — no cost price,
no admin fields — so opening it is safe. Everything that *writes* stays behind
`auth`. The shop rules (`shop-settings/get`) are terms of sale: the shop cannot
quote an honest bill without them, so they are public by design.

### The facets are the server's job

The storefront sends the whole question on every browse — `page`, `pageSize`,
`searchString`, `category`, `gender`, `priceRange`, `sort`, `inStock` — and both
doors (`/api/shop-public/products/list` and `/api/shop-products/list`) go through
**one** controller, so a visitor's request and a signed-in request are the same
query. `pagination.applied` echoes what the server applied; the web shop pages
the answer when it sees that marker and falls back to downloading the catalog
and filtering in the browser when it does not, so **either repo can deploy
first**. See `patches/README.md` (`backend-shop-catalog-filters.patch`) for the
exact SQL and the superset rule for `category`/`gender`.

### Razorpay webhook

The checkout sends these notes on the order-less payment:
`{ flow: 'shop-order', salonId?, buyerId, buyerType, items }` — `salonId` is
present only for a salon (so the existing webhook keeps matching exactly as
today), and `buyerId`/`buyerType` are how a **customer** payment is matched.
The signed webhook that flips `payment.status` to `PAID` must therefore look up
the buyer from `notes.buyerType` + `notes.buyerId`:

```js
const { buyerType = 'SALON', buyerId, salonId } = payment.notes || {};
const where = buyerType === 'CUSTOMER' ? { customerId: buyerId } : { salonId: salonId || buyerId };
```

---

## 5. Admin panel (my-naai-frontend)

Three small additions; no new tab. They are implemented by
[`patches/admin-panel-shop-customers.patch`](../patches/admin-panel-shop-customers.patch)
— `buyerOf(order)` plus the Buyer column, the drawer's customer block and the
Buyer type filter, in `ShopOrders.jsx`, `ShopOrderDetailModal.jsx` and
`communication.jsx`.

1. **Shop Orders → table row**: show the buyer. `buyerType === 'CUSTOMER'`
   renders the customer's name with a neutral **Customer** badge; a salon order
   keeps rendering the salon name exactly as today. Sort/search by
   `searchString` should also match the customer's name and phone.
2. **Order drawer → Customer card**: when `buyerType === 'CUSTOMER'`, the
   "Salon" block is replaced by a *Customer* block (name, phone, "Customer
   order · no salon account") — the delivery address, the pin and the KM
   distance stay where they are.
3. **Filter**: the existing salon filter gains a **Buyer type** select
   (`All / Salons / Customers`), sent as `buyerType` to
   `/api/shop-orders/admin-list` (add the optional filter server-side).

Distributor portal: nothing changes — it reads the delivery point and the
address, both of which a customer order has.

---

## 6. Rollout order

The two repos' changes are ready as patches in
[`patches/`](../patches/README.md) — `git am patches/backend-shop-customers.patch`
in `my_naai_backend`, `git am patches/admin-panel-shop-customers.patch` in
`my-naai-frontend`.

1. Apply the migration + models (columns are nullable/defaulted — deploy is safe
   with the old code still running). Run the SQL **for real** —
   [`patches/migrations/2026-10-22-shop-customers.sql`](../patches/migrations/2026-10-22-shop-customers.sql)
   — or hit `GET /test-db` once (it runs `model.sync({ alter: true })`). The
   models alone are not enough: `allowNull: true` never alters an existing
   column, so a deployment that skips this step fails the first customer order
   with `null value in column "salon_id" … violates not-null constraint`. The
   two statements that matter are
   `ALTER TABLE shop_orders ALTER COLUMN salon_id DROP NOT NULL;` and the same
   on `shop_carts`; the file also adds the buyer columns, the FKs and the cart
   key, and is idempotent.
2. Deploy the backend changes above.
3. Open `/api/shop-products/list` publicly and mount `/api/shop-public/*`.
4. Deploy the web portal (this repo). Until step 2 lands, a customer can browse
   the shop and fill a cart, but checkout returns the backend's refusal —
   which the checkout screen now shows explicitly ("Order not placed", cart
   kept), never a fake success.
5. Deploy the admin panel change so customer orders are identifiable.

## 7. Acceptance checks

```bash
# A customer (USER token) can hold a cart
curl -X POST $API/api/shop-cart/add -H "Authorization: Bearer $USER_TOKEN" \
  -H 'Content-Type: application/json' -d '{"productId":"<uuid>","qty":2}'

# …and place a real order (no salonId in the body)
curl -X POST $API/api/shop-orders/create -H "Authorization: Bearer $USER_TOKEN" \
  -H 'Content-Type: application/json' -d @order.json

# The order is theirs, and only theirs
curl -X POST $API/api/shop-orders/list -H "Authorization: Bearer $USER_TOKEN" \
  -H 'Content-Type: application/json' -d '{"page":1}'
# → data.orders[0].buyerType === "CUSTOMER", customer.fullName set, salon === null

# The admin sees it on the central dashboard
curl -X POST $API/api/shop-orders/admin-list -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' -d '{"page":1}'

# The website storefront needs no token at all
curl -X POST $API/api/shop-products/list -H 'Content-Type: application/json' -d '{"page":1}'
```
