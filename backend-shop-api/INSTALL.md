# Naai Shop e-commerce API — install these files into the backend repo

This folder contains the **complete file set** the Naai Shop work changed in
`rightserveinfotechsystems/my_naai_backend` (relative to base commit
`0825e96`). It **replaces** the previous 27-file bundle: the shop now runs on
its own tables and the legacy product API is back to its original shape.

> **Why the files are here:** the backend repo could not be pushed from the
> Arena sandbox (the sandbox GitHub login can only write to *this* frontend
> repo). So the files travel through the frontend repo and you push them to
> the backend from your machine — where your account has access.
>
> **Note:** the two key files that live in the backend repo's `main`
> (`gcp-key.json`, `src/firebase/myNaai-firebase.json`) are deliberately
> NOT included here — this frontend repo's security rules block them. They
> already exist in your backend clone, so nothing is missing.

## What this bundle does (request 24)

- **Two separate product tables.** The salons' customer-facing products
  (`products`) are untouched again — the 7 legacy product files in this
  folder are byte-identical to base `0825e96` and exist only to overwrite
  the copies from the previous bundle, if you applied it. The shop catalog
  is the new company-owned `shop_products` table (no `salonId`).
- **Server-side cart per buying salon** (`shop_carts`) — the same account
  sees the same cart on the web and the mobile app.
- **Distributors** (`distributors`) — delivery partners the company admin
  assigns orders to (`/api/shop-orders/admin-assign-distributor`).
- **Two status tracks on `shop_orders`** — an INTERNAL track for
  admin/distributor (`PENDING_ASSIGNMENT → ASSIGNED → PICKED → SHIPPED →
  DELIVERED`) and a SALON track (`customerStatus`: `PENDING → CONFIRMED →
  PROCESSING → SHIPPED → DELIVERED`); salon responses only ever carry the
  salon track, never the distributor.
- **Razorpay webhook** confirms the payment on the salon track only.
- **`GET /test-db` now syncs in passes** — models auto-load alphabetically,
  but a table can only be created once its foreign-key targets exist
  (`shop_carts` → `shop_products`). A model that fails on one pass is
  retried on the next, so the four new tables create themselves in the
  right order. Existing tables are unaffected (only new tables are created).
- **Deletes** the four admin product controllers the previous bundle added
  (they managed the merged table that no longer exists).

## Method A — one command in your terminal (fastest)

In your `my_naai_backend` clone:

```bash
cd my_naai_backend
git fetch https://github.com/saurabhrsis/my-naai-web.git naai-backend/shop-ecommerce-api-files
git checkout FETCH_HEAD -- .
git add -A
git commit -m "Naai Shop e-commerce API: separate shop_products table, server cart, distributors, two status tracks"
git push origin HEAD:feature/naai-shop-ecommerce-api
```

That's it — the branch `feature/naai-shop-ecommerce-api` now exists in the
backend repo and you can open the PR from there. **Nothing is deleted:** the
sync only creates the missing shop tables, your existing data is untouched.

> *Optional cleanup (only if you applied the earlier 27-file bundle): it had
> added four admin product controllers that the new design doesn't use —
> `adminCreateProduct.js`, `adminDeleteProduct.js`, `adminListProducts.js`,
> `adminUpdateProduct.js` in `src/controller/product/`. No route loads them
> anymore, so leaving them is harmless; delete them only if you want the PR
> clean.*

## Method B — no terminal (copy & paste)

1. In this repo on GitHub, open branch `arena/b1135ded-my-naai-web` →
   **Code → Download ZIP** (or use the zip of branch
   `naai-backend/shop-ecommerce-api-files`, which contains only these files).
2. Copy the `backend-shop-api/` folder's contents (keeping the
   `src/...` structure, plus `index.js` and `README.md`) into your
   `my_naai_backend` clone, overwriting the old files.
3. In your backend clone: `git add -A`, commit, and push to
   `feature/naai-shop-ecommerce-api`.

(No deletion step is needed — see the optional cleanup note above.)

## Environment notes

- The new tables (`shop_products`, `shop_carts`, `distributors`,
  `shop_orders` incl. the new `customer_status` / `distributor_id` columns)
  are created by the existing `GET /test-db` table sync, same as every other
  model — nothing to run by hand.
- `RAZORPAY_WEBHOOK_SECRET` (webhook signature) must match the secret
  configured in the Razorpay dashboard → Webhooks.
- Optional env: `SHOP_DELIVERY_FEE` (default 49), `SHOP_FREE_DELIVERY_ABOVE`
  (default 499), `PAGE_LIMIT` (default 20) — same thresholds the shop UI
  already uses.
