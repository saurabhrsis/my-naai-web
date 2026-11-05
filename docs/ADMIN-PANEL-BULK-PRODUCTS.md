# Admin panel — bulk product upload + category management

Target repo: `rightserveinfotechsystems/my-naai-frontend` (admin panel)
Backend contract: `docs/BACKEND-BULK-PRODUCT-UPLOAD.md`, `docs/BACKEND-SHOP-CATEGORIES-API.md`
Existing shop tabs: `docs/ADMIN-PANEL-SHOP-TABS.md`

Two additions to the **Shop Products** tab. Both are admin-only; nothing here
changes what a customer sees, except that the catalog can finally be filled at a
sensible pace.

---

## 1. Bulk create — "Download sample → fill → upload"

### Where it lives

`Shop Products → Bulk add` (a secondary button beside **Add product**, not a new
top-level tab — bulk adding is a way to add a product, not a different subject).

### The dialog

```
┌ Bulk add products ──────────────────────────────────────────┐
│ 1  Download the sample sheet                                │
│    [ Download sample (.xlsx) ]  [ Download blank (.csv) ]   │
│    Square 1200×1200 JPGs, white background, ≤250 KB.        │
│                                                             │
│ 2  Fill it in, then drop it here                            │
│    ┌─────────────────────────────────────────────────────┐  │
│    │  Drop .xlsx / .csv here, or browse   (max 5 MB)     │  │
│    └─────────────────────────────────────────────────────┘  │
│                                                             │
│ 3  Choose what happens to names that already exist          │
│    ( ) Skip them (create only)   (•) Update them            │
│                                                             │
│                                     [ Cancel ] [ Check file ]│
└─────────────────────────────────────────────────────────────┘
```

**Check file** calls the import endpoint with `dryRun: true`. Nothing is written
yet — the panel shows the report and a confirmation:

```
┌ Ready to import 120 rows ───────────────────────────────────┐
│ 112 new · 5 already exist (will be skipped) · 3 need fixing │
│                                                             │
│ Row  Field      Problem                                     │
│  9   category   Unknown category "hair oil" — use an id      │
│                 from the template                           │
│ 14   price      "₹499" is not a number — remove the symbol   │
│ 27   productName  A product with this name already exists    │
│                                                             │
│ [ Download this report ]   [ Fix and re-upload ] [ Import 112 ]│
└─────────────────────────────────────────────────────────────┘
```

Rules the panel must honour (they are the difference between a feature and a
support queue):

- **Never import straight from the drop.** Always `dryRun` first, always show
  the counts, always require the explicit **Import N** click.
- **Show the row number from the sheet**, not an array index — that is what the
  admin can find in Excel.
- **Name the field and the fix**, in the sheet's vocabulary. "Invalid value" is
  not a message.
- **One file at a time.** Two concurrent imports are two reports nobody can tell
  apart.
- **A big import does not block the panel**: show progress (`14 of 120`), keep the
  dialog dismissable, and put a toast when it finishes.
- **Offer the report as a file** (same columns as the sheet + `result` and
  `errors`) so it can be fixed in Excel and re-uploaded.
- **After success**, refresh the product list, keep the filters, and offer
  **Undo this import** for the `bulk_import_id` the API returned.

### Things the panel should do for the admin

- Pre-fill the "Update existing" choice from the last import.
- Remember the last-used file name and show "last import: 112 products, 5 Nov".
- Link the image guide (`docs/SHOP-IMAGE-GUIDE.md`) inline — most bad rows are
  photos, not data.

---

## 2. Category management — the list everyone reads

`Shop Products → Categories` (a small manager; a modal is enough).

```
Categories                    order = the customer's filter order
⠿ Hair care           12 products   ↑ ↓   [ Edit ] [ Hide ]
⠿ Beard & grooming    8 products   ↑ ↓   [ Edit ] [ Hide ]
⠿ Skin & face         6 products   ↑ ↓   [ Edit ] [ Hide ]
⠿ Fragrance           3 products   ↑ ↓   [ Edit ] [ Hide ]
⠿ Hair colour         4 products   ↑ ↓   [ Edit ] [ Hide ]
⠿ Tools & equipment   9 products   ↑ ↓   [ Edit ] [ Hide ]
⠿ Kits & sets         2 products   ↑ ↓   [ Edit ] [ Hide ]
                                        [ + Add category ]
```

- **This list is the storefront's filter.** Adding a category here makes it
  appear in the website's and the app's shop filter with no deploy (they read
  `POST /api/shop-categories/list`; see `docs/BACKEND-SHOP-CATEGORIES-API.md`).
- **Order is `sort_order`** — the arrows write it; the customer sees the same
  order.
- **Renaming changes the label only.** The id is a slug fixed at creation and
  products store it, so the dialog must say *"the web address of this category
  stays `hair-care`"* rather than silently rewriting it.
- **Hiding** (`isActive: false`) removes the category from the filter but keeps
  it on the products already filed under it — the storefront appends those
  itself, so nothing disappears from the shelf.
- **Deleting is refused while products use it**: the panel must offer
  *"Move 12 products to…"* and only then delete. A category deleted out from
  under a product is exactly the "product shows under the wrong shelf" complaint.
- The **product editor's category select** reads the same list (it already reads
  a list; point it at the endpoint), so a new category is selectable immediately.

---

## 3. Related tab — Booking requests

The admin panel also gains a **Booking requests** tab. It is specified
separately in `docs/ADMIN-PANEL-BOOKING-REQUESTS.md`; the short version: it reads
`booking_requests`, never `booking`, and its headline numbers separate accepted,
rejected and **auto-cancelled**.

---

## 4. Acceptance checks

1. **Bulk add** downloads a template whose headers match the importer's, and the
   file opens in Excel and Google Sheets without a warning.
2. Uploading a sheet with three bad rows shows them by **sheet row number** with
   a fixable message, and importing creates only the good rows.
3. **Import** is impossible without a dry run — the confirmation names the exact
   number of products it will create.
4. After import, the product list shows the new products and **Undo this import**
   removes exactly those.
5. Adding a category in **Categories** appears in the storefront filter (reload
   the website's shop) with the same label and position, and in the product
   editor's select.
6. Deleting a category that has products is refused with a count, and the
   reassign path moves them.
