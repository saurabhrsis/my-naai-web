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
| Server sync (cart + orders per account) | `src/lib/shopServerSync.js` |
| Order-less Razorpay checkout | `src/lib/razorpay.js` (`openRazorpayOrderlessCheckout`, `getRazorpayKeyId`) |
| Design tokens + all `.shop-*` styles | `src/styles.css` (bottom section) |
| Product editor (category/gender + **multiple image uploads**) | `src/components/SalonScreens.jsx` (`SalonProductsScreen`) |
| Multi-image parsing (`productImage` comma list → ordered array) | `src/lib/shopCatalog.js` (`parseProductImages`) |

## Flow

```
Shop tab ── search / Category · For · Price selects (one compact strip)
   │  header: My cart (N) · My orders
   │  tap a card ──────────────► Product details page ── ADD → stepper
   │                                        │  photo gallery (cover + thumbs,
   │  ADD → stepper (per product,           │  multiple admin-uploaded photos),
   │  persisted to the cart)                │  price + MRP + % off, seller, tags,
   │                                        │  delivery facts, description,
   │                                        │  "You may also like", cart bar
   ▼
"3 items · ₹1,240 → View cart" floating bar
   ▼
Cart ── Blinkit-style rows: quantity stepper (minus at 1 removes the
           line), per-line totals, free-delivery progress bar, bill (item total,
           MRP savings + "you saved" line, delivery fee), to-pay footer bar
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

- **Delivery fee / free threshold / discount % / COD rules:** admin-managed
  in the **Shop Settings** tab (the backend's `shop_settings` row — see
  "Admin-managed bill rules" below); the defaults are ₹49, FREE above ₹499,
  no discount, COD unlimited, no COD surcharge. The web fetches the same row
  once per session and the backend **recomputes the bill server-side** at
  order time, so display and charge always match.
- **Timeline:** server-tracked orders follow the salon status track (see
  below); local-only orders fall back to a deterministic timeline from
  `placedAt` — packed after 30 min, out for delivery after 3 h, delivered/ETA
  at 26 h. The tracker re-renders every 30 s while open.
- **Cancellation:** server-tracked orders cancel while the salon track is
  `PENDING` / `CONFIRMED` / `PROCESSING` (parcel not yet out for delivery);
  local-only orders while *placed* or *packed*. A paid order that is
  cancelled flips its payment to **Refund requested** (refund to source in
  5–7 working days, per the copy shown).

## Filters

The whole filter area is one compact strip of **three labelled selects**
(Category · For · Price) — no chip rows and no sort control, so the grid
starts high on the screen and the space stays free for products. Default
order is always *popular* (rating, high to low). The shop header also carries
a **My cart** shortcut (with the live item count) beside **My orders**.

- **Category:** All + Hair care · Beard & grooming · Skin & face · Fragrance ·
  Hair colour · Tools & equipment · Kits & sets (+ any category the backend
  sends that is not in the fixed list).
- **For:** All / Men / Women / Unisex.
- **Price:** Any price · Under ₹500 · ₹500–₹1,000 · ₹1,000+.
- **Search** across name, salon and description.

Delivery facts (the free-delivery threshold, order-by) come from the
admin-managed `shop_settings` row (default free above ₹499), so the shop no
longer renders a delivery banner — only the bill card and the details-page
delivery card still state the fee/free rule, and they read it live from the
same settings the backend bills against.

All filtering is client-side over the catalog (`applyShopFilters` in
`shopCatalog.js` — pure, fully unit-tested). The catalog endpoint
(`POST /api/shop-products/list`) does not accept these
facets, so the portal classifies each product:

1. an explicit `category` / `gender` field on the product record, if the
   company admin set one when creating the shop product
   (`POST /api/shop-products/admin-create`);
2. otherwise keyword inference from the product name (ordered rules, e.g.
   "beard" → beard-grooming, "clipper/razor" → tools & equipment);
3. otherwise unisex (there is no selling salon to borrow a gender from —
   the catalog is company-wide).

So the shop is useful on day one with the existing API and becomes exact the
moment the backend starts persisting the facets.

## Product details page

Tapping a card's image or name opens the **`shopProduct`** route (deep-linkable
as `shopProduct?productId=`) instead of an inline sheet:

- **Hero image** (contain, 4:3) with the % off badge and an out-of-stock veil;
- **Tags** — category, gender, in/out of stock — then the product name, the
  seller line (`Sold by <salon>` when the product is salon-listed, otherwise
  `Supplied by My Naai`) and the price row with struck-through MRP + rating;
- **Large ADD control** (the Blinkit-style in-page button, 44 px), then an
  **About this product** card (description, with a fallback line when the
  backend sends none) and — deliberately **after the description**, so the
  terms are read with the product they belong to — the **Delivery card**:
  *Next-day delivery to your salon · FREE on this item* (FREE only when the
  item clears the free-delivery threshold, otherwise *free above ₹X*),
  *Cash on delivery available · online payment via UPI, cards & netbanking*
  (the COD half drops out when the item is above the admin's COD limit, so
  the page never promises a payment the checkout will refuse), and
  *Free cancellation until the order goes out for delivery*. Every line is
  driven by the admin-managed shop settings (below), not by constants;
- **Photo gallery** — products can carry multiple admin-uploaded photos
  (the editor joins them into the single `productImage` field with commas,
  the same file-path pattern the home-screen salon photos use; `getFileUrl`
  normalises each one at render time). The details page shows the cover big
  with a thumbnail strip; the card and cart use the first photo as the cover
  (the admin catalog card shows a "+N more" badge);
- **"You may also like"** — same category, available, self excluded, by rating
  (max 6), each card tappable to another details page;
- the floating **"N items · ₹X → View cart"** bar follows you, so a product
  added from the page lands in the same persistent cart as the grid.

Unknown ids render a graceful "Product not available" state (the catalog can
shrink under a bookmarked link); out-of-stock products render full details
with the control replaced by an "Out of stock" chip.

## Cart & orders: server-side, per account

The shop's cart and order history live **in the backend, keyed to the salon
account** (`shop_carts` / `shop_orders` tables — see the Naai Shop section of
the `my_naai_backend` README), so an item added on the web shows up when the
same salon logs into the mobile app, and the order history follows the
account, not the browser.

**Two separate product tables on the backend.** The salons' customer-facing
products (`products`, edited by each salon, browsed by the app's customers
under `/api/products/*`) are NOT the shop catalog. The shop browses the
**company's** `shop_products` table via `POST /api/shop-products/list`
(`api.shopProductList`) — no `salonId` anywhere in it.

**How the client stays in sync** (`src/lib/shopServerSync.js`):

- the localStorage copy (`mynaaiShopCart:<salonId>`,
  `mynaaiShopOrders:<salonId>`) is the in-session + offline + guest cache and
  updates instantly on every action;
- on mount, a signed-in account **pulls** the server cart (and order list) —
  the server copy wins and is persisted back into the local cache;
- every add / set-qty / remove / clear is pushed **fire-and-forget** at
  `POST /api/shop-cart/*` — a failed push never breaks the session (the local
  copy survives, the next mount re-syncs);
- at checkout the order is written locally first (`placeOrder` generates the
  `MN…` id), the success card renders instantly, and then the same id is
  **registered** on the server (`POST /api/shop-orders/create`) — the local
  and server records share one identity; a successful registration clears the
  server cart;
- guests (no session token) never touch the network and keep the pure
  localStorage behaviour; online payments stay order-less (Razorpay Checkout
  key + amount), and the `razorpay_payment_id` the client stores on the order
  is what the backend's signed webhook flips to PAID.

**Two status tracks.** The order carries an INTERNAL track (what the company
admin and the assigned **distributor** see:
`PENDING_ASSIGNMENT → AWAITING_ACCEPTANCE → ASSIGNED → PICKED → SHIPPED →
DELIVERED`, moved through `admin-assign-distributor`,
`distributor-accept`/`distributor-reject` (a rejection with a reason sends
the order back to `PENDING_ASSIGNMENT` for re-assignment),
`distributor-update-status` (the distributor advances PICKED → SHIPPED →
DELIVERED themselves, next-step-only) and `admin-update-status`) and a
SALON track (what the buying salon sees). The
salon responses only ever carry the salon track as `status`; the internal
track and the distributor never cross to the client. Every admin/distributor
action is appended to `shop_order_events` (the complete record shown on the
admin dashboard: who, what, before/after status, reason). The 4-step tracker
maps the salon track onto it:

| salon track  | tracker step        |
| ------------ | ------------------- |
| `PENDING`    | Order placed        |
| `CONFIRMED`  | Packing your order  |
| `PROCESSING` | Out for delivery    |
| `SHIPPED`    | Out for delivery    |
| `DELIVERED`  | Delivered           |
| `CANCELLED`  | Cancelled           |

An order fetched from the server carries its raw value as
`order.serverStatus`; the tracker and the cancel gate use it when present,
and fall back to the deterministic `placedAt` timeline for local-only orders
(offline placements, guests).

**Admin-managed bill rules (`shop_settings`).** The delivery fee, the
free-delivery threshold, an order-wide discount %, the COD limit and the COD
surcharge are no longer constants — the company admin edits the five values
in the **Shop Settings** tab of the admin panel (single row on the backend,
`POST /api/shop-settings/admin-update`, self-seeding with the historic
₹49 / free-above-₹499 / no-discount / no-limits defaults). The web shop
fetches the same row once per session (`api.shopSettingsGet` →
`useShopSettings`, `src/lib/shopSettings.js`) and threads it through
`cartTotals(lines, settings, { method })` — so the product page, the cart
bill, the checkout bill (which adds the COD charges while COD is selected)
and the "add ₹X more for FREE delivery" progress bar all agree with each
other and with the server: `createOrder` **recomputes the bill from the
lines + settings** and ignores any client amounts, and it rejects a COD
order whose item total is above the COD limit with a friendly 400 (the
checkout greys the COD radio with the reason, so the customer sees it up
front). The free-delivery threshold applies to the after-discount subtotal,
so a discount can push an order below the free line — and the progress bar
runs on that same subtotal. If the settings fetch fails (offline, or a
deployment ahead of the backend), the shop falls back to the same defaults
the server seeds, so the displayed bill still matches the billed bill.
Order records keep the frozen amounts (item total, discount, delivery fee,
COD charges, total), so a later settings change never rewrites history.

**Cancellation** is server-authoritative for server-tracked orders
(`POST /api/shop-orders/cancel` — free while the parcel has not left the
depot, i.e. until the salon track passes `PROCESSING`); the local timeline
gate applies to local-only orders. A paid order that is cancelled is flagged
**Refund requested** (refund to source in 5–7 working days, per the copy
shown).

## Previewing offline

The production API is not reachable in every sandbox, so `vite.config.js`
ships a dev-only fixture (behind `MYNAAI_DEV_MOCK_API=1`, `apply: 'serve'` —
never in a build, never on by default) that also answers the shop endpoints
and a demo salon login: sign in as **Salon partner** with *any* 10-digit
number and *any* 6-digit OTP to walk the whole shop flow:

```bash
MYNAAI_DEV_MOCK_API=1 npm run dev
```
