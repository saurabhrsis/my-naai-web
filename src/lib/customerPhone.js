// The customer's mobile number, as the salon's screens should show it.
//
// The completed-bookings endpoint (`GET /api/booking/get-completed-bookings`)
// already returns it as `userPhone`: the registered customer's number, or the
// number typed in for a walk-in. A walk-in without one comes back as the literal
// placeholder `0000000000`, which must never be printed — a salon that taps it
// dials nothing, and "0000000000" on a customer's history row reads as a bug.
//
// Everything about the shape lives here so the history list, and anything else
// that wants the number later, agree on it.

// Ten digits, no country code, no trunk zero — how the backend stores a mobile.
const TEN_DIGITS = /^[6-9]\d{9}$/;

/**
 * The digits of a phone number, without the way they were formatted.
 * Strips a `+91` country code and a leading trunk `0` so `+91 98765 43210`,
 * `919876543210`, `098765 43210` and `9876543210` all become `9876543210`.
 */
export function mobileDigits(value) {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return digits;
}

/** True for a number that is worth showing — not empty and not a row of zeros. */
export function isDiallableMobile(value) {
  const digits = mobileDigits(value);
  if (!digits) return false;
  if (/^0+$/.test(digits)) return false;
  return digits.length >= 6;
}

/**
 * `9876543210` → `98765 43210` (the way an Indian mobile is read aloud), with
 * `+91` in front when it is a ten-digit mobile. Anything else — a landline, a
 * number with an extension, an already-international one — is shown as its own
 * digits, grouped, rather than guessed at.
 */
export function formatMobileNumber(value) {
  const digits = mobileDigits(value);
  if (!isDiallableMobile(digits)) return '';
  if (TEN_DIGITS.test(digits)) return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
  if (digits.length === 10) return `${digits.slice(0, 5)} ${digits.slice(5)}`;
  return digits.replace(/(\d{5})(?=\d)/g, '$1 ').trim();
}

/** The `tel:` target for a number, or '' when there is nothing to dial. */
export function telHref(value) {
  const digits = mobileDigits(value);
  if (!isDiallableMobile(digits)) return '';
  return TEN_DIGITS.test(digits) ? `tel:+91${digits}` : `tel:${digits}`;
}

// Every key the completed-bookings row (or a queued booking) has carried for the
// customer's number. `userPhone` is the one the API sends today; the rest keep the
// screen honest if a response shape changes under it.
const MOBILE_KEYS = ['userPhone', 'userPhoneNumber', 'customerPhone', 'mobileNumber', 'phoneNumber', 'walkinPhone'];

/**
 * The customer's number on a booking row, or `null` when there is none to show.
 * Returns `{ digits, display, tel }` — `display` is what to print, `tel` what to
 * put in an anchor.
 */
export function customerMobileFrom(booking = {}) {
  if (!booking || typeof booking !== 'object') return null;
  const candidates = [
    ...MOBILE_KEYS.map(key => booking[key]),
    booking.user?.phoneNumber,
    booking.customer?.phoneNumber,
    booking.customer?.mobileNumber,
  ];
  const raw = candidates.find(value => isDiallableMobile(value));
  if (!raw) return null;
  return { digits: mobileDigits(raw), display: formatMobileNumber(raw), tel: telHref(raw) };
}
