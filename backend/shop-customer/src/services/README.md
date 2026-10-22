# Service changes (`src/services/`)

The controllers above already call the service with a **buyer** instead of a
`salonId`. These are the edits that make those calls behave — five functions
plus one `where` clause. Everything else in `shopOrder.service.js` and
`shopCart.service.js` (pagination, statuses, totals, events, delivery deck) is
untouched.

```js
// top of both services
const { buyerWhere, buyerColumns, buyerOwnsOrder, buyerActor } = require('../utils/shopBuyer');
```

---

## 1. `shopOrder.service.js` → `createOrder`

Today it is `createOrder({ salonId, orderId, items, address, payment, notes })`
and it always looks the salon up. Split that one lookup by buyer, and write the
right identity columns:

```js
const createOrder = async ({ buyerType, buyerId, isSalon, orderId, items, address, payment, notes }) => {
    // …totals computation is unchanged…
    const method = (payment?.method || 'COD').toUpperCase();
    const paid = method === 'ONLINE' && payment?.status === 'PAID';

    // The delivery point is decided once, here, and stored on the order.
    //   SALON    : the salon's own coordinates (the server's truth), else the
    //              pin the client sent;
    //   CUSTOMER : the pin the client sent — a customer has no standing
    //              address to look up, and inventing one would send the
    //              parcel to the wrong door.
    let deliveryPoint = null;
    let customer = null;
    let actorLabel;

    if (isSalon) {
        const salon = await db.Salon.findByPk(buyerId, {
            attributes: ['salonName', 'latitude', 'longitude', 'addressLine1', 'city']
        });
        deliveryPoint = toPoint({ latitude: salon?.latitude, longitude: salon?.longitude })
            || toPoint({ latitude: address?.latitude, longitude: address?.longitude });
        actorLabel = salon?.salonName || 'Salon';
    } else {
        deliveryPoint = toPoint({ latitude: address?.latitude, longitude: address?.longitude });
        // The order snapshot carries who bought it; the users row keeps the
        // account's current name/phone, so a rename later does not rewrite
        // an old parcel's paperwork.
        customer = await db.User.findByPk(buyerId, { attributes: ['userId', 'fullName', 'phoneNumber'] });
        actorLabel = customer?.fullName || 'Customer';
    }

    const order = await db.ShopOrder.create({
        orderId: orderId || generateOrderId(),
        ...buyerColumns({ buyerType, buyerId }),          // salonId OR customerId
        items,
        address: address ? {
            name: address.name, phone: address.phone, line1: address.line1,
            city: address.city, state: address.state, pincode: address.pincode
        } : address,
        deliveryLatitude: deliveryPoint ? deliveryPoint.latitude : null,
        deliveryLongitude: deliveryPoint ? deliveryPoint.longitude : null,
        payment: { method, status: paid ? 'PAID' : 'PENDING', paymentId: payment?.paymentId || null, amount: amounts.total },
        amounts,
        status: 'PENDING',
        customerStatus: 'PENDING'
    });

    await logEvent(order, {
        ...buyerActor({ buyerType, buyerId }, actorLabel),
        action: 'ORDER_PLACED',
        toStatus: order.status,
        note: method === 'ONLINE' ? 'Order placed (online payment)' : 'Order placed (cash on delivery)'
    });
    // …the PAID event, unchanged…

    return decorateForFulfilment(order);
};
```

`buyerColumns` is the whole trick: `{ buyerType: 'CUSTOMER', customerId, salonId: null }`
or `{ buyerType: 'SALON', salonId, customerId: null }`. Exactly one id is set,
matching the nullable column + enum in the migration.

---

## 2. `shopOrder.service.js` → `listForBuyer` (was `listForSalon`)

```js
const listForBuyer = async ({ buyer, page = 1, status } = {}) => {
    const limit = DEFAULT_LIMIT;
    const safePage = parseInt(page, 10) > 0 ? parseInt(page, 10) : 1;
    const offset = (safePage - 1) * limit;

    const where = { ...buyerWhere(buyer) };          // { salonId } or { customerId }
    if (status) where.status = status;

    const { count: totalOrders, rows: orders } = await db.ShopOrder.findAndCountAll({
        where,
        include: [
            { model: db.Salon, as: 'salon', attributes: ['salonId', 'salonName', 'latitude', 'longitude'] },
            { model: db.User, as: 'customer', attributes: ['userId', 'fullName', 'phoneNumber'] }
        ],
        order: [['createdAt', 'DESC']],
        limit,
        offset
    });

    return {
        orders,
        pagination: { page: safePage, limit, totalOrders, totalPages: Math.ceil(totalOrders / limit) || 0 }
    };
};
```

Keep the old name as an alias if anything else imports it:

```js
const listForSalon = (salonId, page = 1) => listForBuyer({ buyer: { buyerType: 'SALON', buyerId: salonId }, page });
```

---

## 3. `shopOrder.service.js` → `getById` (ownership)

`getById` today returns any order by id. When a `buyer` is passed it must return
`null` for an order that is not theirs — the same answer as "does not exist",
so probing ids reveals nothing:

