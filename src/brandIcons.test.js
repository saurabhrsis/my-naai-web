// The tab icon is the logo, not a white copy of it.
//
// The icons were once cut to a white silhouette before being placed on the dark
// plate, so every browser tab and home-screen icon showed a white "m" while the
// logo on the page was gold. Reported as "don't change the colour of the logo in
// favicon, we need the same as the logo, not white".
//
// The same rule covers the notification: its large icon is the artwork on
// transparency (gold, big, bright) and only the status-bar badge is monochrome
// — because Android masks that one to a single colour — and that badge must be
// SOLID white. It used to carry white at ~93% alpha, which the phone composited
// to a grey ghost: the "dull icon" in the notification bar.
//
// These checks read the committed PNGs byte-wise (no image library in this
// project) through ImageMagick's `convert`, which is already a build-time tool
// here — see scripts/brand-icons.sh. If ImageMagick is not installed the file
// skips, so a machine without it is not blocked.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const hasMagick = (() => {
  try {
    execFileSync('convert', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

// "#F2B96B" — the brand gold the supplied artwork is drawn in.
const BRAND_GOLD = { r: 0xf2, g: 0xb9, b: 0x6b };

const iconFiles = [
  'public/icons/favicon-16.png',
  'public/icons/favicon-32.png',
  'public/icons/icon-192.png',
  'public/icons/icon-512.png',
  'public/icons/icon-maskable-512.png',
  'public/icons/apple-touch-icon.png',
  'public/icons/notification-192.png',
];

/** The single most common non-background colour of an image, as {r,g,b}. */
function dominantArtColour(file) {
  const histogram = execFileSync('convert', [file, '-alpha', 'off', '-colors', '6', '-format', '%c', 'histogram:info:'], { encoding: 'utf8' })
    // e.g. " 156914: (241.72,184.786,106.879) #F2B96B srgb(...)"
    .trim().split('\n')
    .map(line => {
      const match = line.match(/^\s*(\d+):\s*\(([\d.]+),([\d.]+),([\d.]+)\)/);
      return match ? { count: Number(match[1]), r: Math.round(Number(match[2])), g: Math.round(Number(match[3])), b: Math.round(Number(match[4])) } : null;
    })
    .filter(Boolean);
  // The plate occupies the most pixels; the artwork is the next biggest bucket.
  return histogram.sort((a, b) => b.count - a.count)[1] || histogram[0];
}

const near = (value, target, tolerance = 24) => Math.abs(value - target) <= tolerance;

/** The artwork's bounding box, as fractions of the canvas, sampled at 64x64. */
function goldBox(file) {
  const text = execFileSync('convert', [file, '-alpha', 'off', '-resize', '64x64!', '-depth', '8', 'txt:-'], { encoding: 'utf8' });
  const xs = [];
  const ys = [];
  for (const line of text.split('\n')) {
    const match = line.match(/^(\d+),(\d+):.*?#([0-9A-F]{6})/i);
    if (!match) continue;
    const hex = match[3];
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    if (r > 150 && g > 100 && b < 180 && r > b + 40) {
      xs.push(Number(match[1]) / 64);
      ys.push(Number(match[2]) / 64);
    }
  }
  if (!xs.length) return null;
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

/** How opaque a single corner pixel is — 0 for a transparent canvas, 1 for a plate. */
function cornerAlpha(file) {
  const text = execFileSync('convert', [file, '-format', '%[fx:p{0,0}.a]', 'info:'], { encoding: 'utf8' }).trim();
  return Number(text);
}

describe.skipIf(!hasMagick)('the tab and app icons keep the logo’s gold', () => {
  it.each(iconFiles)('%s is gold on the dark plate, not white', file => {
    expect(existsSync(file), `${file} is committed`).toBe(true);
    const colour = dominantArtColour(file);
    expect(colour, `${file} has artwork`).toBeTruthy();
    expect(near(colour.r, BRAND_GOLD.r), `red channel of ${file} looks like the brand gold`).toBe(true);
    expect(near(colour.g, BRAND_GOLD.g), `green channel of ${file}`).toBe(true);
    expect(near(colour.b, BRAND_GOLD.b), `blue channel of ${file}`).toBe(true);
    // A white mark would fail all three; this keeps the reason in the message.
    const isWhite = colour.r > 230 && colour.g > 230 && colour.b > 230;
    expect(isWhite, `${file} must not be a white silhouette`).toBe(false);
  });

  it('keeps a white variant only for the one place that needs a silhouette', () => {
    // The Android status-bar badge is monochrome by platform rule — a gold badge
    // is drawn as a grey blob on some launchers.
    const badge = dominantArtColour('public/icons/badge-96.png');
    expect(badge.r > 200 && badge.g > 200 && badge.b > 200).toBe(true);
  });

  it('draws the status-bar badge in solid white, not a grey ghost', () => {
    // White at 93% alpha composited to #EDEDED on the phone's bar. The badge is
    // flattened over black here: the art must come out white, not grey.
    const flattened = execFileSync('convert', [
      'public/icons/badge-96.png', '-background', 'black', '-flatten',
      '-alpha', 'off', '-colors', '4', '-format', '%c', 'histogram:info:',
    ], { encoding: 'utf8' });
    const whites = flattened.split('\n')
      .map(line => line.match(/^\s*(\d+):\s*\(([\d.]+),([\d.]+),([\d.]+)\)/))
      .filter(Boolean)
      .map(([, count, r, g, b]) => ({ count: Number(count), r: Math.round(Number(r)), g: Math.round(Number(g)), b: Math.round(Number(b)) }))
      .filter(entry => entry.r > 240 && entry.g > 240 && entry.b > 240);
    expect(whites.length, 'badge-96.png has a solid white mark').toBeGreaterThan(0);
    expect(Math.max(...whites.map(entry => entry.count))).toBeGreaterThan(1000);
  });

  it('keeps the notification large icon in colour and the app icon on its plate', () => {
    // The banner shows `icon` at ~64dp: the artwork on transparency is bright,
    // a plated 192 is a dark smudge. And the app icon must KEEP its plate — a
    // transparent home-screen icon would sit on whatever wallpaper is behind it.
    expect(cornerAlpha('public/icons/notification-192.png')).toBeLessThan(0.1);
    expect(cornerAlpha('public/icons/icon-192.png')).toBeGreaterThan(0.99);
    const box = goldBox('public/icons/notification-192.png');
    expect(box, 'the notification icon has artwork').toBeTruthy();
    expect(box.x1 - box.x0, 'the mark fills the notification icon').toBeGreaterThan(0.8);
  });

  it('keeps every maskable crop inside the safe circle', () => {
    // Android's adaptive-icon mask may eat everything outside the middle 80%,
    // so the artwork's corners have to sit within a 0.4 radius of the centre.
    const box = goldBox('public/icons/icon-maskable-512.png');
    expect(box).toBeTruthy();
    const dx = Math.max(box.x1 - 0.5, 0.5 - box.x0);
    const dy = Math.max(box.y1 - 0.5, 0.5 - box.y0);
    expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(0.4);
  });

  it('ships an .ico that carries the gold too', () => {
    // At 16px the mark is mostly anti-aliased edge, so the bucket is a warm gold
    // (#D19F5C) rather than the flat #F2B96B — the test asks for the hue, not the
    // exact pixel. A white or grey tab icon fails it.
    const histograms = ['public/favicon.ico[0]', 'public/favicon.ico[1]'].map(layer => execFileSync(
      'convert',
      [layer, '-alpha', 'off', '-colors', '4', '-format', '%c', 'histogram:info:'],
      { encoding: 'utf8' },
    ));
    for (const histogram of histograms) {
      const warm = histogram.split('\n')
        .map(line => line.match(/^\s*(\d+):\s*\(([\d.]+),([\d.]+),([\d.]+)\)/))
        .filter(Boolean)
        .map(([, count, r, g, b]) => ({ count: Number(count), r: Math.round(Number(r)), g: Math.round(Number(g)), b: Math.round(Number(b)) }))
        .filter(entry => entry.r > 150 && entry.r > entry.b + 40 && entry.g > entry.b);
      expect(warm.length, 'the .ico carries the gold, not a white silhouette').toBeGreaterThan(0);
    }
  });

  it('does not draw the browser’s own colour into the favicon links', () => {
    // The <link rel="icon"> set must point at the PNGs above, and no icon may be
    // declared as a monochrome/maskable SVG drawn in `currentColor`.
    const html = readFileSync('index.html', 'utf8');
    expect(html).toContain('href="/favicon.ico"');
    expect(html).toContain('href="/icons/favicon-32.png"');
    expect(html).toContain('href="/icons/favicon-16.png"');
    expect(html).not.toMatch(/<link[^>]+rel="mask-icon"/);
  });
});
