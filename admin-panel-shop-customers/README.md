# Admin panel: customer shop orders

Target repo: `rightserveinfotechsystems/my-naai-frontend` (the admin panel).

Shop orders are no longer salon-only. A customer (the mobile/web **USER** role)
buys from the same catalog through the same endpoints, so the dashboard now
receives two kinds of row:

```json
{
  "orderId": "MN17926482357024C4K",
  "buyerType": "CUSTOMER",
  "salon": null,
  "customer": { "userId": "…", "fullName": "Sneha Waghmare", "phoneNumber": "9876543210" },
  "status": "PENDING_ASSIGNMENT",
  "items": [], "address": {}, "payment": {}, "amounts": {},
  "deliveryLocation": { "latitude": 21.14, "longitude": 79.08, "hasLocation": true },
  "events": []
}
```

A salon order keeps `buyerType: "SALON"` and its `salon` object exactly as
today. When `buyerType` is missing (a row created before the migration) the
panel must treat it as a salon order.

Nothing about the distributor workflow changes: a customer order has the same
delivery point, address, items and status track, so assign → accept → picked →
shipped → delivered works untouched.

## What is in this folder

| File | Purpose |
| --- | --- |
| `src/components/shopOrders/buyer.js` | `buyerOf(order)`, `isCustomerOrder`, `buyerTypeParam`, `telHref` — the only place that decides "who bought this" |
| `src/components/shopOrders/BuyerUi.jsx` | `<BuyerBadge>`, `<BuyerCell>`, `<BuyerSummary>`, `<BuyerTypeFilter>` |
| `src/components/shopOrders/shop-orders-buyer.css` | styles for the above (neutral, overridable) |

Copy the whole `src/components/shopOrders/` folder into the panel, keeping the
relative import between the three files.

## The three changes

### 1. Orders table — show the buyer

In the buyer column (today the salon name):

```jsx
import { BuyerCell } from './shopOrders/BuyerUi';

<td><BuyerCell order={order} /></td>
```

`BuyerCell` renders the salon name for a salon order (unchanged) and, for a
customer, the customer's name with a **Customer** badge and a tap-to-call
number.

### 2. Order drawer — the Customer block

Where the drawer currently renders the salon card:

```jsx
import { BuyerSummary } from './shopOrders/BuyerUi';

<BuyerSummary order={order} />
```

It swaps to a *Customer* block (name, phone, "Customer order · no salon
account") when `order.buyerType === 'CUSTOMER'`. The delivery address, the map
pin and the KM distance stay exactly where they are — they are the same columns
for both buyers.

### 3. Filter — Buyer type

Next to the existing salon filter:

```jsx
import { BuyerTypeFilter } from './shopOrders/BuyerUi';
import { buyerTypeParam } from './shopOrders/buyer';

const [buyerType, setBuyerType] = useState('');

<BuyerTypeFilter value={buyerType} onChange={setBuyerType} />

// when loading page 1:
api.post('/api/shop-orders/admin-list', {
  page: 1,
  searchString,
  ...(buyerTypeParam(buyerType) ? { buyerType: buyerTypeParam(buyerType) } : {}),
});
```

Any other filter change must reset to `page: 1`, as the existing filters do.

### Also worth doing (backend already supports it)

- **Search** matches the customer's name and phone too, so typing a customer's
  number finds their orders without knowing the order id.
- **CSV / export** (if the panel has one): export `buyerOf(order).name` and
  `buyerOf(order).type` instead of `order.salon.salonName`, or the column is
  blank for every customer row.

## Rollout

The panel can ship **before** the backend: `buyerOf` treats a missing
`buyerType` as a salon order and every current row is one. Ship the panel
change with the backend migration, then verify with one customer order:
it should appear with the Customer badge, open with a Customer block, and be
assignable to a distributor exactly like a salon order.
