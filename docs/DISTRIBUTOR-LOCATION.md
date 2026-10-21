# Distributor & delivery location — live map, KM and nearest-first dispatch

This feature answers one question everywhere it appears: **how far is this
delivery from this distributor?** A salon's shop order has a delivery point; a
distributor has a location; the admin assigns the parcel to the partner who is
closest. The point is visible on a map to the admin **and** to the distributor,
the distance in KM is shown while assigning, and the distributor list is sorted
nearest first.

The request touched three codebases. This repository (`my-naai-web`, the salon
portal) is committed on this branch; the other two are shipped as ready-to-apply
patches in [`patches/`](../patches).

| Repo | What changed | Where |
| --- | --- | --- |
| `my-naai-web` (this repo) | Shared geo module, salon map cards, delivery-pin capture at checkout, delivery map on shop orders | committed on this branch |
| `my_naai_backend` | Coordinate columns, KM/nearest-first API, delivery-point snapshot, live-location endpoint | [`patches/backend-distributor-location.patch`](../patches/backend-distributor-location.patch) |
| `my-naai-frontend` (admin panel) | Map pin picker on Add Distributor, KM + nearest-first assign drawer, KM column in the Distributors tab, live location in the Distributor portal | [`patches/admin-panel-distributor-location.patch`](../patches/admin-panel-distributor-location.patch) |

## Applying the patches

Both patches are single commits on top of each repo's current `main` and were
built against the code as it is today.

```bash
# Backend
git clone https://github.com/rightserveinfotechsystems/my_naai_backend.git
cd my_naai_backend
git am /path/to/patches/backend-distributor-location.patch
npm install
# the new columns are created at boot by the existing sync({ alter: true })

# Admin panel
git clone https://github.com/rightserveinfotechsystems/my-naai-frontend.git
cd my-naai-frontend
git am /path/to/patches/admin-panel-distributor-location.patch
npm install          # pulls the one new dependency: leaflet@^1.9.4
npm run build
```

If `git am` complains (for example because the target branch has moved), use
`git am -3` so the three-way merge resolves, or `git apply --3way`.

## Map stack — free, no key

| Where | Rendering | Why |
| --- | --- | --- |
| Admin panel | **Leaflet** + OpenStreetMap raster tiles | Needs a *picker*: click to drop, drag to move, GPS, place search (Nominatim), typed coordinates. No API key or billing account. |
| Distributor portal | same component, read-only | Shows the delivery point, the partner's own fix and the KM between them; one button refreshes the live location. |
| Salon portal (this repo) | OpenStreetMap **embed iframe** | The salon only confirms a point; an SDK would be weight on a phone for no benefit. |

Google Maps is still reachable through a plain deep link ("Open in Maps" /
"Navigate") on every surface — no key involved.

## Data

```text
distributors.latitude / longitude          DOUBLE, nullable   the partner's dispatch point
distributors.location_updated_at           TIMESTAMP          when the point was last set
shop_orders.delivery_latitude/longitude    DOUBLE, nullable   the delivery point, snapshotted
```

* A coordinate is always a **pair**. A lone latitude is rejected in validation —
  half a location sorted worse than no location, because it silently disappears
  from distance maths.
* `NULL` means unknown, **never** `0`, `0`. Null Island is a real coordinate and
  would put every unlocated partner at the top of a nearest-first list.
* The order snapshot is deliberate: editing the salon's address tomorrow must
  not rewrite where yesterday's parcel went.

## Distance semantics

Great-circle (haversine) distance, rounded to 2 decimals (~10 m), in
`src/lib/geo.js` here, `src/utils/geo.js` in both the backend and the admin
panel — the same formula in all three, so the KM shown to the admin, the KM
shown to the distributor and the sort order can never disagree.

It is **not** a road distance and nothing bills from it. Every field is named
`distanceKm`, so a routing provider can replace the maths later without touching
a client.

`sorted nearest first` = partners with no pin go **last**, then ties break by
name so paging is stable. Sorting happens across the whole filtered set on the
server *before* paging, so "nearest" cannot be stranded on page 3.

