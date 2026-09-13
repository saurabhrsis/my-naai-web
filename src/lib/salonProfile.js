import { getSubscriptionState } from './planDetails';

// Salon profile predicates shared by the auth flow (src/App.jsx) and the partner
// screens (src/components/SalonScreens.jsx).
//
// These live in one place because the same question — "is this partner's profile
// complete enough to open the dashboard?" — is asked on sign-in, on session
// restore, on the salon account screen and inside the profile editor. When the
// checks were duplicated, one copy drifted and a partner could be routed to the
// queue with an unusable profile, or bounced back into onboarding after
// completing it.

// A coordinate is anything that parses to a finite number. The API returns
// latitude/longitude as numbers on some endpoints and strings on others, and the
// editor keeps them as strings while the user types.
export function hasCoordinate(value) {
  return value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value));
}

// True when the partner must finish onboarding before the dashboard is usable:
// an explicit "not completed" / "is new" flag, or a profile that is missing any
// field a customer needs to find and book the salon.
export function salonProfileNeedsCompletion(profile = {}) {
  if (!profile || typeof profile !== 'object') return true;
  if (profile.profileCompleted === false || String(profile.profileCompleted).toLowerCase() === 'false' || profile.isNewSalon === true || String(profile.isNewSalon).toLowerCase() === 'true') return true;
  const hasProfileShape = ['salonName', 'ownerName', 'addressLine1', 'genderType', 'latitude', 'longitude', 'services', 'businessHours'].some(key => Object.prototype.hasOwnProperty.call(profile, key));
  if (!hasProfileShape) return true;
  const businessHours = Array.isArray(profile.businessHours) ? profile.businessHours[0] : profile.businessHours;
  return !String(profile.ownerName || '').trim()
    || !String(profile.salonName || '').trim()
    || !String(profile.addressLine1 || '').trim()
    || !profile.genderType
    || !hasCoordinate(profile.latitude)
    || !hasCoordinate(profile.longitude)
    || !Array.isArray(profile.services)
    || profile.services.length === 0
    || !businessHours?.openingTime
    || !businessHours?.closingTime;
}

// The plan fields can sit on the session user or be nested under `user.salon`,
// depending on which endpoint filled the session in last (`/api/salons/login`
// nests them, `/api/salons/get-salon` is flattened onto the user by
// `completeAuth`). Merge the same way the profile editor does so every caller
// reads one consistent shape.
export function getSalonSubscriptionProfile(session) {
  const user = session?.user || {};
  const salon = user.salon && typeof user.salon === 'object' ? user.salon : {};
  return { ...user, ...salon };
}

// Cached-subscription state for a session. Same contract as
// `getSubscriptionState` in lib/planDetails.js: an unrecognised plan is
// "unknown", never "expired", so a partner is not locked out of the dashboard by
// a payload that simply omits the plan fields. The API stays the source of truth.
export function getSalonSubscriptionState(session) {
  return getSubscriptionState(getSalonSubscriptionProfile(session));
}
