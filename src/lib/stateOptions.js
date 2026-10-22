export const STATE_OPTIONS = [
  { label: 'Andhra Pradesh', value: 'Andhra Pradesh' },
  { label: 'Arunachal Pradesh', value: 'Arunachal Pradesh' },
  { label: 'Assam', value: 'Assam' },
  { label: 'Bihar', value: 'Bihar' },
  { label: 'Chhattisgarh', value: 'Chhattisgarh' },
  { label: 'Goa', value: 'Goa' },
  { label: 'Gujarat', value: 'Gujarat' },
  { label: 'Haryana', value: 'Haryana' },
  { label: 'Himachal Pradesh', value: 'Himachal Pradesh' },
  { label: 'Jharkhand', value: 'Jharkhand' },
  { label: 'Karnataka', value: 'Karnataka' },
  { label: 'Kerala', value: 'Kerala' },
  { label: 'Madhya Pradesh', value: 'Madhya Pradesh' },
  { label: 'Maharashtra', value: 'Maharashtra' },
  { label: 'Manipur', value: 'Manipur' },
  { label: 'Meghalaya', value: 'Meghalaya' },
  { label: 'Mizoram', value: 'Mizoram' },
  { label: 'Nagaland', value: 'Nagaland' },
  { label: 'Odisha', value: 'Odisha' },
  { label: 'Punjab', value: 'Punjab' },
  { label: 'Rajasthan', value: 'Rajasthan' },
  { label: 'Sikkim', value: 'Sikkim' },
  { label: 'Tamil Nadu', value: 'Tamil Nadu' },
  { label: 'Telangana', value: 'Telangana' },
  { label: 'Tripura', value: 'Tripura' },
  { label: 'Uttar Pradesh', value: 'Uttar Pradesh' },
  { label: 'Uttarakhand', value: 'Uttarakhand' },
  { label: 'West Bengal', value: 'West Bengal' },
  { label: 'Andaman and Nicobar Islands', value: 'Andaman and Nicobar Islands' },
  { label: 'Chandigarh', value: 'Chandigarh' },
  { label: 'Dadra and Nagar Haveli and Daman and Diu', value: 'Dadra and Nagar Haveli and Daman and Diu' },
  { label: 'Delhi', value: 'Delhi' },
  { label: 'Jammu and Kashmir', value: 'Jammu and Kashmir' },
  { label: 'Ladakh', value: 'Ladakh' },
  { label: 'Lakshadweep', value: 'Lakshadweep' },
  { label: 'Puducherry', value: 'Puducherry' },
];

/* ------------------------------------------------------------------ *
 * Turning a STORED state into a SELECT value.
 *
 * The state is a dropdown now, but salons created before that carry whatever
 * was typed or whatever the mobile app sent: `MH`, `maharastra`, `Orissa`,
 * `J&K`, `Pondicherry`. A <select> shows nothing for a value it does not know,
 * so an existing address would silently look "not set" and a save would wipe
 * it. `normalizeStateName` maps those forms onto the canonical list, and
 * `stateOptionsWith` keeps an unrecognised value as a visible extra option
 * instead of dropping it.
 * ------------------------------------------------------------------ */

// Two-letter codes the mobile app and older forms used.
const STATE_CODES = {
  AP: 'Andhra Pradesh',
  AR: 'Arunachal Pradesh',
  AS: 'Assam',
  BR: 'Bihar',
  CG: 'Chhattisgarh',
  CT: 'Chhattisgarh',
  GA: 'Goa',
  GJ: 'Gujarat',
  HR: 'Haryana',
  HP: 'Himachal Pradesh',
  JH: 'Jharkhand',
  KA: 'Karnataka',
  KL: 'Kerala',
  MP: 'Madhya Pradesh',
  MH: 'Maharashtra',
  MN: 'Manipur',
  ML: 'Meghalaya',
  MZ: 'Mizoram',
  NL: 'Nagaland',
  OD: 'Odisha',
  OR: 'Odisha',
  PB: 'Punjab',
  RJ: 'Rajasthan',
  SK: 'Sikkim',
  TN: 'Tamil Nadu',
  TG: 'Telangana',
  TS: 'Telangana',
  TR: 'Tripura',
  UP: 'Uttar Pradesh',
  UK: 'Uttarakhand',
  UA: 'Uttarakhand',
  WB: 'West Bengal',
  AN: 'Andaman and Nicobar Islands',
  CH: 'Chandigarh',
  DN: 'Dadra and Nagar Haveli and Daman and Diu',
  DD: 'Dadra and Nagar Haveli and Daman and Diu',
  DL: 'Delhi',
  JK: 'Jammu and Kashmir',
  LA: 'Ladakh',
  LD: 'Lakshadweep',
  PY: 'Puducherry',
};

// Spellings that were renamed, or that people (and old exports) still use.
const STATE_ALIASES = {
  orissa: 'Odisha',
  pondicherry: 'Puducherry',
  uttaranchal: 'Uttarakhand',
  'jammu & kashmir': 'Jammu and Kashmir',
  'jammu and kashmir': 'Jammu and Kashmir',
  'j&k': 'Jammu and Kashmir',
  'andaman & nicobar islands': 'Andaman and Nicobar Islands',
  'andaman and nicobar': 'Andaman and Nicobar Islands',
  'dadra and nagar haveli': 'Dadra and Nagar Haveli and Daman and Diu',
  'daman and diu': 'Dadra and Nagar Haveli and Daman and Diu',
  'nct of delhi': 'Delhi',
  'new delhi': 'Delhi',
  bangalore: 'Karnataka',
  bengaluru: 'Karnataka',
  bombay: 'Maharashtra',
  mumbai: 'Maharashtra',
  madras: 'Tamil Nadu',
  calcutta: 'West Bengal',
  kolkata: 'West Bengal',
  'maharastra': 'Maharashtra',
  'telengana': 'Telangana',
  'chattisgarh': 'Chhattisgarh',
};

const squash = value => String(value || '').trim().replace(/\s+/g, ' ').replace(/\.$/, '');

// The canonical option value for whatever was stored. Unrecognised text is
// returned cleaned (never dropped) so a save cannot erase it.
export function normalizeStateName(value) {
  const text = squash(value);
  if (!text) return '';
  const lower = text.toLowerCase();
  const exact = STATE_OPTIONS.find(option => option.value.toLowerCase() === lower);
  if (exact) return exact.value;
  const code = text.replace(/[\s.\-]/g, '').toUpperCase();
  if (STATE_CODES[code]) return STATE_CODES[code];
  if (STATE_ALIASES[lower]) return STATE_ALIASES[lower];
  // Last chance: a match that only differs by punctuation/ampersands
  // ("Andaman & Nicobar Islands" vs "andaman and nicobar islands").
  const relaxed = lower.replace(/&/g, 'and').replace(/[^a-z]/g, '');
  const relaxedMatch = STATE_OPTIONS.find(option => option.value.toLowerCase().replace(/[^a-z]/g, '') === relaxed);
  if (relaxedMatch) return relaxedMatch.value;
  return text;
}

// Options for a <select> that must also display a stored value the list does
// not contain — otherwise the field renders blank and looks unset.
export function stateOptionsWith(value) {
  const text = squash(value);
  if (!text) return STATE_OPTIONS;
  const known = STATE_OPTIONS.some(option => option.value.toLowerCase() === text.toLowerCase());
  if (known) return STATE_OPTIONS;
  return [{ value: text, label: text }, ...STATE_OPTIONS];
}
