# my_naai_backend
## Naai Shop e-commerce API

B2B shop: a salon buys stock from the shared product catalog (the same
`products` table the existing salon product flow writes to). The web portal
(`my-naai-web`) keeps its cart in the browser and pays **order-less** through
Razorpay Checkout; the endpoints below are the durable order record. All
routes are `POST` and answer `{ status, message, data }`.

### Product shop fields (existing product API, extended)

`POST /api/products/create` and `POST /api/products/update` accept four
optional shop fields (existing payloads keep working unchanged):

| Field         | Type             | Notes                                                        |
| ------------- | ---------------- | ------------------------------------------------------------ |
| `mrp`         | number ≥ 0       | Max retail price — drives the "% off" badge in the shop UI   |
| `category`    | string           | One of the shop category ids; blank = inferred from the name |
| `gender`      | `MALE\|FEMALE\|UNISEX` | Blank = `UNISEX`                                        |
| `description` | string ≤ 2000    | Product detail copy                                          |

Both `POST /api/products/list` and `POST /api/products/get-all-salons-products-list`
return these fields on every product.

### Product APIs — authentication

| Route | Token |
| ----- | ----- |
| `/api/products/get-all-salons-products-list` (marketplace catalog) | **user OR salon** — `authenticateUserOrSalon` accepts either claim: the mobile app browses as a customer, the web shop as a salon. The salon include also returns `genderType` so the shop can fall back to the *selling* salon's gender for products without an explicit one. |
| `/api/products/create`, `/update`, `/list`, `/delete` | salon (own catalog only) |
| `/api/products/admin-list` | admin — every salon's products; filters `salonId`, `isAvailable`, `searchString` (name or salon name), `page` |
| `/api/products/admin-create` | admin — `salonId` is required and must be an existing salon; full shop fields supported |
| `/api/products/admin-update` | admin — partial update of ANY salon's product; `isAvailable` also syncs `stockStatus` |
| `/api/products/admin-delete` | admin — delete ANY salon's product |

### Shop orders — salon token (`Authorization: Bearer <salon jwt>`)

| Route                        | Body                                                                                          | Result                                                        |
| ---------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `/api/shop-orders/create`    | `{ items[], address{}, payment{ method, status, paymentId }, notes? }`                         | Order created. Bill (`itemTotal`, `savings`, `deliveryFee`, `total`) is **recomputed server-side** from `items` — the client amounts are ignored. `items` is the exact cart snapshot the frontend sends (`productId, name, price, mrp, image, category, gender, salonName, qty`). `address` = `{ name, phone(10 digits), line1, city, state?, pincode(6 digits) }`. Paid-online orders start `CONFIRMED`, everything else `PENDING`. |
| `/api/shop-orders/list`      | `{ page? }`                                                                                    | The calling salon's own orders, newest first, paginated       |
| `/api/shop-orders/get-by-id` | `{ orderId }` (uuid `id` also works)                                                           | One own order — 404 for other salons' orders                  |
| `/api/shop-orders/cancel`    | `{ orderId, reason? }`                                                                         | Free cancellation while `PENDING`/`CONFIRMED`; a paid online order is flagged `REFUND_REQUESTED` |

### Shop orders — admin token

| Route                            | Body                                              | Result                                        |
| -------------------------------- | ------------------------------------------------- | --------------------------------------------- |
| `/api/shop-orders/admin-list`    | `{ page?, status?, salonId?, searchString? }`     | Every salon's orders, newest first            |
| `/api/shop-orders/admin-get-by-id` | `{ orderId }`                                    | Any order                                     |
| `/api/shop-orders/admin-update-status` | `{ orderId, status, notes? }`               | Moves the order through `PENDING → CONFIRMED → PROCESSING → SHIPPED → DELIVERED` or `CANCELLED` (cancelling a paid order flags a refund) |

### Razorpay webhook

`POST /api/razorpay/webhook` — public, but **signature-verified**: HMAC-SHA256
over the raw body with `RAZORPAY_WEBHOOK_SECRET` (set in the Razorpay
dashboard → Webhooks, and in the server env) compared against the
`x-razorpay-signature` header.

- `payment.captured` → the shop order carrying that `razorpay_payment_id`
  is marked `PAID` and `CONFIRMED`
- `payment.failed` / `payment.refunded` → the order's payment is flagged
- Anything else is acknowledged with 200 so Razorpay stops retrying

Env knobs: `SHOP_DELIVERY_FEE` (default `49`), `SHOP_FREE_DELIVERY_ABOVE`
(default `499`) — same thresholds as the shop UI's free-delivery bar.
