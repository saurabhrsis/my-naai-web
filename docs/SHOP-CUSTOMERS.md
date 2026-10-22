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
| Customer app (USER role) | **Shop** tab in the bottom bar (`Discover · Shop · Bookings · Products · Account`), plus **Naai Shop** / **My shop orders** rows on the Account screen. |
| Salon app (SALON role) | Unchanged: **Shop** tab, same catalog, salon cart/orders. |
| Wording | Role-aware (`src/lib/shopBuyer.js`): a customer is never told the parcel goes to "your salon". |
| Cart/order storage | Salons keep the bare account id (`mynaaiShopCart:<accountId>`, unchanged). Customers are namespaced (`mynaaiShopCart:user:<userId>`) so one device can hold both. |

**Endpoints the web app calls — unchanged names, unchanged bodies:**

```
POST /api/shop-cart/get | add | set-qty | remove | clear
POST /api/shop-orders/create | list | get-by-id | cancel
POST /api/shop-products/list        (now also needed without a token)
POST /api/shop-settings/get         (already public)
```

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

## 2. Database

Two nullable columns and a relaxed foreign key. No existing row is touched —
every current row stays a salon order. The runnable SQL lives in
[`backend/shop-customer/migration.sql`](../backend/shop-customer/migration.sql);
the shape is:

```sql
-- Who bought it. salonId keeps meaning "a salon bought this"; customerId means
-- "a customer bought this". Exactly one of the two is set.
ALTER TABLE shop_orders
  ADD COLUMN buyerType ENUM('SALON','CUSTOMER') NOT NULL DEFAULT 'SALON' AFTER orderId,
  ADD COLUMN customerId CHAR(36) NULL AFTER salonId,
  MODIFY COLUMN salonId CHAR(36) NULL,
  ADD CONSTRAINT fk_shop_orders_customer
    FOREIGN KEY (customerId) REFERENCES users(userId) ON DELETE SET NULL;

CREATE INDEX idx_shop_orders_customer ON shop_orders (customerId, createdAt);

-- The cart was one row per (salonId, productId); it becomes one row per
-- (buyerType, buyerId, productId).
ALTER TABLE shop_carts
  ADD COLUMN buyerType ENUM('SALON','CUSTOMER') NOT NULL DEFAULT 'SALON' AFTER cartId,
  ADD COLUMN customerId CHAR(36) NULL AFTER salonId,
  MODIFY COLUMN salonId CHAR(36) NULL,
  ADD CONSTRAINT fk_shop_carts_customer
    FOREIGN KEY (customerId) REFERENCES users(userId) ON DELETE CASCADE;

CREATE INDEX idx_shop_carts_customer ON shop_carts (customerId);

-- Replace the old unique key with one that covers both kinds of buyer.
-- (Name the constraint after what your schema actually created — check with
--  SHOW INDEX FROM shop_carts;.)
ALTER TABLE shop_carts DROP INDEX uq_shop_carts_salon_product;
ALTER TABLE shop_carts ADD UNIQUE KEY uq_shop_carts_buyer_product (buyerType, salonId, customerId, productId);
```

Sequelize models:

```js
// src/database/models/shopOrder.model.js  (+ the same shape in shopCart.model.js)
buyerType: { type: DataTypes.ENUM('SALON', 'CUSTOMER'), allowNull: false, defaultValue: 'SALON' },
customerId: { type: DataTypes.STRING(36), allowNull: true, field: 'customerId' },
// salonId: allowNull true, and the association becomes:
//   ShopOrder.belongsTo(User, { as: 'customer', foreignKey: 'customerId' })
```

> The `users` table's primary key is `userId` in this schema; adjust the type
> (CHAR(36) vs INT) and the FK target to whatever it actually is.

---

## 3. Buyer identity helper (new file)

`src/utils/shopBuyer.js` — one place that answers "who is calling?". Every cart
and order controller uses it, so no endpoint has to guess. Copy it from
[`backend/shop-customer/resolveShopBuyer.js`](../backend/shop-customer/resolveShopBuyer.js)
(it also exports `buyerWhere` / `buyerColumns`, so services never branch on the
role themselves).

```js
/**
 * Who is using the shop right now.
 *
 * The shop serves two kinds of buyer: a SALON buying stock for its chairs and a
 * USER (customer) buying for themselves. Both authenticate with the same
 * bearer token, so the buyer is read from the TOKEN — never from the request
 * body, which the client could lie about.
 *
 * Returns { buyerType, buyerId, isSalon } or null when the token carries no
 * usable identity.
 */
const resolveShopBuyer = (req) => {
  const user = req.user || req.salon || {};
  const role = String(user.role || user.userType || '').toUpperCase();

  if (role === 'SALON') {
    const salonId = user.salonId || user.id || null;
    return salonId ? { buyerType: 'SALON', buyerId: salonId, isSalon: true } : null;
  }

  // Customers carry userId (the mobile app's role name is USER/CUSTOMER).
  if (role === 'USER' || role === 'CUSTOMER') {
    const customerId = user.userId || user.id || null;
    return customerId ? { buyerType: 'CUSTOMER', buyerId: customerId, isSalon: false } : null;
  }

  return null;
};

module.exports = { resolveShopBuyer };
```

Controllers then look like this (one example; the rest follow the same shape):

```js
// src/controller/shopOrder/createShopOrder.js
const { resolveShopBuyer } = require('../../utils/shopBuyer');

const createShopOrder = async (req, res) => {
  const buyer = resolveShopBuyer(req);
  if (!buyer) return res.status(401).json({ status: 'FAILED', message: 'Sign in to place this order.' });

  const order = await shopOrderService.createOrder({
    ...buyer,                       // buyerType, buyerId, isSalon
    orderId: req.body.orderId,
    items: req.body.items,
    address: req.body.address,
    payment: req.body.payment,
    notes: req.body.notes
  });
  return res.json({ status: 'SUCCESS', data: order });
};
```

**Every existing controller that reads `req.user.salonId` must switch to
`resolveShopBuyer(req).buyerId`:**

`shopOrder/createShopOrder.js`, `listShopOrders.js`, `getShopOrderById.js`,
`cancelShopOrder.js`, `shopCart/getCart.js`, `addToCart.js`, `setCartQty.js`,
`removeFromCart.js`, `clearCart.js`.

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

## 4. Public catalog (two lines)

The website storefront is browsable **before login**, so these two routes must
not sit behind the auth middleware:

```js
// src/routes/shopProduct.routes.js
router.post('/list', shopProductController.list);          // was: auth, list

// src/routes/shopSettings.routes.js  (already public in the current build —
// keep it that way)
router.post('/get', shopSettingsController.get);
```

`shop-products/list` returns only published/available columns — no cost price,
no admin fields — so opening it is safe. Everything that *writes* stays behind
`auth`.

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

Three small additions; no new tab.

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

1. Apply the migration + models (columns are nullable/defaulted — deploy is safe
   with the old code still running).
2. Deploy the backend changes above.
3. Open `/api/shop-products/list` and `/api/shop-settings/get` publicly.
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
