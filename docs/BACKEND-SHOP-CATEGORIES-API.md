# Backend — one product-category list for admin, website and app

> **Implemented by** `patches/backend-1-shop-categories.patch` (real code:
> model, service, five controllers, routes, the public door, the schema guard and
> the migration). Apply instructions: `patches/APPLY-2026-11-05.md`.

Target repo: `rightserveinfotechsystems/my_naai_backend`
Web client already implemented: `src/lib/shopCategories.js` (reader + cache)
Migration: `patches/migrations/2026-11-05-booking-requests-categories.sql` (§1)

## The problem this removes

The shop classifies products in the browser (`src/lib/shopCatalog.js`): an
ordered keyword guess over the product name, plus whatever free text the admin
panel wrote into `shop_products.category`. Two consequences the client reported:

- The admin sees a category list it manages; the website shows *its own* inferred
  buckets, so a filter the admin creates is invisible to customers.
- Free text from the panel ("Hair Colour and Chemical Products") is mapped by
  guesswork — a bottle of herbal hair oil filed under a colour-ish string shows
  up as **HAIR COLOUR** on the card.

The fix is one table, one endpoint, one list — and the storefront stops guessing
as soon as a product carries a real category id.

## 1. The table

```sql
CREATE TABLE shop_categories (
    id         VARCHAR(64) PRIMARY KEY,   -- slug, stored on the product
    label      VARCHAR(120) NOT NULL,     -- what customers read
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Seeded with the seven the shop already uses (same ids, same labels, same order
— the website ships them as its fallback list, so a backend without the endpoint
still matches):

| id | label | sort_order |
|---|---|---|
| `hair-care` | Hair care | 0 |
| `beard-grooming` | Beard & grooming | 1 |
| `skin-face` | Skin & face | 2 |
| `fragrance` | Fragrance | 3 |
| `hair-colour` | Hair colour | 4 |
| `tools-equipment` | Tools & equipment | 5 |
| `kits-sets` | Kits & sets | 6 |

`shop_products.category` stores the **id**. It stays a free-text column so old
rows keep working; the API validates new writes against this table.

## 2. Endpoints

| Endpoint | Who | Body | Answer |
|---|---|---|---|
| `POST /api/shop-categories/list` | any signed-in user | `{}` | active categories, `sort_order` ascending |
| `POST /api/shop-public/categories/list` | public, no token | `{}` | same list (cacheable, 5 min) |
| `POST /api/shop-categories/admin/list` | admin | `{ "includeInactive": true }` | every category + `productCount` |
| `POST /api/shop-categories/admin/create` | admin | `{ "label": "Nail care", "sortOrder": 7 }` | the row, with the generated id |
| `POST /api/shop-categories/admin/update` | admin | `{ "id": "...", "label": "...", "sortOrder": 3, "isActive": false }` | the row |
| `POST /api/shop-categories/admin/delete` | admin | `{ "id": "..." }` | `FAILED` unless `productCount === 0` (or `{ "reassignTo": "hair-care" }` was sent) |

Answer shape (the web client accepts `data.categories`, `data.categoryList`,
`data.list`, `data.items` or a bare array):

```json
{
  "status": "SUCCESS",
  "data": {
    "categories": [
      { "id": "hair-care", "label": "Hair care", "sortOrder": 0, "isActive": true }
    ]
  }
}
```

Rules:

- **The id is a slug of the label** (`Tools & equipment` → `tools-and-equipment`)
  when the admin creates a category without one. The client and the panel use the
  same rule, so a category created in either place has the same id.
- **Renaming a label must not change the id** — products reference the id. The
  admin UI should say so.
- **Deleting a category with products** must fail with a message that names the
  count, or reassign them; silently orphaning products is what makes a shelf
  vanish.
- `is_active = false` hides the category from the storefront filter but keeps it
  on the products that already use it (the client appends those categories to
  the select itself, so a retired shelf is still reachable).
- The public door is rate-limited like the other `/api/shop-public/*` reads.

## 3. What the website and app do with it

`useShopCategories()` (in `src/lib/shopCategories.js`) reads the public or the
signed-in door, caches the answer in `localStorage` (`mynaai:shop-categories:v1`),
and renders the shop's **Category** filter from it. Until it answers — or if it
never does — the built-in seed list is used, so the shop never renders an empty
filter.

The guest shop reads the public door; a signed-in customer/salon reads the
partner door first and falls back to the public one (the same two-door pattern
the catalog uses, so a rolling deploy cannot leave the filter blank).

## 4. Acceptance checks

1. Adding a category in the admin panel makes it appear in the website's shop
   filter after a reload — with no front-end deploy.
2. The order in the panel is the order in the filter (`sort_order`).
3. A product written with `category: "tools-equipment"` shows **Tools &
   equipment** on its card and details page (no inference involved).
4. A product whose old free-text category is not in the table still shows a
   filter of its own (the client keeps unknown ids reachable).
5. `POST /api/shop-public/categories/list` works with no token and needs no
   partner middleware.
