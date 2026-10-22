import { describe, expect, it } from 'vitest';
import { STATE_OPTIONS, normalizeStateName, stateOptionsWith } from './stateOptions';

describe('state options', () => {
  it('lists every Indian state and union territory once', () => {
    expect(STATE_OPTIONS.length).toBeGreaterThanOrEqual(36);
    const values = STATE_OPTIONS.map(option => option.value);
    expect(new Set(values).size).toBe(values.length);
    expect(values).toContain('Maharashtra');
    expect(values).toContain('Delhi');
  });

  it('maps stored spellings and codes onto the canonical value', () => {
    // Codes the mobile app and older forms saved.
    expect(normalizeStateName('MH')).toBe('Maharashtra');
    expect(normalizeStateName('ka')).toBe('Karnataka');
    expect(normalizeStateName('TS')).toBe('Telangana');
    expect(normalizeStateName('JK')).toBe('Jammu and Kashmir');
    // Renamed states and typos.
    expect(normalizeStateName('Orissa')).toBe('Odisha');
    expect(normalizeStateName('Pondicherry')).toBe('Puducherry');
    expect(normalizeStateName('Uttaranchal')).toBe('Uttarakhand');
    expect(normalizeStateName('maharastra')).toBe('Maharashtra');
    // Case, spacing and stray punctuation.
    expect(normalizeStateName('  maharashtra ')).toBe('Maharashtra');
    expect(normalizeStateName('Andaman & Nicobar Islands')).toBe('Andaman and Nicobar Islands');
    expect(normalizeStateName('Jammu & Kashmir')).toBe('Jammu and Kashmir');
    expect(normalizeStateName('')).toBe('');
    expect(normalizeStateName(null)).toBe('');
  });

  it('keeps an unknown value instead of dropping it', () => {
    // Nothing is lost: the select shows it as an extra option and a save
    // cannot silently erase an address that already had a state.
    expect(normalizeStateName('Atlantis')).toBe('Atlantis');
    const options = stateOptionsWith('Atlantis');
    expect(options[0]).toEqual({ value: 'Atlantis', label: 'Atlantis' });
    expect(options).toHaveLength(STATE_OPTIONS.length + 1);
    // A known value uses the list as-is (no duplicate row).
    expect(stateOptionsWith('Maharashtra')).toBe(STATE_OPTIONS);
    expect(stateOptionsWith('')).toBe(STATE_OPTIONS);
  });
});
