// Where to send a guest back to once they finish logging in.
//
// A visitor can browse salons without an account; the moment they tap
// Book now / bookmark / anything account-gated, the app stashes the exact
// route here (usually the salon's own `#/salon/<id>` link) and opens login.
// `completeAuth` pops it and resumes that route, so the booking flow feels
// uninterrupted even across an OTP detour. Kept in its own module because
// BOTH App.jsx (resume) and UserScreens.jsx (stash) need it, and importing
// App.jsx from UserScreens.jsx would create an import cycle.
const KEY = 'mynaaiPendingRoute';

export function stashPendingRoute(hash) {
  const value = String(hash || '').trim();
  // Never stash the login page itself or empty roots — resuming to either
  // would strand the user in a loop.
  if (!value || value === '#' || value === '#/' || value === '#/login' || value.startsWith('#/login?')) return;
  try { sessionStorage.setItem(KEY, value); } catch { /* private mode: resume skipped */ }
}

export function popPendingRoute() {
  let value = '';
  try {
    value = sessionStorage.getItem(KEY) || '';
    sessionStorage.removeItem(KEY);
  } catch { /* sessionStorage unavailable */ }
  return value.startsWith('#/') ? value : '';
}
