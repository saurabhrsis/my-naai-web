# Admin panel — Plans & Trials

New tab: **Plans & Trials** (`/plans`). It is the only place the partner price
list exists now. Everything it saves is read by the website and the app on their
next load — no release of either.

Delivered as `patches/admin-panel-3-salon-plans.patch` (repo
`rightserveinfotechsystems/my-naai-frontend`, the admin panel). Independent of
the earlier panel patches; it needs `backend-4-salon-plans.patch` deployed for the
four endpoints it calls.

```bash
cd my-naai-frontend
git am /path/to/patches/admin-panel-3-salon-plans.patch
npm ci && npm run build
```

## Files

| File | Change |
| --- | --- |
| `src/pages/PlansAndTrials.jsx` | **New.** The whole screen. |
| `src/services/communication.jsx` | **New** `partnerPlanAPI`: `list`, `create`, `update`, `remove`. |
| `src/App.jsx` | `/plans` route, inside `ProtectedRoute`. |
| `src/utils/TabArray.js` | `plans` tab key, so the tab is grantable in Role Management and the login redirect knows about it. |
| `src/components/Layout.jsx` | Sidebar entry (`Sparkles` icon) and its visibility rule. |

## Who sees it

- `plans` in `accessTab` — the tab can be granted to any role in **User
  Management → Role Management** like every other tab (it is in `TabArray`).
- **or** `user` in `accessTab` — i.e. the super admin. They can set prices without
  first granting themselves the new tab, which matters because existing role rows
  were saved before the tab existed.
- Distributors are redirected to their own portal, as on every admin page.

## What the screen does

**Free trial length.** One number, at the top, with the phrase it will render as
("3 Months (90 Days)") so what the partner reads is never a guess. Saving it
updates the `Free` row's `days`; the backend's `salonLogin.js` computes a new
salon's window from that number, so the API and the portal cannot disagree again.
The 90-day default is in the seed — the screen simply shows whatever is stored.

**One card per plan** with, in place: name on the pricing screen, price (₹),
length in days (with the derived phrase under it), sort order, optional ribbon
("BEST VALUE"), the one-line note under the price, and a **Recommended** flag.
Each card also shows **N active · M total** salons, so the consequence of taking a
plan off sale or deleting it is visible before the click.

**Save / off sale / remove.**
- *Save changes* writes the row; the badge under the button reads "Saved" when
  nothing is dirty. Client-side validation mirrors the API: a name is required, a
  price cannot be negative, a length must be 1–3650 days, and a paid plan cannot
  be priced at ₹0 (take it off sale instead).
- *Take off sale* keeps every salon already on it valid and renewable; the card
  dims and carries an **Off sale** chip. It disappears from the website's picker.
- *Remove* asks first, and the answer depends on the counts: a plan with salons
  offers **"Take off sale instead"**, a plan with none offers **Delete
  permanently**. The backend enforces the same rule, so the UI cannot lose a
  partner's subscription even if it is bypassed.

**Orphaned plans.** If any salon sits on a `planType` that has no row (a legacy
`yearly`, or the uppercase `FREE` some old records carry), a banner states how many
and how they are renewing, with the per-id counts. Nothing is renamed
automatically; creating a plan with that id is the explicit way to take control of
its price. The screen never hides this — a silent 30-day default on renewal is
exactly what this feature exists to stop.

**Add a plan.** Name, price, length, optional note. The internal id is slugged from
the name and never changes afterwards, because every paid subscription stores it.

## API it calls

```js
partnerPlanAPI.list();                       // POST /api/salons/admin/plans/list
partnerPlanAPI.create({ label, price, days, note });
partnerPlanAPI.update({ id, label, price, days, note, badge, sortOrder, isRecommended, isActive });
partnerPlanAPI.remove({ id, deactivate: true });   // or deactivate: false to delete
```

Every method returns `{ success, data, message }` like the rest of
`communication.jsx`, so failures surface as toasts with the backend's own wording
("3 salons are on "Quarterly Plan" — deactivate it instead of deleting it") rather
than a generic error.

## Why this shape

The website keeps its own seed catalog so the pricing screen renders instantly and
still works if the API is unreachable (`src/lib/planCatalog.js`). That seed is a
starting point, not a second price list: whenever the endpoint answers, the
admin's rows win, and the portal re-derives every duration from the day count so a
row edited to 100 days reads "100 Days" everywhere.

The payment step independently refuses a wrong amount, so even a stale app that
still shows an old price cannot pay less than the plan now costs: the backend
compares the amount sent with the stored price and returns a failure instead of
charging it.

## Verified

- Patch applies clean to a fresh clone of `my-naai-frontend` at `d87dfe1`.
- `npm ci && npm run build` passes after applying (1999 modules, no errors).
- The screen renders off returned data only — no hard-coded prices or day counts
  remain in the panel.
