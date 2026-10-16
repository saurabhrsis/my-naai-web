# Naai Shop e-commerce API — install these files into the backend repo

This folder contains **exactly the 27 files** that the shop-API work changed
in `rightserveinfotechsystems/my_naai_backend` (branch
`feature/naai-shop-ecommerce-api`, commits `487f55e`, `65f2529`, `119b492`
on top of `0825e96`).

> **Why the files are here:** the backend repo could not be pushed from the
> Arena sandbox (the sandbox GitHub login can only write to *this* frontend
> repo). So the files travel through the frontend repo and you push them to
> the backend from your machine — where your account has access.
>
> **Note:** the two key files that live in the backend repo's `main`
> (`gcp-key.json`, `src/firebase/myNaai-firebase.json`) are deliberately
> NOT included here — this frontend repo's security rules block them. They
> already exist in your backend clone, so nothing is missing.

The files keep their backend-repo paths (e.g. `src/routes/shopOrder.routes.js`
goes to `my_naai_backend/src/routes/shopOrder.routes.js`).

## Method A — one command in your terminal (fastest)

In a folder next to your `my_naai_backend` clone:

```bash
cd my_naai_backend
git fetch https://github.com/saurabhrsis/my-naai-web.git naai-backend/shop-ecommerce-api-files
git checkout FETCH_HEAD -- .
git add -A
git commit -m "Naai Shop e-commerce API: shop orders, dual-auth marketplace catalog, admin product management"
git push origin HEAD:feature/naai-shop-ecommerce-api
```

That's it — the branch `feature/naai-shop-ecommerce-api` now exists in the
backend repo and you can open the PR from there.

## Method B — no terminal (copy & paste)

1. In this repo on GitHub, open branch `arena/b1135ded-my-naai-web` →
   **Code → Download ZIP** (or use the zip of branch
   `naai-backend/shop-ecommerce-api-files`, which contains ONLY these 27
   files).
2. Unzip it.
3. Copy everything inside `backend-shop-api/` (except this `INSTALL.md` and
   `copy-to-backend.sh`) into your `my_naai_backend` folder, keeping the
   same folder structure — i.e. `src/...` on top of `src/...`.
   (Or run `sh copy-to-backend.sh /path/to/my_naai_backend` from this
   folder — it does the copy for you.)
4. In your backend repo: stage the changes, commit with the message above,
   push branch `feature/naai-shop-ecommerce-api`, then open the PR.

## What the API adds (quick reference)

- **Shop orders**: create / list / get / cancel customer orders + admin
  list / get / update-status (`/api/shop-order/*`)
- **Razorpay webhook** for order payment capture
- **Dual-auth marketplace catalog**: public users *and* salon owners can
  list products (`authUserOrSalon` middleware)
- **Admin product management**: create / list / update / delete products
- **Compatibility**: existing salon-added products keep working; `gender`
  is nullable (no UNISEX default)
