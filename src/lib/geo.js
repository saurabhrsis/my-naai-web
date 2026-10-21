// Geo helpers — one implementation of "how far apart are these two points?"
//
// The salon portal already showed distances ("2.4 km away") on salon cards and
// sorted discovery nearest-first; delivery locations now need exactly the same
// arithmetic (the delivery point shown to the admin and the distributor, the
// pin a salon confirms at checkout). Keeping one module means the KM on a shop
// order can never disagree with the KM on a salon card, and the formula matches
// the backend (`my_naai_backend/src/utils/geo.js`) and the admin panel.
//
// The distance is the great-circle (haversine) distance between two points —
// not a driving route, not a straight line on a projected map. It needs no API
// key, works offline, and is what "nearest first" is sorted by.
//
// Published through `src/components/Shared.jsx` as well, so every screen that
// already imported `getDistanceInKm` / `formatDistanceInKm` keeps working.
const EARTH_RADIUS_KM = 6371;

// A coordinate may arrive as a number, a numeric string, `''`, `null` or
// `undefined` (the API is not consistent). 0 is a real coordinate — the
// equator / Greenwich — so only absent or non-numeric values become `null`.
export function toCoordinate(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function isValidLatitude(value) {
  const number = toCoordinate(value);
  return number !== null && number >= -90 && number <= 90;
}

export function isValidLongitude(value) {
  const number = toCoordinate(value);
  return number !== null && number >= -180 && number <= 180;
}

// A location needs BOTH halves: half a coordinate is a data-entry bug, not a
// place, and rendering it would put a pin in the wrong country.
export function toPoint(source) {
  if (!source) return null;
  const latitude = toCoordinate(source.latitude ?? source.lat);
  const longitude = toCoordinate(source.longitude ?? source.lng ?? source.lon);
  if (latitude === null || longitude === null) return null;
  if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) return null;
  return { latitude, longitude };
}

// Unrounded on purpose: the sky's-the-limit precision lets the formatter tell a
// genuine sub-100 m distance from an API placeholder (0). Cards round for
// display; sorting uses the raw value.
export function getDistanceInKm(lat1, lon1, lat2, lon2) {
  const rawValues = [lat1, lon1, lat2, lon2];
  if (rawValues.some(value => value === null || value === undefined || String(value).trim() === '')) return null;
  const values = rawValues.map(Number);
  if (values.some(value => !Number.isFinite(value))) return null;
  const [aLat, aLon, bLat, bLon] = values;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a))));
}

// Distance between two point-like objects, or null when either has no usable
// location.
export function distanceBetween(from, to) {
  const a = toPoint(from);
  const b = toPoint(to);
  if (!a || !b) return null;
  const km = getDistanceInKm(a.latitude, a.longitude, b.latitude, b.longitude);
  return Number.isFinite(km) ? km : null;
}

// The API sometimes sends a placeholder distance of 0 when a salon has no
// usable coordinates. Treat that as unknown instead of showing a misleading
// "0 km" chip. A genuinely calculated zero-distance result is formatted as
// "< 0.1 km" by formatDistanceInKm.
export function normalizeDistanceInKm(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const text = String(value).trim().toLowerCase();
  const match = text.match(/-?\d+(?:[.,]\d+)?/);
  if (!match) return null;
  const number = Number(match[0].replace(',', '.'));
  if (!Number.isFinite(number) || number <= 0) return null;
  return text.includes('meter') || /\bm\b/.test(text) ? number / 1000 : number;
}

export function formatDistanceInKm(value, { zeroLabel = '< 0.1 km' } = {}) {
  // An absent distance is not "0 km": `Number(null)` is 0, which used to turn
  // a missing value into a "< 0.1 km" chip that looked like real data.
  if (value === null || value === undefined || String(value).trim() === '') return '';
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return '';
  if (number === 0) return zeroLabel;
  if (number < 0.1) return '< 0.1 km';
  return `${Number(number.toFixed(1))} km`;
}

// "21.14580, 79.08820" — enough precision to find a gate, short enough to read
// out over the phone.
export function formatCoordinates(source, digits = 5) {
  const point = toPoint(source);
  if (!point) return '';
  return `${point.latitude.toFixed(digits)}, ${point.longitude.toFixed(digits)}`;
}

// Key-less deep link: opens the point in whatever map app the device has.
export function mapsUrl(source) {
  const point = toPoint(source);
  if (!point) return '';
  return `https://www.google.com/maps/search/?api=1&query=${point.latitude},${point.longitude}`;
}

// An OpenStreetMap embed for the in-app preview — no API key, no billing
// account, no SDK. The bbox is the point, padded so the marker is not glued to
// the edge of the frame (a zero-height box renders blank).
export function openStreetMapEmbedUrl(source, { span = 0.008 } = {}) {
  const point = toPoint(source);
  if (!point) return '';
  const left = (point.longitude - span).toFixed(6);
  const right = (point.longitude + span).toFixed(6);
  const top = (point.latitude + span).toFixed(6);
  const bottom = (point.latitude - span).toFixed(6);
  return `https://www.openstreetmap.org/export/embed.html?bbox=${left},${bottom},${right},${top}&layer=mapnik&marker=${point.latitude},${point.longitude}`;
}

// A stored pin is only useful while it is fresh; the salon should be able to
// see how old the point the delivery partner will use is.
export function locationAgeLabel(value, now = Date.now()) {
  if (!value) return '';
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return '';
  const minutes = Math.max(0, Math.round((now - then) / 60000));
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(then).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// The delivery point of a place-like record, in the order of trust we want:
// an explicit delivery location first, then the record's own coordinates.
export function deliveryPointOf(source) {
  if (!source) return null;
  return toPoint(source.deliveryLocation) || toPoint(source) || null;
}
