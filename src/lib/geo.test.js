import { describe, expect, it } from 'vitest';
import {
  deliveryPointOf,
  distanceBetween,
  formatCoordinates,
  formatDistanceInKm,
  getDistanceInKm,
  isValidLatitude,
  isValidLongitude,
  locationAgeLabel,
  mapsUrl,
  normalizeDistanceInKm,
  openStreetMapEmbedUrl,
  toCoordinate,
  toPoint,
} from './geo';

// Nagpur — the coordinates every fixture in this repo uses.
const NAGPUR = { latitude: 21.1458, longitude: 79.0882 };

describe('coordinates are normalised before anything uses them', () => {
  it('accepts numbers and numeric strings, rejects absent values', () => {
    expect(toCoordinate('21.1458')).toBeCloseTo(21.1458, 4);
    expect(toCoordinate(0)).toBe(0);
    expect(toCoordinate('')).toBeNull();
    expect(toCoordinate('   ')).toBeNull();
    expect(toCoordinate(null)).toBeNull();
    expect(toCoordinate(undefined)).toBeNull();
    expect(toCoordinate('north')).toBeNull();
  });

  it('validates ranges so half a location is never a location', () => {
    expect(isValidLatitude(21.1)).toBe(true);
    expect(isValidLatitude(91)).toBe(false);
    expect(isValidLongitude(-179.9)).toBe(true);
    expect(isValidLongitude(181)).toBe(false);
    expect(toPoint({ latitude: 21.1, longitude: 79.1 })).toEqual({ latitude: 21.1, longitude: 79.1 });
    // A lone latitude (the shape a broken form submission produces) is null.
    expect(toPoint({ latitude: 21.1 })).toBeNull();
    expect(toPoint({ latitude: 0, longitude: 0 })).toEqual({ latitude: 0, longitude: 0 });
    expect(toPoint({ lat: 21.1, lng: 79.1 })).toEqual({ latitude: 21.1, longitude: 79.1 });
  });
});

describe('distance', () => {
  it('is zero for the same point and grows with real separation', () => {
    expect(getDistanceInKm(NAGPUR.latitude, NAGPUR.longitude, NAGPUR.latitude, NAGPUR.longitude)).toBe(0);
    const near = getDistanceInKm(NAGPUR.latitude, NAGPUR.longitude, 21.1558, 79.0882);
    const far = getDistanceInKm(NAGPUR.latitude, NAGPUR.longitude, 19.076, 72.8777);
    expect(near).toBeGreaterThan(1);
    expect(near).toBeLessThan(2);
    // Nagpur → Mumbai is ~690 km as the crow flies.
    expect(far).toBeGreaterThan(600);
    expect(far).toBeLessThan(750);
  });

  it('treats a missing coordinate as unknown, never as zero', () => {
    expect(getDistanceInKm(21.1, 79.1, '', 0)).toBeNull();
    expect(getDistanceInKm(21.1, null, 21.2, 79.2)).toBeNull();
    expect(distanceBetween(NAGPUR, { latitude: null, longitude: null })).toBeNull();
    expect(distanceBetween(NAGPUR, { latitude: 21.1558, longitude: 79.0882 })).toBeCloseTo(1.11, 1);
  });

  it('formats the way the cards read', () => {
    expect(formatDistanceInKm(2.46)).toBe('2.5 km');
    expect(formatDistanceInKm(0)).toBe('< 0.1 km');
    expect(formatDistanceInKm(0.05)).toBe('< 0.1 km');
    expect(formatDistanceInKm(null)).toBe('');
    expect(normalizeDistanceInKm('2.5 km')).toBe(2.5);
    expect(normalizeDistanceInKm('50 m')).toBe(0.05);
    expect(normalizeDistanceInKm(0)).toBeNull();
  });
});

describe('map links', () => {
  it('builds a marker URL for the embed and a deep link for the app', () => {
    const embed = openStreetMapEmbedUrl(NAGPUR);
    expect(embed).toContain('openstreetmap.org/export/embed.html');
    expect(embed).toContain('marker=21.1458,79.0882');
    expect(embed).toContain('bbox=');
    expect(mapsUrl(NAGPUR)).toBe('https://www.google.com/maps/search/?api=1&query=21.1458,79.0882');
    expect(openStreetMapEmbedUrl(null)).toBe('');
    expect(mapsUrl({})).toBe('');
  });

  it('formats readable coordinates', () => {
    expect(formatCoordinates(NAGPUR)).toBe('21.14580, 79.08820');
    expect(formatCoordinates(NAGPUR, 2)).toBe('21.15, 79.09');
    expect(formatCoordinates(null)).toBe('');
  });
});

describe('delivery point resolution', () => {
  it('prefers the order snapshot, then the record itself', () => {
    const order = {
      address: { latitude: 21.2, longitude: 79.2 },
      deliveryLocation: { latitude: 21.1458, longitude: 79.0882 },
    };
    expect(deliveryPointOf(order)).toEqual({ latitude: 21.1458, longitude: 79.0882 });
    expect(deliveryPointOf({ address: { latitude: null, longitude: null }, latitude: 21.2, longitude: 79.2 })).toEqual({ latitude: 21.2, longitude: 79.2 });
    expect(deliveryPointOf({ address: {} })).toBeNull();
    expect(deliveryPointOf(null)).toBeNull();
  });

  it('describes how stale a pinned location is', () => {
    const now = new Date('2026-10-21T10:00:00Z').getTime();
    expect(locationAgeLabel(new Date(now - 30 * 1000).toISOString(), now)).toBe('just now');
    expect(locationAgeLabel(new Date(now - 25 * 60000).toISOString(), now)).toBe('25 min ago');
    expect(locationAgeLabel(new Date(now - 5 * 3600000).toISOString(), now)).toBe('5 hr ago');
    expect(locationAgeLabel(new Date(now - 3 * 86400000).toISOString(), now)).toBe('3 days ago');
    expect(locationAgeLabel('', now)).toBe('');
  });
});
