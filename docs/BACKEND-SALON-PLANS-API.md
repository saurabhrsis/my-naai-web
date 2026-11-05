# Salon plans, trial periods and subscription values — backend

The partner price list used to be three constants in three repositories: the day
counts in `src/utils/plan.util.js`, the prices in the website bundle, and another
copy in the app — plus a literal `+ 20` in `salonLogin.js` for the free trial. A
price change meant a release of everything, and the portal could advertise one
trial length while the API granted another.

It is now one table, `partner_plans`, owned by the admin panel. The website and
the app read it through the public endpoint below; the paid and free acceptance
paths (registration, renewal, sign-in) read their day counts from the same rows.

Delivered as `patches/backend-4-salon-plans.patch`, with
`migrations/2026-11-05-partner-plans.sql` and
`patches/migrations/2026-11-05-partner-plans.sql` (identical).

```bash
cd my_naai_backend
git am /path/to/patches/backend-4-salon-plans.patch
npm ci                                     # no new dependency
psql "$DB_URL" -f migrations/2026-11-05-partner-plans.sql
# restart the process — index.js now calls ensurePlanSchema() beside
# ensureShopBuyerSchema(), so a forgotten migration cannot leave the API blind
```

## Files in the patch

| File | What it does |
| --- | --- |
| `src/database/models/partnerPlan.model.js` | The row: `id, label, price, days, note, badge, is_recommended, sort_order, is_active, is_free` (underscored timestamps). Auto-loaded by `models/index.js`. |
| `src/database/config/ensurePlanSchema.js` | Idempotent `CREATE TABLE IF NOT EXISTS` + `ON CONFLICT (id) DO NOTHING` seed + index. Exports `ensurePlanSchema`, `withPlanSchema`, `PLAN_SCHEMA_STATEMENTS`. Called at boot. |
| `src/services/partnerPlan.service.js` | All reads and writes, the duration/price helpers, and the amount guard. |
| `src/controller/salon/plan/*.js` | Five thin controllers: one public list, four admin. |
| `src/routes/salon.routes.js` | The public list is registered **above** `salonRouter.use(authenticateAdmin)`; the four admin routes below it. |
| `src/utils/plan.util.js` | `getPlanEndDateInDays(startDate, days)` and an optional `{ days }` third argument on `getPlanEndDate`; the legacy map stays as a fallback and gains `Free: 90`. |
| `src/controller/razorpay/createSalonWithPlan.js` | Uses the configured duration, and refuses a payment whose amount is not the plan's price. |
| `src/controller/razorpay/renewSalonPlan.js` | Same duration + same amount guard. |
| `src/controller/salon/salonLogin.js` | The hard-coded `+ 20` is gone; the trial window comes from `defaultTrialDays()`. |
| `index.js` | `ensurePlanSchema()` at boot. |

## Public endpoint

`POST /api/salons/plans/list` — **no token**. The registration screen shows prices
before anyone has an account, so this sits beside `/salon-list-public`.

```json
{
  "status": "SUCCESS",
  "data": {
    "plans": [
      { "id": "monthly", "title": "Monthly Plan", "label": "Monthly Plan",
        "price": 199, "days": 30, "duration": "1 Month (30 Days)",
        "note": "Flexible month-to-month growth", "badge": "",
        "sortOrder": 0, "isActive": true, "isFree": false },
      { "id": "quarterly", "title": "Quarterly Plan", "label": "Quarterly Plan",
        "price": 499, "days": 90, "duration": "3 Months (90 Days)",
        "note": "Best value for busy salons", "badge": "BEST VALUE", "best": true,
        "sortOrder": 2, "isActive": true, "isFree": false }
    ],
    "freeTrial": { "id": "Free", "title": "Free trial", "price": 0, "days": 90,
                   "duration": "3 Months (90 Days)", "note": "Start your salon journey at no cost" },
    "currency": "INR",
    "source": "db"
  }
}
```

- Only **active, non-free** rows are in `plans`, sorted by `sort_order` then price.
  A plan taken off sale never appears here, but stays valid for everyone already on it.
- The free trial travels separately in `freeTrial`, because it is not a purchase.
- `source` is `db` on a normal read and `fallback` if the table cannot be queried —
  the endpoint answers with the shipped default catalog rather than failing, so a
  registration screen never renders empty. The client treats a bad response the
  same way (`src/lib/planCatalog.js` never rejects; it falls back to its seed).

## Admin endpoints

All four are below `authenticateAdmin`, so they need the admin bearer token.

