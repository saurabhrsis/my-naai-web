// Slippy-map arithmetic for the pin picker.
//
// The portal needs one interactive thing a map SDK would otherwise provide:
// let a partner (or a customer at checkout) put a pin on the exact gate the
// delivery partner has to walk up to. Everything else — the read-only previews,
// the "how far away is this" numbers — is already covered by an OpenStreetMap
// embed and the haversine helpers in `geo.js`.
//
// Shipping Leaflet for that one interaction would add ~45 kB to a PWA that
// deliberately has no map SDK (see LocationMap's note), so the picker renders
// plain OSM raster tiles itself and these functions do the maths: Web Mercator
// projection, which tile covers which pixel, and the inverse for a tap. They
// are pure, so the part that is easy to get wrong is unit-tested
// (`tileMap.test.js`) instead of eyeballed on a phone.
//
// Tiles come from openstreetmap.org, which needs no key and no billing account.
// Attribution is rendered by the picker (OSM's tile policy requires it).

export const TILE_SIZE = 256;
export const MIN_ZOOM = 3;
// 19 is where OSM stops having detail for an Indian street; a pin is placed at
// 17 by default, which is "the building", not "the city".
export const MAX_ZOOM = 19;

// My Naai is a Nagpur company and most salons on it are in Maharashtra, so a
// pin that has never been set starts the map here rather than on a grey box or
// the middle of the Atlantic.
export const DEFAULT_MAP_CENTRE = { latitude: 21.1458, longitude: 79.0882 };

// Mercator cannot represent the poles; this is the standard cut-off.
const MAX_MERCATOR_LATITUDE = 85.05112878;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function clampLatitude(latitude) {
  return clamp(Number(latitude) || 0, -MAX_MERCATOR_LATITUDE, MAX_MERCATOR_LATITUDE);
}

// Panning past the antimeridian should show the next day, not stop dead.
export function wrapLongitude(longitude) {
  const value = Number(longitude) || 0;
  return ((((value + 180) % 360) + 360) % 360) - 180;
}

export function clampZoom(zoom) {
  return clamp(Math.round(Number(zoom) || 0), MIN_ZOOM, MAX_ZOOM);
}

// Latitude/longitude → pixel position on the whole world at this zoom. The
// origin is the top-left of the map, x grows east, y grows south. The zoom is
// used as given (the caller clamps it via `clampZoom`): the projection itself
// is only maths and must round-trip at every level, including the ones the UI
// never shows.
export function projectPoint(point, zoom) {
  const z = Number(zoom) || 0;
  const scale = TILE_SIZE * 2 ** z;
  const latitude = clampLatitude(point?.latitude);
  const longitude = wrapLongitude(point?.longitude);
  const x = ((longitude + 180) / 360) * scale;
  const sin = Math.sin((latitude * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
  return { x, y, scale };
}

// The inverse: world pixels back to a coordinate.
export function unprojectPoint(pixel, zoom) {
  const z = Number(zoom) || 0;
  const scale = TILE_SIZE * 2 ** z;
  const longitude = wrapLongitude((Number(pixel?.x) / scale) * 360 - 180);
  const n = Math.PI - (2 * Math.PI * Number(pixel?.y)) / scale;
  const latitude = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { latitude: clampLatitude(latitude), longitude };
}

export function tileUrl(zoom, x, y) {
  return `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`;
}

// The tiles needed to fill a viewport: each one positioned relative to the
// viewport's top-left corner. Rows outside the world are skipped (above/below
// the poles); columns wrap, so panning east never shows a blank stripe.
export function visibleTiles({ centre = DEFAULT_MAP_CENTRE, zoom = 13, width = 320, height = 240 } = {}) {
  const z = clampZoom(zoom);
  const { x, y } = projectPoint(centre, z);
  const left = x - width / 2;
  const top = y - height / 2;
  const rows = 2 ** z;
  const startX = Math.floor(left / TILE_SIZE);
  const endX = Math.floor((left + width) / TILE_SIZE);
  const startY = Math.floor(top / TILE_SIZE);
  const endY = Math.floor((top + height) / TILE_SIZE);

  const tiles = [];
  for (let tileX = startX; tileX <= endX; tileX += 1) {
    for (let tileY = startY; tileY <= endY; tileY += 1) {
      if (tileY < 0 || tileY >= rows) continue;
      tiles.push({
        key: `${z}/${tileX}/${tileY}`,
        src: tileUrl(z, ((tileX % rows) + rows) % rows, tileY),
        left: tileX * TILE_SIZE - left,
        top: tileY * TILE_SIZE - top
      });
    }
  }
  return tiles;
}

// Where a coordinate sits inside a viewport (for drawing the pin).
export function pointToScreen(point, { centre, zoom, width, height }) {
  const world = projectPoint(point, zoom);
  const view = projectPoint(centre || DEFAULT_MAP_CENTRE, zoom);
  return { left: world.x - view.x + width / 2, top: world.y - view.y + height / 2 };
}

// The coordinate under a tap/drag inside the viewport.
export function screenToPoint(pixel, { centre, zoom, width, height }) {
  const view = projectPoint(centre || DEFAULT_MAP_CENTRE, zoom);
  return unprojectPoint(
    { x: view.x - width / 2 + Number(pixel?.left || 0), y: view.y - height / 2 + Number(pixel?.top || 0) },
    zoom
  );
}

// Panning moves the centre by a pixel delta — the same projection, backwards.
// `delta` is how far the FINGER moved, so the map content follows the finger and
// the centre travels the opposite way (drag right → you see what is west).
export function panCentre(centre, delta, zoom) {
  const view = projectPoint(centre || DEFAULT_MAP_CENTRE, zoom);
  return unprojectPoint({ x: view.x - Number(delta?.left || 0), y: view.y - Number(delta?.top || 0) }, zoom);
}

// A pin is only worth saving at metre precision; 5 decimals is ~1 m and keeps
// the stored value readable in a phone call ("21.14580, 79.08820").
export const roundCoordinate = (value) => Math.round(Number(value) * 1e5) / 1e5;

export function roundPoint(point) {
  if (!point) return null;
  return { latitude: roundCoordinate(point.latitude), longitude: roundCoordinate(point.longitude) };
}
