# The shop's "Load more 88" — why it happened, and the fix in both repos

Reported from the live shop: the first load is fine, but as soon as a category is
picked only two products appear while the button underneath still reads
**"Show more products (88)"** — every time, whatever the filter.

Two separate mistakes produced that number, one in each repository. This is what
each side now does, and how to ship the backend half.

---

## What was wrong

### The web (this repo) quoted a count it had not re-read

`src/components/ShopScreen.jsx` shows:

```js
const remaining = Math.max(0, pages.total - products.length);
```

`pages.total` is `pagination.totalProducts` from the **first request of the
current query**. The number is honest about that request — but the grid below it
is `applyShopFilters(products, filters)`, a second, client-side narrowing. Any
row the client re-files differently is counted by the server and not drawn by the
grid, so the count drifts away from the cards. "88" was the size of a much larger
answer, re-quoted under a filter that holds two products.

### The backend filtered the category as a *superset*

`src/services/shopProduct.service.js` (`listCatalog`) did filter in SQL, but its
`category` clause matched more than the shelf:

```js
// the requested id, the label an admin typed,
// OR category IS NULL OR category = ''
// OR category NOT IN (<known ids>)
```

That was deliberate — most rows predate the category column, and the client can
classify a name — but it means a filtered query still counts most of the catalog.
`findAndCountAll` then returns `totalProducts` for *that* superset, so the number
the web quotes is a count of rows the web is about to hide. Same shape for gender.

Loosening the client predicate instead was not an option: it would fill a
category with products from other categories.

---

## What both sides do now

### One taxonomy, resolved the same way on both sides

A product's category is:

1. its explicit `category` value, when that is a category id (a slug such as
   `hair-care`, including one the admin added after this build) or a category
   label (`Hair care`);
2. otherwise, the free text an older admin record carries, read by the keyword
   rules (`Hair Colour and Chemical Products` → `hair-colour`);
3. otherwise the ordered keyword inference on the product's name;
4. otherwise `hair-care`, the broadest shelf.

Gender resolves the same way: an explicit `MALE`/`FEMALE`/`UNISEX` wins, then the
name's inference, then `UNISEX`.

That precedence existed in `src/lib/shopCatalog.js` (this repo) and now exists on
the server too, in `src/services/shopCategoryRules.js` of the backend patch. Both
sides pin the same rows:

| Where | What it proves |
| --- | --- |
| `src/lib/shopCatalog.test.js` → `category classification parity with the backend` | thirteen sample products land on the shelves the server puts them on, and an explicit value is read with the same precedence |
| `backend/scripts/test-shop-categories.js` (`npm run shop:test-categories`) | the same thirteen products, the same explicit values, plus the SQL the filter is built from |

A rule added on one side and not the other now fails a test instead of quietly
reproducing this bug in production.

### The server filters, counts and pages the *same* list

The backend patch compiles those rules into a `CASE` expression
(`categoryCaseSql()` / `genderCaseSql()`) and compares it in `WHERE`:

```sql
WHERE (CASE WHEN lower(coalesce(category,'')) ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
              THEN lower(coalesce(category,''))
            WHEN lower(coalesce(category,'')) = 'hair care' THEN 'hair-care'
            …
            WHEN lower(product_name) LIKE '%shampoo%' THEN 'hair-care'
            ELSE 'hair-care' END = 'hair-care')
```

`findAndCountAll` needs no join — the expression only reads the row it counts —
so `totalProducts`, `totalPages` and the rows of page *N* describe one list. The
answer is always the shelf that was asked for, including rows whose `category`
column is empty or free text.

### The web stops quoting a number the grid contradicts

`ShopScreen.jsx` now only prints the count when the count describes the grid:

```js
const loaded = products.length;
const countDescribesGrid = visible.length === loaded;
const remaining = Math.max(0, pages.total - loaded);
// …Show more products{countDescribesGrid && remaining > 0 ? ` (${remaining})` : ''}
```

On the fixed backend `visible.length === loaded` always holds (the server already
applied the filter), so the count shows and is correct. Against an older backend
— a deployment that has not taken the patch yet — the count is dropped rather
than lying, and "Show more products" keeps working. The extra predicate
(`applyShopFilters`) stays, because an unfiltered older deployment still needs
it; it is now only a safety net, never the source of the number.

---

## Shipping it

The web half is in this repository. The backend half is
[`patches/backend-shop-category-filter.patch`](../patches/backend-shop-category-filter.patch)
— one commit, applied on top of the backend's current `main` (`1b43fd9`):

```bash
cd my_naai_backend
git am /path/to/patches/backend-shop-category-filter.patch
npm run shop:test-categories            # 13 names, explicit values, SQL shape
npm run shop:backfill-categories        # dry run: what it would re-file
npm run shop:backfill-categories -- --apply
# then restart the API
```

**Why the backfill is worth running.** The filter resolves every row from its
category *or* its name, so the shop is already right without it. Running it makes
the column say what the filter says: the admin panel stops showing a blank shelf,
a SQL report counts the same shelves the shop shows, and the filter becomes a
plain equality for most rows instead of a `CASE`. It only touches rows whose
`category` is not already a category id, so it never overwrites an admin's
choice, and it is safe to run twice.

**What the backfill can and cannot guess.** A value like `Hair Colour and
Chemical Products` is free text — the rules recognise it. A value like
`Haircare` (one word, no rule match) is a slug, and a slug is a category the admin
may have created, so both sides keep it as its own shelf rather than re-filing it.
Those rows show up in the dry-run output; if one is a typo, re-file it in the
admin panel.

**No migration is required.** The patch adds no column and no table: it changes
the query, and `shop_products.category` already accepts an id, a label or free
text.

---

## Checking it by hand

1. Open the shop. The grid and "Show more products (N)".
2. Pick **Beard & grooming**. The count changes to the beard shelf's own size,
   and the cards on screen are exactly the products the next pages add up to.
3. Pick **Skin & face**, then **Men**; the count narrows again.
4. Scroll to the end. The button disappears when the last page arrives — the
   count reaches zero instead of staying at 88.

On the API directly:

```bash
curl -s -X POST "$API/api/shop-products/list" \
  -H 'Content-Type: application/json' \
  -d '{"page":1,"pageSize":24,"category":"beard-grooming"}' | jq '.data.pagination'
# totalProducts is now the beard shelf only,
# and pagination.applied.category is "beard-grooming"
```
