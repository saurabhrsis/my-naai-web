# Naai Shop — salon supply store

A Blinkit/Zepto-style shop for **salon partners**: they buy grooming stock
(products supplied by the MyNaai Platform) for their chairs, with add-to-cart,
a Blinkit-style ADD → quantity stepper, a floating "N items · ₹X → View cart"
bar, checkout with **Online (Razorpay) or Cash on Delivery**, a **My orders**
list with a live status tracker, and **cancel order** before dispatch.

## Where it lives

| Piece | File |
| --- | --- |
| Shop tab (salon nav, 3rd position) | `src/App.jsx` (`SALON_NAV`, routes `shop`, `shopProduct`, `shopCart`, `shopCheckout`, `shopOrders`, `shopOrder`) |
| Catalog + filters UI | `src/components/ShopScreen.jsx` |
| Product details page (tap a card) | `src/components/ShopScreen.jsx` (`ShopProductDetailScreen`, route `shopProduct?productId=`) |
| Cart + checkout + success | `src/components/ShopCartCheckout.jsx` |
| My orders + order detail/tracker | `src/components/ShopOrders.jsx` |
| Category / gender / price / sort rules | `src/lib/shopCatalog.js` |
| Cart, bill math, order lifecycle, timeline | `src/lib/shopOrders.js` |
| Order-less Razorpay checkout | `src/lib/razorpay.js` (`openRazorpayOrderlessCheckout`, `getRazorpayKeyId`) |
| Design tokens + all `.shop-*` styles | `src/styles.css` (bottom section) |
| Product editor category/gender fields | `src/components/SalonScreens.jsx` (`SalonProductsScreen`) |

## Flow

```
Shop tab ── search / category chips / gender chips / price range / sort
   │  tap a card ──────────────► Product details page ── ADD → stepper
   │                                        │  hero image, price + MRP + % off, seller,
   │  ADD → stepper (per product,           │  category/gender/stock tags, delivery facts,
   │  persisted to the cart)                │  description, "You may also like" (same
   │                                        │  category), floating cart bar
   ▼
"3 items · ₹1,240 → View cart" floating bar
   ▼
Cart ── steppers, remove, bill (item total, MRP savings, delivery fee)
   ▼
Checkout ── delivery address (prefilled from the salon profile, editable)
           └── Pay online (Razorpay, UPI/cards/netbanking)
           └── Cash on delivery
   ▼
Order placed ── success card with order id + "Arriving by …"
   ▼
My orders ── Active / All / Delivered / Cancelled tabs
   ▼
Order detail ── 4-step tracker (Placed → Packed → Out for delivery → Delivered),
                items, address, payment (id, refund state), Cancel order
```

- **Delivery fee:** ₹49, FREE above ₹499 (constants in `shopOrders.js`).
- **Timeline:** deterministic from `placedAt` — packed after 30 min, out for
  delivery after 3 h, delivered/ETA at 26 h. The tracker re-renders every
  30 s while open, the same wall-clock approach the booking queue uses.
- **Cancellation:** allowed while *placed* or *packed*; once *out for
  delivery* only support remains. A paid order that is cancelled flips its
  payment to **Refund requested** (refund to source in 5–7 working days, per
  the copy shown).

## Filters

- **Category chips:** Hair care · Beard & grooming · Skin & face · Fragrance ·
  Hair colour · Tools & equipment · Kits & sets (+ any category the backend
  sends that is not in the fixed list).
- **Gender chips:** Men / Women / Unisex.
- **Price:** Any · Under ₹500 · ₹500–₹1,000 · ₹1,000+.
- **Sort:** Popular (rating) · Price low→high · Price high→low.
- **Search** across name, salon and description.

All filtering is client-side over the catalog (`applyShopFilters` in
`shopCatalog.js` — pure, fully unit-tested). The catalog endpoint
(`POST /api/products/get-all-salons-products-list`) does not accept these
facets, so the portal classifies each product:

1. an explicit `category` / `gender` field on the product record, if the
   backend sends one — the salon product editor already offers both fields
   ("Shop category", "Shop gender") and sends them on create/update;
2. otherwise keyword inference from the product name (ordered rules, e.g.
   "beard" → beard-grooming, "clipper/razor" → tools & equipment);
3. otherwise the seller salon's `genderType` for gender; default unisex.

So the shop is useful on day one with the existing API and becomes exact the
moment the backend starts persisting the facets.

## Product details page

Tapping a card's image or name opens the **`shopProduct`** route (deep-linkable
as `shopProduct?productId=`) instead of an inline sheet:

- **Hero image** (contain, 4:3) with the % off badge and an out-of-stock veil;
- **Tags** — category, gender, in/out of stock — then the product name, the
  seller line (`Sold by <salon>` when the product is salon-listed, otherwise
  `Supplied by My Naai`) and the price row with struck-through MRP + rating;
- **Large ADD control** (the Blinkit-style in-page button, 44 px) above a
  **Delivery card** (next-day to the salon's city, free above ₹499, COD +
  online payment, free cancellation until dispatch) and an **About this
  product** card (description, with a fallback line when the backend sends
  none);
- **"You may also like"** — same category, available, self excluded, by rating
  (max 6), each card tappable to another details page;
- the floating **"N items · ₹X → View cart"** bar follows you, so a product
  added from the page lands in the same persistent cart as the grid.

Unknown ids render a graceful "Product not available" state (the catalog can
shrink under a bookmarked link); out-of-stock products render full details
with the control replaced by an "Out of stock" chip.

## Orders: client-side today, backend-ready tomorrow

The MyNaai backend exposes the product catalog but **no order endpoints yet**,
so the shop owns its orders in `src/lib/shopOrders.js`, persisted per salon
account in localStorage (`mynaaiShopCart:<salonId>`,
`mynaaiShopOrders:<salonId>`). This is deliberate, not a shortcut:

- every read/write funnels through the small storage functions at the bottom
  of that module, so wiring a real `/api/orders` controller later means
  replacing those functions — screens, cart and tracker do not change;
- online payments are real: Checkout opens **order-less** (key + amount, no
  backend Razorpay order) and the returned `razorpay_payment_id` is stored on
  the order for support/refunds;
- the deterministic timeline keeps "check order status" honest even without a
  warehouse system: the status is a function of `placedAt`, never of server
  state the portal cannot see.

When order endpoints land, the mapping is: `placeOrder` → `POST /api/orders`,
`readOrders`/`findOrder` → the list/detail endpoints, `getOrderStatus` →
server status (the timeline becomes the fallback for a missing status), and
`cancelOrder` → the cancel endpoint.

## Previewing offline

The production API is not reachable in every sandbox, so `vite.config.js`
ships a dev-only fixture (behind `MYNAAI_DEV_MOCK_API=1`, `apply: 'serve'` —
never in a build, never on by default) that also answers the shop endpoints
and a demo salon login: sign in as **Salon partner** with *any* 10-digit
number and *any* 6-digit OTP to walk the whole shop flow:

```bash
MYNAAI_DEV_MOCK_API=1 npm run dev
```
