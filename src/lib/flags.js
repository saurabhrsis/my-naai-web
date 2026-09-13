// Boolean-like flag readers.
//
// The API is shared with the mobile app and does not normalise its booleans: the
// same field arrives as `true`, `"true"`, `"TRUE"`, `1` or `"1"` depending on the
// endpoint and release, and a field that was never set arrives as `undefined`.
// Every caller used to inline its own `=== true || === 'true'` chain, which is
// how `profileCompleted: "false"` came to be read as truthy and a finished salon
// got pushed back into onboarding.
//
// Both readers are strict about "absent": a missing flag is neither true nor
// false. Callers that gate access must be able to tell "the server said no" from
// "the server said nothing", which is why these never fall back to `!value`.

const TRUE_VALUES = ['true', 'yes', 'y', '1'];
const FALSE_VALUES = ['false', 'no', 'n', '0'];

function normalizeFlag(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (TRUE_VALUES.includes(text)) return true;
    if (FALSE_VALUES.includes(text)) return false;
  }
  return null;
}

// True only when the value positively says yes. `undefined`, `null`, `''` and
// unrecognised strings are all false, so a missing flag never turns a guard on.
export function flagIsTrue(value) {
  return normalizeFlag(value) === true;
}

// True only when the value positively says no. A missing flag is NOT false —
// `flagIsFalse(undefined) === false` — because "the API did not mention it" must
// not be read as an explicit rejection (an incomplete-profile or expired-plan
// guard built on that would lock out every session whose payload omits the
// field).
export function flagIsFalse(value) {
  return normalizeFlag(value) === false;
}
