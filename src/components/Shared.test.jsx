import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { ImageWithFallback, formatDistanceInKm, getDistanceInKm, getSalonStatus, normalizeDistanceInKm } from './Shared';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('distance helpers', () => {
  it('allows valid zero coordinates but rejects missing coordinates', () => {
    expect(getDistanceInKm(0, 0, 1, 1)).toBeGreaterThan(0);
    expect(getDistanceInKm(18, 73, '', 0)).toBeNull();
  });

  it('does not treat a server placeholder zero as a reported distance', () => {
    expect(normalizeDistanceInKm(0)).toBeNull();
    expect(normalizeDistanceInKm('0 km')).toBeNull();
    expect(normalizeDistanceInKm('2.5 km')).toBe(2.5);
    expect(normalizeDistanceInKm('50 m')).toBe(0.05);
  });

  it('formats a genuinely calculated near-zero distance without showing 0 km', () => {
    expect(formatDistanceInKm(0)).toBe('< 0.1 km');
    expect(formatDistanceInKm(getDistanceInKm(18, 73, 18.0005, 73))).toBe('< 0.1 km');
    expect(formatDistanceInKm(2.46)).toBe('2.5 km');
  });
});

describe('ImageWithFallback', () => {
  // jsdom never loads images, so a provided src always renders as-is and the
  // tile treatment is decided purely from which source is resolved.
  function renderImage(props = {}) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => { root.render(<ImageWithFallback {...props} />); });
    const img = container.querySelector('img');
    act(() => { root.unmount(); });
    container.remove();
    return img;
  }

  it('letterboxes the brand logo fallback instead of stretching it', () => {
    expect(renderImage({ src: '' }).className).toContain('image-fallback-tile');
    expect(renderImage({ src: '/assets/brand/mynaai-mark.png' }).className).toContain('image-fallback-tile');
    expect(renderImage({ src: '' }).className).toContain('image-fallback-tile');
  });

  it('keeps photo sources filling their frame', () => {
    expect(renderImage({ src: 'salon-photo.jpg' }).className).not.toContain('image-fallback-tile');
    expect(renderImage({ src: '', fallback: '/assets/naai/ad2.jpg' }).className).not.toContain('image-fallback-tile');
  });

  it('loads images lazily but lets a caller opt out', () => {
    expect(renderImage({ src: 'a.jpg' }).getAttribute('loading')).toBe('lazy');
    expect(renderImage({ src: 'a.jpg', loading: 'eager' }).getAttribute('loading')).toBe('eager');
  });
});

describe('getSalonStatus (Indian-time open/closed)', () => {
  const hours = (openingTime, closingTime, holidayDays = []) => [{ openingTime, closingTime, holidayDays }];
  // 2026-10-16 is a Friday. These UTC instants are picked for their IST wall-clock.
  const ist = {
    justBeforeOpen: new Date('2026-10-16T04:29:59Z'), // 09:59 IST Fri
    atOpen: new Date('2026-10-16T04:30:00Z'),         // 10:00 IST Fri
    midDay: new Date('2026-10-16T09:00:00Z'),         // 14:30 IST Fri
    atClose: new Date('2026-10-16T15:30:00Z'),        // 21:00 IST Fri
    afterMidnight: new Date('2026-10-16T19:00:00Z'),  // 00:30 IST Sat
  };

  it('follows the Indian clock, not the device clock, for in-hours times', () => {
    const status = getSalonStatus(hours('10:00:00', '21:00:00'), undefined, ist.midDay);
    expect(status.isOpen).toBe(true);
    expect(status.text).toBe('OPEN NOW');
  });

  it('is closed just before opening and exactly at closing', () => {
    expect(getSalonStatus(hours('10:00:00', '21:00:00'), undefined, ist.justBeforeOpen).isOpen).toBe(false);
    expect(getSalonStatus(hours('10:00:00', '21:00:00'), undefined, ist.atOpen).isOpen).toBe(true);
    expect(getSalonStatus(hours('10:00:00', '21:00:00'), undefined, ist.atClose).isOpen).toBe(false);
  });

  it('ignores the stale API flag for salons WITH timings (the false-by-default is_open used to close every card)', () => {
    expect(getSalonStatus(hours('10:00:00', '21:00:00'), false, ist.midDay).isOpen).toBe(true);
    expect(getSalonStatus(hours('10:00:00', '21:00:00'), true, ist.atClose).isOpen).toBe(false);
  });

  it('falls back to the manual flag only when no timings are published', () => {
    expect(getSalonStatus([], true).isOpen).toBe(true);
    expect(getSalonStatus([], false).isOpen).toBe(false);
    expect(getSalonStatus([]).isOpen).toBe(false);
    // Incomplete timings (opening without a closing time) count as unpublished:
    expect(getSalonStatus([{ openingTime: '10:00:00' }], true).isOpen).toBe(true);
    expect(getSalonStatus([{ openingTime: '10:00:00' }], false).isOpen).toBe(false);
  });

  it('respects holiday days on the Indian weekday', () => {
    const status = getSalonStatus(hours('10:00:00', '21:00:00', ['Friday']), undefined, ist.midDay);
    expect(status.isOpen).toBe(false);
    expect(status.text).toBe('CLOSED · HOLIDAY');
  });

  it('handles schedules that cross midnight', () => {
    expect(getSalonStatus(hours('20:00:00', '02:00:00'), undefined, ist.afterMidnight).isOpen).toBe(true);
    expect(getSalonStatus(hours('20:00:00', '02:00:00'), undefined, new Date('2026-10-16T20:30:00Z')).isOpen).toBe(false); // 02:00 IST
  });
});
