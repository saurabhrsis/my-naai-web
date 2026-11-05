# Mobile app — plans from the backend, not from the bundle

Delivered as `patches/app-1-salon-plans.patch` (repo
`rightserveinfotechsystems/my_naai_app`, base `41ac94e`). Applies clean to a fresh
clone; four files.

The app carried its own two price lists, and they had drifted:

| Screen | Prices before | Free trial before |
| --- | --- | --- |
| `SubscriptionsPlan` (registration) | ₹199 / ₹299 / ₹499 | hard-coded `20 days` |
| `RenewalSubscriptionsPlan` | **₹99 / ₹179 / ₹249** — the old ladder | — |

A partner who registered on the first screen and renewed on the second saw their
plan get cheaper and then more expensive. Both screens now read the same catalog
the website reads, which the admin panel owns, so a price or trial-length change
in the panel reaches the app on the next call — no app release.

```bash
cd my_naai_app
git apply /path/to/patches/app-1-salon-plans.patch
# no new dependency: AsyncStorage and axios are already in the app
```

## What changed

| File | Change |
| --- | --- |
| `src/services/planCatalog.js` | **New.** Fetch, normalize, cache and a `usePlanCatalog()` hook. |
| `src/services/communication.js` | *New* `communication.listPartnerPlans()` → `POST /api/salons/plans/list` (public, no token). |
| `src/screens/SubscriptionsPlan.js` | Local `plans` array deleted; cards come from the hook; the free card's duration is `freeTrial.duration` instead of `20 days`. |
| `src/screens/RenewalSubscriptionsPlan.js` | Same, so renewal costs exactly what registration costs. |

## How it behaves

- `usePlanCatalog()` returns the seed **on the first frame**, so the screen renders
  immediately, then repaints with the backend's rows. A slow network never leaves a
  partner on a spinner at the moment they are about to pay.
- `loadPlanCatalog()` is offline-tolerant in three steps: the endpoint, then the
  cache written under `mynaai:plan-catalog:v2` in AsyncStorage, then the seed. Only
  a real remote answer overwrites the cache — a failure never blanks it.
- Durations are always **derived from the day count** (`describeDuration`), so a row
  the admin edits to 100 days reads "100 Days" on both screens instead of a stale
  label.
- `priceLabel` is formatted from the stored rupee number, and `handlePayment` sends
  the numeric `price`. The backend compares the amount sent with the plan's stored
  price and refuses a mismatch, so an app that has not refreshed cannot pay less
  than the plan now costs — it gets a clear failure instead of a wrong charge.
- A plan the admin took off sale disappears from `plans`; if the selection is
  somehow already gone, the pay action says "This plan is no longer on sale" rather
  than crashing on `undefined.price`.
- The ribbon now comes from the row's `badge` ("BEST VALUE", or anything the admin
  typed), falling back to `best`, so the panel controls the label.

## The seed is not a second price list

`SEED_PLANS` / `SEED_FREE_TRIAL` exist only for the first frame and for offline
use. Whenever the endpoint answers, the admin's rows win. The seed values match
what the backend ships today (₹199 / ₹299 / ₹499, free trial 90 days), so the two
cannot disagree even on a cold offline start.

## Verified

- Patch applies clean to a fresh clone at `41ac94e`; every touched file parses
  (esbuild JSX transform).
- `describeDuration` checked at 1, 30, 60, 90, 100, 365 and 0 days; `formatPrice`
  at 0, 199 and 1299.5.
- `normalizeCatalog` checked against a real response shape
  (`{ data: { plans, freeTrial, freeTrialDays } }`), a bare legacy shape
  (`{ data: { planList } }` with snake_case fields), and `null` (seed).
- `loadPlanCatalog` exercised on all three paths: online (remote rows + cache
  written), offline with a cache (previous remote rows, not the seed), offline with
  no cache (seed).
- No hard-coded price or `20 days` string remains in either subscription screen.
