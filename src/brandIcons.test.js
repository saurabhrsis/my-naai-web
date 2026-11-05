// The tab icon is the logo, not a white copy of it.
//
// The icons were once cut to a white silhouette before being placed on the dark
// plate, so every browser tab and home-screen icon showed a white "m" while the
// logo on the page was gold. Reported as "don't change the colour of the logo in
// favicon, we need the same as the logo, not white".
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

  it('ships an .ico that carries the gold too', () => {
    const hex = execFileSync('convert', ['public/favicon.ico[0]', '-alpha', 'off', '-colors', '4', '-format', '%c', 'histogram:info:'], { encoding: 'utf8' });
    // The gold appears in the palette; a white-only icon would not.
    expect(/F[0-9A-F]?[0-9A-F]?B[0-9A-F]?6B|\(2[34][0-9]\.|\(18[0-9]\./i.test(hex) || /#[E-F][0-9A-F][A-F0-9]{4}/i.test(hex)).toBe(true);
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