## API contract (delivered by the backend patch)

### `POST /api/distributors/list`

```json
{ "page": 1, "searchString": "", "latitude": 21.1458, "longitude": 79.0882, "sortBy": "distance" }
```

With the pair: nearest first, `distanceKm`, `latitude`, `longitude`,
`locationUpdatedAt`, `hasLocation` on every row, and `data.reference` echoing
what the ordering used. Without it: the familiar A–Z list.

### `POST /api/distributors/create` / `update`

Optional `latitude` + `longitude` (both or neither). An update that sends
neither leaves the pin untouched; `null`s clear it.

### `POST /api/distributors/location`

Distributor token (its own row) or admin token + `distributorId`.

```json
{ "latitude": 21.1466, "longitude": 79.0888 }
```

This is the "live location" ping: the portal's **My location** button posts the
browser's GPS fix here, and the admin's nearest-first list immediately uses it.

### `POST /api/shop-orders/admin-set-delivery-location`

```json
{ "orderId": "MN…", "latitude": 21.1458, "longitude": 79.0882 }
```

For a salon with no coordinates on file (or a delivery to a different gate).
Locked after `DELIVERED`/`CANCELLED`; recorded in the timeline as
`DELIVERY_LOCATION_SET`.

### Order payloads (admin + distributor portal)

```json
"deliveryLocation": { "latitude": 21.1458, "longitude": 79.0882, "source": "ORDER", "hasLocation": true },
"distributor": { "…": "…", "latitude": 21.1466, "longitude": 79.0888, "hasLocation": true, "distanceKm": 1.42 }
```

Assignments also write the distance into the audit note
(`Distributor requested: Ravi — 1.4 km from the delivery location`), so "why
this partner?" is answerable months later.

**The salon still never sees the distributor, the internal status or the
distance.** The salon payload only gains `deliveryLocation` — its own address,
so it can confirm the pin is right.

## Admin panel UX

1. **Distributors tab → Add / Edit** — a full-width *Distributor location*
   block: map click, draggable pin, **Use my location**, **Clear**, place search,
   and typed coordinates. Saved with the rest of the form.
2. **Distributors tab list** — a **Distance** column plus a reference control
   (*Use my location* / *Pick on map* / *Clear*). With a reference point set, the
   badge flips to **Sorted: nearest first** and every row carries its KM; each
   row also shows whether it has a pin and links out to a map.
3. **Shop Orders → order drawer** — a **Delivery location** card with the map,
   coordinates, **Open in Maps** and **Adjust pin** (writes through
   `admin-set-delivery-location`). The assigned partner is drawn as a second pin
   with the KM between them.
4. **Shop Orders → Assign Distributor** — the panel states *Nearest first —
   distance from the delivery location*, and each candidate shows its KM badge
   (or **No pin**). Partners are sorted client-side too, so an older API build
   cannot quietly show a 40 km partner above a 2 km one.
5. **Distributor portal** — **My location** in the navbar refreshes the live fix;
   each order card and the order drawer show the delivery pin, KM from the
   partner and a **Navigate** link.

## Salon portal UX (this repo)

* **Shop → checkout** — a *Delivery location* block with the pin prefilled from
  the salon profile, an embed map, **Use my current location** and a map link.
  The coordinates travel with the order.
* **Shop → order details** — a *Delivery location* map card: the exact point the
  admin and the delivery partner navigate to.
* **Salon account** — a *Salon location* card so the partner can see the point
  the platform uses, with a shortcut into the profile editor.

## Verification done here

```bash
npm test        # 555 tests, 39 files — includes the new src/lib/geo.test.js
npm run lint    # no errors (4 pre-existing warnings in SalonScreens.jsx)
npm run build   # production bundle builds
```

The backend patch was syntax-checked file by file and its geo module was
exercised directly (Nagpur→Mumbai ≈ 688 km, missing coordinate → `null`, `0,0`
preserved, nearest-first ordering with unlocated rows last). The admin panel
patch was built with `vite build` (1998 modules, no errors) and its map picker,
assign drawer and portal were exercised through that build.
