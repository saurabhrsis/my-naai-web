# Backend — bulk product upload (Excel / CSV)

Target repo: `rightserveinfotechsystems/my_naai_backend`
Admin panel spec: `docs/ADMIN-PANEL-BULK-PRODUCTS.md`
Web upload spec (photo sizes): `docs/SHOP-IMAGE-GUIDE.md`

The admin panel needs to add dozens of products at once: **download a sample
sheet → fill it → upload it → read a per-row report**. This document is the
contract; the panel side (button, dropzone, report table) is in the admin doc.

## 1. `GET /api/shop-products/bulk/template?format=xlsx|csv`

Answers the sample file itself (`Content-Disposition: attachment;
filename="naai-shop-product-template.xlsx"`), generated from the same column
list the importer validates, so the two can never drift.

Header row (order matters for CSV):

| Column | Required | Rules |
|---|---|---|
| `productName` | ✅ | 2–120 chars, unique per catalog (case-insensitive) |
| `category` | ✅ | a `shop_categories.id` (`hair-care`, `tools-equipment`, …). A label is accepted and slugified |
| `gender` | – | `MALE` \| `FEMALE` \| `UNISEX` (default `UNISEX`) |
| `price` | ✅ | number ≥ 0, at most 2 decimals |
| `mrp` | – | number ≥ `price`; the discount badge is derived from it |
| `description` | – | ≤ 2000 chars; plain text |
| `rating` | – | 0–5, one decimal (default 0) |
| `isAvailable` | – | `TRUE` \| `FALSE` (default `TRUE`) |
| `stockCount` | – | integer ≥ 0, optional |
| `imageUrl1` | – | absolute URL, or a path already uploaded through `/api/upload/upload-image` |
| `imageUrl2`…`imageUrl4` | – | same; the first is the cover |
| `barCode` | – | ≤ 64 chars, optional |
| `hsnCode` | – | ≤ 16 chars, optional |
| `gstPercent` | – | 0–28, optional |

Not accepted in a spreadsheet: discounts/offers as separate columns (derive from
`mrp`), category *creation* (a sheet may not invent a category — the row is
reported as an error and names the value), and text formatting.

A second sheet in the template, **Instructions**, restates the rules in
customer language and links `docs/SHOP-IMAGE-GUIDE.md`'s numbers: **square
1200 × 1200 px JPG, white background, ≤ 250 KB**.

## 2. `POST /api/shop-products/bulk/import`

`multipart/form-data`:

| Field | Type | Notes |
|---|---|---|
| `file` | `.xlsx` or `.csv`, ≤ 5 MB, ≤ 1000 rows | required |
| `mode` | `CREATE_ONLY` \| `UPSERT` | default `CREATE_ONLY` |
| `dryRun` | `true` \| `false` | validate only, write nothing |

Answer:

```json
{
  "status": "SUCCESS",
  "data": {
    "dryRun": false,
    "summary": { "rows": 120, "created": 112, "updated": 0, "skipped": 5, "failed": 3 },
    "rows": [
      { "row": 4, "productName": "Matte Clay Pomade 90g", "result": "CREATED", "productId": "MN…" },
      { "row": 9, "productName": "Herbal Oil", "result": "FAILED",
        "errors": [{ "field": "category", "message": "Unknown category \"hair oil\" — use one of the ids from the template" }] },
      { "row": 12, "productName": "Beard Oil 30ml", "result": "SKIPPED",
        "errors": [{ "field": "productName", "message": "A product with this name already exists" }] }
    ]
  }
}
```

Rules — these are the ones that keep a bulk import from becoming a support
ticket:

- **One transaction per row, not per file.** A bad row is reported and skipped;
  the other 117 products still land. `status` stays `SUCCESS` when at least one
  row was written, with the failures in `rows`.
- **`dryRun` first.** The panel calls it with `dryRun: true` to show the report
  and only then asks "Import N products?". The answer shape is identical.
- **Idempotent by name** in `UPSERT` mode (matched case-insensitively per
  catalog); `CREATE_ONLY` reports duplicates as `SKIPPED`, never as failures.
- **Validate the whole file before writing anything** when `dryRun` is set, and
  reject the file outright (413 / 415 / `FAILED`) for a wrong type, a missing
  header row, more than 1000 rows or more than 5 MB — with a message that says
  which limit was hit.
- **Images**: `imageUrl1…4` are stored as the product's comma-joined image list
  (the same field the single-product form writes). A URL that is not reachable is
  a row error, not a silent blank tile.
- **Category ids only** from `shop_categories` (see
  `docs/BACKEND-SHOP-CATEGORIES-API.md`); an unknown value fails the row.
- **Audit**: write `created_by` (admin id) and a `bulk_import_id` on every row so
  an import can be undone by id. `POST /api/shop-products/bulk/undo` with that id
  deletes exactly the rows that import created.

## 3. Suggested table for the audit trail

```sql
CREATE TABLE IF NOT EXISTS shop_product_imports (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id     VARCHAR(64) NOT NULL,
    file_name    VARCHAR(255) NOT NULL,
    mode         VARCHAR(16) NOT NULL DEFAULT 'CREATE_ONLY',
    rows_total   INTEGER NOT NULL DEFAULT 0,
    rows_created INTEGER NOT NULL DEFAULT 0,
    rows_updated INTEGER NOT NULL DEFAULT 0,
    rows_failed  INTEGER NOT NULL DEFAULT 0,
    report       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS bulk_import_id UUID;
CREATE INDEX IF NOT EXISTS idx_shop_products_bulk_import ON shop_products (bulk_import_id);
```

## 4. Acceptance checks

1. The template downloads as a real `.xlsx` and its header row matches §1
   exactly (the importer reads it by name, not by position).
2. A 100-row sheet with three bad rows creates 97 products and reports the three
   with the row number, the field and a sentence a human can act on.
3. `dryRun: true` writes nothing (compare `SELECT COUNT(*)` before and after).
4. `CREATE_ONLY` on a sheet of existing names creates nothing and reports
   `SKIPPED`, not `FAILED`.
5. A 6 MB file and a `.pdf` are both refused with a message that names the
   accepted type/size.
6. Importing the same sheet twice in `UPSERT` mode leaves the catalog with the
   same number of products.
