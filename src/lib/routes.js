// Client routing — real browser-history paths (no hash).
//
// URL contract:
//   /                       the home/discovery page (with /home as an alias)
//   /salon/<id>             a salon's public page (the shareable link)
//   /<screen>?<query>       every other screen (/bookings, /login, /privacy-policy, …)
//
// Everything that builds or reads an in-app URL goes through these helpers so
// the app never speaks two URL languages. Vite's dev server serves index.html
// for any path; production needs the SPA rewrite in vercel.json / the hosting
// platform's equivalent (documented in docs/MY-NAAI-WEB-PORTAL.md).
//
// Segment aliases keep short stable route names inside the app while the
// public URL reads properly: `privacy` lives at /privacy-policy.
const ROUTE_TO_SEGMENT = { privacy: 'privacy-policy', home: '' };
const SEGMENT_TO_ROUTE = { 'privacy-policy': 'privacy' };

// Parse `window.location`-style input (a path, optionally with a query) into
// the router's { name, params }. The salon screen consumes its id from the
// nested path segment, exactly like the old `#/salon/<id>` hash did.
export function parseRoutePath(value = '') {
  let raw = String(value || '');
  try {
    if (raw.startsWith('http')) raw = new URL(raw).pathname + (new URL(raw).search || '');
  } catch { /* keep the raw string */ }
  const [rawPath, rawQuery = ''] = raw.split('?');
  let name = '';
  try { name = decodeURIComponent(rawPath); } catch { name = rawPath; }
  name = name.replace(/^\/+|\/+$/g, '');
  const params = {};
  const segments = name.split('/').filter(Boolean);
  if (segments.length > 1) {
    const rest = segments.slice(1).join('/');
    name = segments[0];
    if (rest) {
      try { params.salonId = decodeURIComponent(rest); } catch { params.salonId = rest; }
    }
  }
  name = SEGMENT_TO_ROUTE[name] || name;
  try {
    for (const [key, val] of new URLSearchParams(rawQuery).entries()) params[key] = val;
  } catch { /* a malformed query degrades to no params */ }
  return { name, params };
}

// Inverse of parseRoutePath. `home` → `/`, `salon` → `/salon/<id>`, and
// object-typed params (a prefetched salon record handed over in-session)
// never leak into the URL.
export function routeToPath(name, params = {}) {
  const serializable = Object.fromEntries(Object.entries(params || {}).filter(([, val]) => val !== null && val !== undefined && typeof val !== 'object'));
  if (name === 'salon' && serializable.salonId) {
    const { salonId, ...rest } = serializable;
    const query = new URLSearchParams(rest).toString();
    return `/salon/${encodeURIComponent(salonId)}${query ? `?${query}` : ''}`;
  }
  const segment = name in ROUTE_TO_SEGMENT ? ROUTE_TO_SEGMENT[name] : name;
  const query = new URLSearchParams(serializable).toString();
  const base = segment ? `/${segment}` : '/';
  return query ? `${base}?${query}` : base;
}

// Old links shared before the history-routing switch (`#/salon/<id>`,
// `#/bookings?...`, notification taps) still resolve: opening them rewrites
// the address bar to the clean path via AppRoot's location reader.
export function legacyHashToRoute(hash = '') {
  const clean = String(hash || '');
  if (!clean.startsWith('#/') && !clean.startsWith('#salon')) return null;
  const route = parseRoutePath(clean.replace(/^#/, ''));
  return route.name ? route : null;
}

// Outside React (push-notification taps, the service worker's message pipe) a
// router push = pushState + a synthetic popstate, which AppRoot listens to.
export function softNavigate(path) {
  if (!path) return;
  window.history.pushState({}, '', path);
  window.dispatchEvent(new Event('popstate'));
}
