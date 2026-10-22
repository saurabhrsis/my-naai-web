import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAP_CENTRE,
  MAX_ZOOM,
  MIN_ZOOM,
  TILE_SIZE,
  clampLatitude,
  clampZoom,
  panCentre,
  pointToScreen,
  projectPoint,
  roundPoint,
  screenToPoint,
  tileUrl,
  unprojectPoint,
  visibleTiles,
  wrapLongitude,
} from './tileMap';

// Nagpur — the coordinates every fixture in this repo uses.
const NAGPUR = { latitude: 21.1458, longitude: 79.0882 };

describe('projection', () => {
  it('puts (0, 0) at the centre of the world', () => {
    const { x, y, scale } = projectPoint({ latitude: 0, longitude: 0 }, 0);
    expect(scale).toBe(TILE_SIZE);
    expect(x).toBeCloseTo(TILE_SIZE / 2, 6);
    expect(y).toBeCloseTo(TILE_SIZE / 2, 6);
  });

  it('grows by a full tile dimension per zoom level', () => {
    expect(projectPoint(NAGPUR, 0).scale).toBe(256);
    expect(projectPoint(NAGPUR, 10).scale).toBe(256 * 1024);
  });

  it('round-trips a coordinate through world pixels', () => {
    for (const zoom of [3, 12, 17, MAX_ZOOM]) {
      const back = unprojectPoint(projectPoint(NAGPUR, zoom), zoom);
      expect(back.latitude).toBeCloseTo(NAGPUR.latitude, 6);
      expect(back.longitude).toBeCloseTo(NAGPUR.longitude, 6);
    }
  });

  it('clamps to the Mercator limits instead of producing Infinity', () => {
    const north = projectPoint({ latitude: 90, longitude: 0 }, 5);
    expect(Number.isFinite(north.y)).toBe(true);
    expect(clampLatitude(90)).toBeLessThan(86);
    expect(clampLatitude(-90)).toBeGreaterThan(-86);
  });
});

describe('normalisation', () => {
  it('wraps longitude past the antimeridian', () => {
    expect(wrapLongitude(190)).toBeCloseTo(-170, 6);
    expect(wrapLongitude(-190)).toBeCloseTo(170, 6);
    expect(wrapLongitude(79.0882)).toBeCloseTo(79.0882, 6);
  });

  it('keeps zoom inside the tile pyramid', () => {
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(clampZoom(40)).toBe(MAX_ZOOM);
    expect(clampZoom('13.4')).toBe(13);
  });

  it('rounds a saved pin to ~1 m', () => {
    expect(roundPoint({ latitude: 21.1458123456, longitude: 79.0882123456 }))
      .toEqual({ latitude: 21.14581, longitude: 79.08821 });
    expect(roundPoint(null)).toBeNull();
  });
});

describe('screen <-> coordinate', () => {
  const view = { centre: NAGPUR, zoom: 16, width: 320, height: 240 };

  it('draws the centre point in the middle of the viewport', () => {
    const screen = pointToScreen(NAGPUR, view);
    expect(screen.left).toBeCloseTo(160, 6);
    expect(screen.top).toBeCloseTo(120, 6);
  });

  it('turns a tap back into the coordinate under it', () => {
    for (const tap of [{ left: 10, top: 10 }, { left: 300, top: 200 }, { left: 160, top: 120 }]) {
      const point = screenToPoint(tap, view);
      const back = pointToScreen(point, view);
      expect(back.left).toBeCloseTo(tap.left, 4);
      expect(back.top).toBeCloseTo(tap.top, 4);
    }
  });

  it('pans the centre by a pixel delta, both ways', () => {
    // `delta` is the finger's movement: dragging right shows what is west.
    const moved = panCentre(NAGPUR, { left: 100, top: 0 }, 16);
    expect(moved.longitude).toBeLessThan(NAGPUR.longitude);
    const north = panCentre(NAGPUR, { left: 0, top: 100 }, 16);
    expect(north.latitude).toBeGreaterThan(NAGPUR.latitude);
    const home = panCentre(moved, { left: -100, top: 0 }, 16);
    expect(home.longitude).toBeCloseTo(NAGPUR.longitude, 6);
    expect(home.latitude).toBeCloseTo(NAGPUR.latitude, 6);
  });
});

describe('tiles', () => {
  it('fills the viewport with no gaps', () => {
    const width = 320;
    const height = 240;
    const tiles = visibleTiles({ centre: NAGPUR, zoom: 14, width, height });
    expect(tiles.length).toBeGreaterThan(0);
    for (const tile of tiles) {
      expect(tile.left).toBeLessThanOrEqual(width);
      expect(tile.top).toBeLessThanOrEqual(height);
      expect(tile.left + TILE_SIZE).toBeGreaterThanOrEqual(0);
      expect(tile.top + TILE_SIZE).toBeGreaterThanOrEqual(0);
    }
    // Two by two is the minimum for a 320x240 box; the seams are covered.
    expect(tiles.length).toBeGreaterThanOrEqual(4);
    expect(new Set(tiles.map(tile => tile.src)).size).toBe(tiles.length);
  });

  it('never asks for a row outside the world', () => {
    for (const zoom of [3, 6, 12]) {
      for (const tile of visibleTiles({ centre: { latitude: 84.9, longitude: 179.9 }, zoom, width: 800, height: 600 })) {
        const row = Number(tile.src.split('/').at(-1).replace('.png', ''));
        expect(row).toBeGreaterThanOrEqual(0);
        expect(row).toBeLessThan(2 ** zoom);
      }
    }
  });

  it('wraps columns past the antimeridian instead of going blank', () => {
    const tiles = visibleTiles({ centre: { latitude: 0, longitude: 179.9 }, zoom: 4, width: 900, height: 300 });
    const columns = tiles.map(tile => Number(tile.src.split('/').at(-2)));
    expect(Math.min(...columns)).toBeGreaterThanOrEqual(0);
    // A wrapped column exists (the map continues on the other side).
    expect(columns.some(column => column < 4)).toBe(true);
  });

  it('builds a keyless OSM tile url', () => {
    expect(tileUrl(12, 345, 678)).toBe('https://tile.openstreetmap.org/12/345/678.png');
  });

  it('starts a new pin in Nagpur', () => {
    expect(DEFAULT_MAP_CENTRE).toEqual({ latitude: 21.1458, longitude: 79.0882 });
  });
});
