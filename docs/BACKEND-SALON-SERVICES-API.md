# Backend — saving a salon's services

One endpoint, delivered as [`patches/backend-5-salon-services.patch`](../patches/backend-5-salon-services.patch).
No migration: it uses the `services` table that already exists (`service_name`,
`price`, `duration_minutes`, `description`, `is_active`, `display_order`).

## Why a second endpoint

`POST /api/salons/edit-salon-profile` already writes services — but only as part of
a **full profile save**. That request also carries the address, the photos, the
business hours and the barbers, and it rewrites the salon row on the way. The web
portal's new menu editor (`/edit-services`) changes one thing: the menu. Sending the
whole profile to change "Haircut ₹250 → ₹300" is both fragile (the client has to
hold every other field in sync) and slow on a phone.

`POST /api/salons/update-salon` is not an alternative either: it takes `salonId`
from the **body**, so it can be pointed at another salon, and its service loop
treats `affected === 0` as "invalid serviceId" — which MySQL returns for an UPDATE
that writes identical values, so a save with no edits would be refused.

## The endpoint

```
POST /api/salons/services/save
Authorization: Bearer <salon token>
Content-Type: application/json
```

```json
{
  "services": [
    { "serviceId": "9f1c…", "serviceName": "Haircut", "price": 300, "durationMinutes": 30,
      "description": "Salon service", "displayOrder": 0 },
    { "serviceName": "Hair spa", "price": 900, "durationMinutes": 45, "displayOrder": 1 }
  ],
  "removedServiceIds": ["3a7d…"]
}
```

| Field | Rule |
| --- | --- |
| `services` | required, 0–200 rows, in the order the partner arranged them |
| `services[].serviceId` | optional **uuid**. Present = update that service. Absent = create a new one |
| `services[].serviceName` | required, 2–100 characters |
| `services[].price` | required, number 0–1 000 000 (accepts `"300"`) |
| `services[].durationMinutes` | required, whole number 1–1440 |
| `services[].description` | optional, ≤ 500 characters |
| `services[].displayOrder` | optional; defaults to the row's position |
| `removedServiceIds` | optional list of uuids, ≤ 200 |

`salonId` is **not** part of the contract. It comes from the partner's token
(`request.salon.salonId`), so a salon can only ever write its own menu. A body that
still carries one is ignored rather than rejected (`unknown(true)`), which keeps an
older app build harmless.

### Success

```json
{
  "status": "SUCCESS",
  "message": "Services saved successfully",
  "data": {
    "salonId": "…",
    "services": [ { "serviceId": "…", "serviceName": "Haircut", "price": "300.00",
                    "durationMinutes": 30, "description": "Salon service",
                    "displayOrder": 0, "isActive": true } ],
    "serviceCount": 2,
    "removedServiceIds": ["3a7d…"]
  }
}
```

The list is the menu **as stored**, ordered by `display_order` then `created_at`,
so the portal repaints from the record instead of from its own guess. `price`
comes back as a decimal string, exactly like `get-salon`.

### Refusals

| Status | When | Message |
| --- | --- | --- |
| 401 | no/invalid salon token | `Salon authentication failed` |
| 400 | a required field is missing or out of range | `Every service needs a price` / `Duration must be at least 1 minute` / `Price cannot be negative` |
| 400 | two rows share a name (case and spacing ignored) | `Two services are named "Hair Cut". Give them different names.` |
| 400 | a `serviceId` is not this salon's | `Service 9f1c… is not on your menu` |
| 400 | the same id is both saved and removed | `A service cannot be saved and removed in the same request` |
| 500 | the database refused the transaction | the driver's message |

Every refusal happens **before** or **inside** one transaction: a save either lands
whole or not at all.

## Decisions worth knowing

- **Removal is soft.** `removedServiceIds` sets `is_active = false`; it never
  `DELETE`s. `bookings.service_id` and `queues.service_id` point at the service row,
  so a delete would fail on the foreign key or orphan a customer's history. The
  customer menu already reads `WHERE is_active = 1` (`getSalonWithDetails`), so the
  service still disappears from the salon page and the booking flow.
- **A service sent in the list is on the menu.** Re-sending a previously removed
  service sets `is_active = true` again — otherwise a partner who typed it back in
  would see it vanish on the next load.
- **No `affected` checks.** Ownership is proved up front against the salon's own
  rows (`Service.findAll({ where: { salonId } })`), so an UPDATE that changes
  nothing is a success, not an error. This is the trap in `update-salon`.
- **Duplicate names are refused** because two services with one name read as one
  service with two prices on the customer's screen. The web editor blocks it too,
  but the API is where the rule actually lives.
- **Order is data.** `displayOrder` comes from the list position, so the ↑ / ↓
  buttons in the editor are a real arrangement rather than a client-side sort.

## Apply and verify

```bash
git am patches/backend-5-salon-services.patch   # or: git apply
# no migration, no new dependency; restart the process
```

The patch's own files:

| File | What it adds |
| --- | --- |
| `src/controller/salon/saveSalonServices.js` | the handler above |
| `src/validations/salon.validation.js` | `salonServiceItemValidationSchema`, `salonServicesSaveValidationSchema` |
| `src/routes/salon.routes.js` | `POST /api/salons/services/save` with `authenticateSalon` |

Verified without a database by driving the handler against an in-memory
`Service` model (stubbed through `require.cache`), nine cases: update + create +
soft remove with a second salon left untouched, a body `salonId` ignored, a foreign
`serviceId` refused with nothing written, duplicate names refused, a no-op save
accepted, readable validation messages, keep+remove refused, no token → 401, and a
removed service brought back. `node --check` on all three files, and the patch was
re-applied to a fresh clone of `main` and re-run there.

## What the web portal does with it

`docs/MY-NAAI-WEB-PORTAL.md` §8.5. In short: `/edit-services` lists every service as
an open row of inputs, saves this one request, and repaints from `data.services`.

**This is the only backend change the screen needs.** `get-salon` already returns
the salon's active services, so no read endpoint is added.
