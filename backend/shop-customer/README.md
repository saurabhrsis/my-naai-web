# Backend: the Naai Shop for customers

Drop-in pieces for the API repo (`rightserveinfotechsystems/my_naai_backend`).
The reasoning, the full contract and the acceptance checks live in
[`docs/SHOP-CUSTOMERS.md`](../../docs/SHOP-CUSTOMERS.md); this folder holds the
part you copy.

| File | Goes to |
| --- | --- |
| `resolveShopBuyer.js` | `src/utils/shopBuyer.js` |
| `migration.sql` | run once against the database (no Sequelize migration needed if you use `sequelize.sync({ alter })` — the model changes below must match either way) |

## 1. Models

```js
// src/database/models/shopOrder.model.js  and  shopCart.model.js
buyerType: { type: DataTypes.ENUM('SALON', 'CUSTOMER'), allowNull: false, defaultValue: 'SALON' },
customerId: { type: DataTypes.STRING(36), allowNull: true },
// salonId becomes allowNull: true

// associations (after the existing Salon association)
ShopOrder.belongsTo(User, { as: 'customer', foreignKey: 'customerId' });
```

## 2. Controllers — every one that reads `req.user.salonId`

| Controller | Change |
| --- | --- |
| `shopOrder/createShopOrder.js` | `const buyer = resolveShopBuyer(req)` → pass `...buyer` to the service; 401 when null |
| `shopOrder/listShopOrders.js` | `listForSalon(salonId, page)` → `listForBuyer(buyer, page)` |
| `shopOrder/getShopOrderById.js` | fetch, then assert `order.customerId === buyer.buyerId` for a customer (same check the salon path already does) |
| `shopOrder/cancelShopOrder.js` | same ownership check |
| `shopCart/getCart.js`, `addToCart.js`, `setCartQty.js`, `removeFromCart.js`, `clearCart.js` | `buyerWhere(buyer)` in the query, `buyerColumns(buyer)` on insert |

```js
// src/controller/shopOrder/createShopOrder.js — the whole shape
const { resolveShopBuyer } = require('../../utils/shopBuyer');
const shopOrderService = require('../../services/shopOrder.service');

const createShopOrder = async (req, res) => {
  const buyer = resolveShopBuyer(req);
  if (!buyer) {
    return res.status(401).json({ status: 'FAILED', message: 'Sign in to place this order.' });
  }
  const order = await shopOrderService.createOrder({ ...buyer, ...req.body });
  return res.json({ status: 'SUCCESS', data: order });
};
```

## 3. Services

`shopOrder.service.js`

- `createOrder({ buyerType, buyerId, isSalon, orderId, items, address, payment, notes })`
  - `...buyerColumns(buyer)` on create;
  - **salon**: unchanged (delivery point from the salon record, then the pin);
  - **customer**: delivery point = the pin in `address`; do not look up a salon;
  - event actor for a customer:
    `{ actorType: 'CUSTOMER', actorId: customerId, actorLabel: customer.fullName }`;
  - the customer's name/phone are copied from `users` into the order snapshot.
- `listForSalon` → `listForBuyer(buyer, page)` using `buyerWhere(buyer)`.
- `getById` / `cancel`: keep the existing salon ownership check, add the
  customer equivalent (`customerId`).
- `listForAdmin`: include `{ model: db.User, as: 'customer', attributes: ['userId', 'fullName', 'phoneNumber'] }`
  and return `buyerType`. `decorateForFulfilment` already builds the map and the
  KM distance from `deliveryLatitude/Longitude`, which a customer order has — so
  the admin dashboard and the distributor portal work unchanged.
- Optional filter: `buyerType` on `admin-list`.

`shopCart.service.js` — takes `buyer` instead of `salonId`; the response shape
(`{ lines: [...] }`) is unchanged.

## 4. Public catalog

The website storefront is browsable before login:

```js
router.post('/list', shopProductController.list);   // no auth middleware
```

`shop-settings/get` is already public — keep it that way.

## 5. Razorpay webhook

The checkout sends `notes = { flow, salonId? , buyerId, buyerType, items }`.
`salonId` is present only for a salon (the existing webhook keeps matching
exactly as today); a customer payment matches on `buyerId` + `buyerType`:

```js
const { buyerType = 'SALON', buyerId, salonId } = payment.notes || {};
const where = buyerType === 'CUSTOMER' ? { customerId: buyerId } : { salonId: salonId || buyerId };
```

## 6. Done when

- a USER token can add to the cart, place an order and list only its own orders;
- the order lands in `shop_orders` with `buyerType='CUSTOMER'`, `customerId`
  set, `salonId` NULL, `deliveryLatitude/Longitude` filled from the pin;
- the admin dashboard lists it with the customer's name and can assign a
  distributor exactly like a salon order;
- `POST /api/shop-products/list` answers without a token.
