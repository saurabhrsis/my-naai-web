# Backend: the Naai Shop for customers + the public storefront

Copy-in files for `rightserveinfotechsystems/my_naai_backend`. The reasoning and
the full contract live in [`docs/SHOP-CUSTOMERS.md`](../../docs/SHOP-CUSTOMERS.md);
this folder is the code.

Everything is additive: the salon flow keeps working through the same
endpoints, and every existing row keeps meaning "a salon ordered this".

## File map

| Here | Goes to | What |
| --- | --- | --- |
| `migration.sql` | run once | nullable `salonId`, `buyerType`, `customerId`, buyer-aware cart key |
| `src/utils/shopBuyer.js` | `src/utils/shopBuyer.js` | who is shopping, from the token |
| `src/validations/shopBuyer.validation.js` | `src/validations/shopBuyer.validation.js` | cart-line + order-body checks |
| `src/controller/shopCart/*.js` | `src/controller/shopCart/` | 5 replacements — same endpoints, buyer from the token |
| `src/controller/shopOrder/createShopOrder.js` | `src/controller/shopOrder/` | replaces the salon-only create |
| `src/controller/shopOrder/listShopOrders.js` | `src/controller/shopOrder/` | "my orders" for either buyer |
| `src/controller/shopOrder/getShopOrderById.js` | `src/controller/shopOrder/` | owner-only read |
| `src/controller/shopOrder/cancelShopOrder.js` | `src/controller/shopOrder/` | owner-only cancel |
| `src/routes/shopPublic.routes.js` | `src/routes/shopPublic.routes.js` | **the website's no-auth API** |
| `src/utils/middleware/publicReadLimiter.middleware.js` | same path | rate limit for the open reads |
| `src/services/README.md` | — | the six service edits, as code |

## 1. Models

```js
// src/database/models/shopOrder.model.js   (+ shopCart.model.js)
buyerType: { type: DataTypes.ENUM('SALON', 'CUSTOMER'), allowNull: false, defaultValue: 'SALON', field: 'buyerType' },
customerId: { type: DataTypes.STRING(36), allowNull: true, field: 'customerId' },
// salonId becomes allowNull: true

// associations, after the existing Salon one
ShopOrder.belongsTo(User, { as: 'customer', foreignKey: 'customerId' });
ShopCart.belongsTo(User, { as: 'customer', foreignKey: 'customerId' });
```

The tables are created with `sync({ alter: true })` at boot, so the columns
appear on deploy; run `migration.sql` where sync is not used (it also builds the
cart's buyer-aware unique key).

## 2. Routes

The cart and order routes keep their paths and bodies — only the guard has to
let **both** roles in:

```js
// src/routes/shopCart.routes.js
const { authenticateUserOrSalon } = require('../utils/middleware/...'); // the guard
shopCartRouter.post('/get',      authenticateUserOrSalon, getCart);
shopCartRouter.post('/add',      authenticateUserOrSalon, addToCart);
shopCartRouter.post('/set-qty',  authenticateUserOrSalon, setCartQty);
shopCartRouter.post('/remove',   authenticateUserOrSalon, removeFromCart);
shopCartRouter.post('/clear',    authenticateUserOrSalon, clearCart);

// src/routes/shopOrder.routes.js — same guard on the buyer routes
shopOrderRouter.post('/create',     authenticateUserOrSalon, createShopOrder);
shopOrderRouter.post('/list',       authenticateUserOrSalon, listShopOrders);
shopOrderRouter.post('/get-by-id',  authenticateUserOrSalon, getShopOrderById);
shopOrderRouter.post('/cancel',     authenticateUserOrSalon, cancelShopOrder);
// …the /admin-* routes keep authenticateAdmin, the distributor ones keep theirs.
```

If the guard is named differently in this build, use whichever one already
accepts a salon **or** a user token (the notifications route uses it). The point
is that both roles reach the controller; the controller decides the buyer.

## 3. The website's no-auth API (new)

Web visitors browse before they have an account, so the storefront needs reads
that never ask for a token:

```
POST|GET /api/shop-public/products/list    → { data: { products, pagination } }
POST|GET /api/shop-public/settings/get     → { data: { freeDeliveryAbove, deliveryFee, … } }
```

Mount it with one line in `app.js`, next to the other routers:

```js
app.use('/api/shop-public', shopPublicRouter);
```

The handlers are the **same** ones `/api/shop-products/list` and
`/api/shop-settings/get` already use — only the middleware chain differs — so
the response shape cannot drift. The router adds a 60 s cache header on the
catalog (5 min on the rules) and a per-IP rate limit.

> Also make the partner catalog endpoint public
> (`router.post('/list', listShopProducts)` with no guard): the web app tries
> it first and falls back to `/api/shop-public/*`, so either deployment order
> leaves the storefront working. Everything that **writes** stays guarded.

## 4. Services

See [`src/services/README.md`](src/services/README.md) — `createOrder`,
`listForBuyer`, `getById`, `cancelOrder`, the admin include/filter and the whole
cart service, as copy-paste code.

## 5. Razorpay webhook

The checkout sends `notes = { flow: 'shop-order', buyerId, buyerType, salonId?, items }`.
`salonId` is present only for a salon, so the existing lookup is unchanged; a
customer payment matches on the buyer:

```js
const { buyerType = 'SALON', buyerId, salonId } = payment.notes || {};
const where = buyerType === 'CUSTOMER' ? { customerId: buyerId } : { salonId: salonId || buyerId };
```

## 6. Done when

```bash
# 1. the open storefront answers with no Authorization header at all
curl -X POST $API/api/shop-public/products/list -H 'Content-Type: application/json' -d '{"page":1}'
curl      "$API/api/shop-public/products/list?page=1"
curl -X POST $API/api/shop-public/settings/get

# 2. a customer (USER token) holds a cart
curl -X POST $API/api/shop-cart/add -H "Authorization: Bearer $USER_TOKEN" \
  -H 'Content-Type: application/json' -d '{"productId":"<uuid>","qty":2}'

# 3. …and places a real order (no salonId in the body)
curl -X POST $API/api/shop-orders/create -H "Authorization: Bearer $USER_TOKEN" \
  -H 'Content-Type: application/json' -d @order.json

# 4. the order is theirs, and only theirs
curl -X POST $API/api/shop-orders/list -H "Authorization: Bearer $USER_TOKEN" \
  -H 'Content-Type: application/json' -d '{"page":1}'
# → data.orders[0].buyerType === "CUSTOMER", customerId set, salon === null

# 5. a salon still sees only its own, exactly as before
curl -X POST $API/api/shop-orders/list -H "Authorization: Bearer $SALON_TOKEN" \
  -H 'Content-Type: application/json' -d '{"page":1}'

# 6. the admin dashboard shows both kinds, and can filter them
curl -X POST $API/api/shop-orders/admin-list -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' -d '{"page":1,"buyerType":"CUSTOMER"}'
```
