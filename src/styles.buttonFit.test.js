import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

// The stylesheet is the thing that was wrong, so the stylesheet is what is
// checked. Reported from a phone: "Save and continue to payment" (and the other
// long labels in the editor, the delay sheet and the checkout) was drawn PAST
// the rounded edge of its own button, and in a half-width button it ran off the
// card. The cause was `.btn { white-space: nowrap }` in a flex row that could not
// shrink; the fix is that a label wraps inside the box instead.
const css = readFileSync(`${process.cwd()}/src/styles.css`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// The base `.btn` rule (the single-line declaration block the atoms share).
const btn = (css.match(/(?:^|\n)\.btn\s*\{([^}]*)\}/) || [])[1] || '';

// The phone breakpoints: every `@media (max-width: 520px)` block, taken as the
// text between it and the next `@media`. Nested braces make a real parse
// unnecessary here — this only has to find the rules, and the stylesheet has
// more than one 520px block.
function mediaBlocks(query) {
  const blocks = [];
  let start = css.indexOf(`@media ${query}`);
  while (start !== -1) {
    const next = css.indexOf('@media', start + 1);
    blocks.push(css.slice(start, next === -1 ? css.length : next));
    start = next;
  }
  return blocks.join('\n');
}

const phone = mediaBlocks('(max-width: 520px)');

describe('button labels fit their buttons', () => {
  it('does not force every button onto one line', () => {
    expect(btn).toMatch(/white-space:\s*normal/);
    expect(btn).not.toMatch(/white-space:\s*nowrap/);
  });

  it('lets a flex row shrink the button instead of overflowing the screen', () => {
    expect(btn).toMatch(/min-width:\s*0/);
    expect(btn).toMatch(/overflow-wrap:\s*anywhere/);
    expect(btn).toMatch(/max-width:\s*100%/);
  });

  it('gives two-button action bars one row each on a phone', () => {
    // "Save and continue to payment" beside "Cancel" — the reported pair.
    expect(phone).toMatch(/\.editor-actions \.btn[^{]*\{[^}]*flex:\s*1 1 100%/);
    // …and the label itself drops a notch at phone width.
    expect(phone).toMatch(/(?:^|\n)\s*\.btn\s*\{[^}]*font-size:\s*12\.5px/);
  });

  it('never re-imposes nowrap on a shared button rule', () => {
    const offenders = (css.match(/(?:^|\n)[^\n{}]*\.btn[^{]*\{[^}]*\}/g) || [])
      .filter(rule => /white-space:\s*nowrap/.test(rule));
    expect(offenders).toEqual([]);
  });
});
