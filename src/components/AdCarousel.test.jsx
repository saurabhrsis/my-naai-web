import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The promo carousel measured ONE aspect ratio — from whichever image loaded
// first — and applied it to every slide. Any ad shaped differently from the
// first was then letterboxed by `object-fit: contain`: thick empty bands above
// and below the artwork, which is what a tablet screenshot showed.
//
// Two fixes are covered here:
//   1. every slide is measured, and the frame uses the tallest ad so switching
//      slides never makes the page jump;
//   2. an image that was already cached (its `onLoad` fires before React can
//      attach a handler, so it never arrives) is measured via the ref instead.

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual('../lib/api');
  return { ...actual, getFileUrl: value => value };
});

import { HomeScreen } from './UserScreens';
import { api } from '../lib/api';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

let container;
let root;

// jsdom reports 0x0 for every image, so `naturalWidth`/`naturalHeight` are
// stubbed per-URL. The map is what each test uses to describe its artwork.
const setNaturalSize = sizes => {
  const pick = element => sizes[element.getAttribute('src')] || { width: 0, height: 0 };
  Object.defineProperty(window.HTMLImageElement.prototype, 'naturalWidth', {
    configurable: true,
    get() { return pick(this).width; },
  });
  Object.defineProperty(window.HTMLImageElement.prototype, 'naturalHeight', {
    configurable: true,
    get() { return pick(this).height; },
  });
};

// `complete` decides which measuring path runs: true = cached (ref callback),
// false = a real load event.
const setComplete = value => {
  Object.defineProperty(window.HTMLImageElement.prototype, 'complete', {
    configurable: true,
    get() { return value; },
  });
};

const mount = async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<HomeScreen session={{ userId: 'user-1', user: { fullName: 'Saurabh' } }} navigate={() => {}} notify={() => {}} />);
  });
  await flush();
};

const frameRatio = () => container.querySelector('.ad-carousel-wrap')?.style.getPropertyValue('--ad-ratio');

beforeEach(() => {
  localStorage.clear();
  setComplete(false);
  vi.spyOn(api, 'userSalonList').mockResolvedValue({ status: 'SUCCESS', data: { salons: [] } });
  vi.spyOn(api, 'userSalonListPublic').mockResolvedValue({ status: 'SUCCESS', data: { salons: [] } });
});

afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

describe('Promo carousel sizing', () => {
  it('sizes the frame to the tallest ad, not just the first one', async () => {
    // A wide 3:1 banner first, then a squarer 1.2:1 one. Sizing everything to
    // the first ad would letterbox the second.
    vi.spyOn(api, 'userAds').mockResolvedValue({ status: 'SUCCESS', data: { ads: ['/wide.png', '/tall.png'] } });
    setNaturalSize({ '/wide.png': { width: 1200, height: 400 }, '/tall.png': { width: 1200, height: 1000 } });
    await mount();

    const images = Array.from(container.querySelectorAll('.ad-image'));
    expect(images).toHaveLength(2);
    await act(async () => { images.forEach(image => image.dispatchEvent(new Event('load'))); });
    await flush();

    // 1200/400 = 3 clamps to 2.4; 1200/1000 = 1.2. The frame takes the smaller
    // (taller) of the two so neither ad is letterboxed or cropped.
    expect(Number(frameRatio())).toBeCloseTo(1.2, 3);
  });

  it('measures an ad that was already cached, whose load event never fires', async () => {
    vi.spyOn(api, 'userAds').mockResolvedValue({ status: 'SUCCESS', data: { ads: ['/cached.png'] } });
    setNaturalSize({ '/cached.png': { width: 1600, height: 1000 } });
    setComplete(true); // already decoded: React attaches onLoad too late
    await mount();

    // No load event is dispatched at all — the ref path has to do the work.
    expect(Number(frameRatio())).toBeCloseTo(1.6, 3);
  });

  it('falls back to the default frame when an ad reports no dimensions', async () => {
    vi.spyOn(api, 'userAds').mockResolvedValue({ status: 'SUCCESS', data: { ads: ['/broken.png'] } });
    setNaturalSize({});
    await mount();

    const image = container.querySelector('.ad-image');
    await act(async () => { image.dispatchEvent(new Event('load')); });
    await flush();

    // Nothing measurable, so no inline ratio is written and the CSS default
    // (3 / 2) applies rather than a collapsed or NaN frame.
    expect(frameRatio()).toBeFalsy();
  });
});