| Route | Body | Notes |
| --- | --- | --- |
| `POST /api/salons/admin/plans/list` | `{}` | Rows for every plan (including off-sale and the free trial) + `activeSalons`/`totalSalons` per plan, `orphaned` legacy ids, `freeTrialDays`, `defaultPlanDays`. |
| `POST /api/salons/admin/plans/create` | `{ label, price, days, note?, badge?, sortOrder?, isRecommended? }` | The id is slugged from `label` and **never changes afterwards**. `isFree` is refused — there is exactly one trial. |
| `POST /api/salons/admin/plans/update` | `{ id, ...any of the editable fields }` | `id` is immutable; sending a different one is refused. |
| `POST /api/salons/admin/plans/delete` | `{ id, deactivate? }` | Refused while salons are on the plan unless `deactivate: true`, which takes it off sale and keeps their subscription valid. The free trial can never be deleted — edit its length instead. |

`orphaned` is the honest part: a salon whose `planType` has no row here (a legacy
`yearly`, or the uppercase `FREE` some older rows carry) is listed with its count
so the panel can say so. Nothing is rewritten automatically — an id is never
changed behind a partner's back, and `yearly` / `FREE` keep renewing through the
legacy map until a row exists for them.

## What the acceptance paths now do

| Path | Before | After |
| --- | --- | --- |
| Register (`create-salon-with-plan`) | `getPlanEndDate(now, planType)` from the constant map | `durationDays(planType)` from the row, then `getPlanEndDate(now, planType, { days })` |
| Renew (`renew-salon-plan`) | same constant map | same row-driven duration |
| Sign-in (`salonLogin`, first login creates the trial) | `new Date(... getDate() + 20)` | `await partnerPlanService.defaultTrialDays()` — 90 unless the admin changed it |

### Amount honesty

`create-salon-with-plan` and `renew-salon-plan` both accept a `totalAmount`. When
it is present, `assertPayableAmount` compares it with the plan's stored price and
refuses a mismatch beyond ±₹0.5:

```json
{ "status": "FAILED", "message": "The price of this plan is ₹499. Refresh the plan list and try again." }
```

`create-salon-with-plan` answers HTTP 200 with that body (the portal's existing
error contract for the registration step); `renew-salon-plan` answers 400. A plan
that is free cannot be sent through the gateway at all, and an unknown plan id is
refused instead of quietly charging the 30-day default.

When no `totalAmount` is sent the check is skipped — older app builds keep working,
and the order is still created from the price the client fetched.

## Seeded rows

| id | label | price | days | flags |
| --- | --- | --- | --- | --- |
| `Free` | Free trial | ₹0 | **90** | `is_free`, recommended, `sort_order` −1 |
| `monthly` | Monthly Plan | ₹199 | 30 | — |
| `trial_2_months` | Introductory | ₹299 | 60 | — |
| `quarterly` | Quarterly Plan | ₹499 | 90 | `BEST VALUE`, recommended |

The seed runs `ON CONFLICT (id) DO NOTHING`, so re-running the migration never
resets a price an admin has already changed.

## Migration

`migrations/2026-11-05-partner-plans.sql` is idempotent: the table, the seed and
the index are all `IF NOT EXISTS` / `DO NOTHING`.

It also carries the one data change this feature implies — the trial backfill that
extends a still-running free trial to 90 days, so salons created under the old
20-day rule are not disadvantaged by the change:

```sql
UPDATE salons
   SET plan_end_date = plan_start_date + INTERVAL '90 days',
       updated_at = NOW()
 WHERE plan_type IN ('FREE', 'Free')
   AND plan_start_date IS NOT NULL
   AND plan_end_date IS NOT NULL
   AND plan_end_date < plan_start_date + INTERVAL '90 days'
   AND plan_end_date > NOW();
```

It touches only the free plan, and only while the original window is still open: a
salon that has paid for a plan is never touched and an expired trial is not
resurrected. The `SELECT` that previews exactly which rows will change is in the
file above the statement — read it before running on production.

## Verified

- Patch applies clean to a fresh clone of `my_naai_backend` at `9c40796`.
- `node --check` clean on every touched file; the model registers as
  `PartnerPlan → partner_plans` with exactly the migration's columns.
- The router was mounted with a stub ORM: `POST /api/salons/plans/list` answers
  **200 `SUCCESS`** with no token, while `POST /api/salons/admin/plans/list`
  answers **401** — proving the public route really is above the admin guard.
- The service was exercised end to end against a stub: create / update / price
  change / duration change / delete-refused-while-in-use / deactivate / second-free
  -plan-refused / unknown-id-refused / duplicate-label-refused / amount guard.
- `getPlanEndDate` returns 2026-04-01 for a 2026-01-01 start on `Free` (90 days),
  2027-01-01 for `yearly` (365), and honours an explicit `{ days: 45 }` override.