```js
const getById = async (orderIdOrId, { withEvents = false, buyer = null } = {}) => {
    const where = { [Op.or]: [{ orderId: orderIdOrId }, { id: orderIdOrId }] };
    const order = await db.ShopOrder.findOne({ where, include: /* …unchanged include list… */ });

    if (!order) return null;
    // Internal callers (admin, distributor, webhook) pass no buyer and keep
    // seeing everything. A buyer's own request must match the token.
    if (buyer && !buyerOwnsOrder(buyer, order)) return null;

    return withEvents ? order : order;
};
```

---

## 4. `shopOrder.service.js` → `cancelOrder`

```js
const cancelOrder = async (orderIdOrId, { buyer, reason = null, actor } = {}) => {
    const order = await getById(orderIdOrId, { buyer });          // ownership first
    if (!order) return null;
    if (order.status === 'DELIVERED' || order.status === 'CANCELLED') {
        throw new Error(`The order is already ${order.status.toLowerCase()}`);
    }
    if (order.status === 'OUT_FOR_DELIVERY') {
        throw new Error('The order is out for delivery and can no longer be cancelled');
    }

    const fromStatus = order.status;
    order.status = 'CANCELLED';
    order.customerStatus = 'CANCELLED';
    order.cancelledAt = new Date();
    await order.save();

    await logEvent(order, {
        ...(actor || buyerActor(buyer)),
        action: 'CANCELLED',
        fromStatus,
        toStatus: order.status,
        note: reason ? `Cancelled by the buyer — ${reason}` : 'Cancelled by the buyer'
    });

    return order;
};
```

---

## 5. `shopOrder.service.js` → `listForAdmin` (customer visibility + filter)

Two lines and one include:

```js
// accept the new optional filter
const listForAdmin = async ({ page = 1, status, customerStatus, salonId, distributorId,
                              searchString, buyerType } = {}) => {
    // …
    if (buyerType) where.buyerType = buyerType;      // 'SALON' | 'CUSTOMER'

    const { count, rows } = await db.ShopOrder.findAndCountAll({
        where,
        include: [
            // A customer order has salon === null, so the row must also bring
            // the customer or the dashboard has no name to show.
            { model: db.Salon, as: 'salon', attributes: ['salonId', 'salonName', 'phoneNumber', 'latitude', 'longitude', 'addressLine1', 'city'] },
            { model: db.User, as: 'customer', attributes: ['userId', 'fullName', 'phoneNumber'] },
            // …distributor + events, unchanged…
        ],
        // …
    });
```

`decorateForFulfilment` needs no change: it reads `deliveryLatitude/Longitude`,
which a customer order has, so the map and the KM keep working for both.

`searchString` already matches the salon name; add the customer's:

```js
where[Op.or] = [
    { '$salon.salonName$': { [Op.like]: `%${searchString}%` } },
    { '$customer.fullName$': { [Op.like]: `%${searchString}%` } },
    { '$customer.phoneNumber$': { [Op.like]: `%${searchString}%` } },
    { orderId: { [Op.like]: `%${searchString}%` } }
];
```

---

## 6. `shopCart.service.js`

Every function takes `buyer` instead of `salonId`:

```js
const getCart = async (buyer) => db.ShopCart.findAll({
    where: buyerWhere(buyer),
    order: [['createdAt', 'ASC']]
});

const addItem = async (buyer, { productId, qty = 1 }) => {
    const product = await db.ShopProduct.findByPk(productId);
    if (!product) throw new Error('Product not found');
    if (product.isAvailable === false) throw new Error('This product is out of stock');

    const where = { ...buyerWhere(buyer), productId };
    const existing = await db.ShopCart.findOne({ where });
    if (existing) {
        await existing.update({ qty: Math.min(MAX_QTY, existing.qty + qty) });
    } else {
        await db.ShopCart.create({ ...buyerColumns(buyer), productId, qty });
    }
    return getCart(buyer);
};

const setQty = async (buyer, { productId, qty }) => {
    const where = { ...buyerWhere(buyer), productId };
    const line = await db.ShopCart.findOne({ where });
    if (!line) return getCart(buyer);
    if (qty <= 0) await line.destroy();
    else await line.update({ qty });
    return getCart(buyer);
};

const removeItem = async (buyer, productId) => {
    await db.ShopCart.destroy({ where: { ...buyerWhere(buyer), productId } });
    return getCart(buyer);
};

const clear = async (buyer) => db.ShopCart.destroy({ where: buyerWhere(buyer) });
```

That is the entire cart service change: `{ salonId }` became
`{ ...buyerWhere(buyer) }` and `{ salonId, … }` on insert became
`{ ...buyerColumns(buyer), … }`.

---

## 7. Never trust the body

There is no `salonId`, `customerId` or `buyerId` anywhere in these signatures
except the ones `resolveShopBuyer` produced from the token. If a client sends
`salonId` in the body it is ignored — that is what stops a customer from
posting an order into a salon's history, or cancelling one.
