/**
 * Sprint 13 AC-11 (spec 11.1, WCAG 2.1 AA): every text and control colour pair
 * of the app's tokens (apps/mobile/src/theme/tokens.ts), in light and dark.
 * Text needs 4.5:1 (1.4.3); a control's edge or state needs 3:1 (1.4.11).
 * Disabled controls and placeholders (textTertiary, disabled*) are exempt.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(join(root, 'apps', 'mobile', 'src', 'theme', 'tokens.ts'), 'utf8');

/** The flat `name: '#RRGGBB'` entries of one scheme inside `export const colors`. */
function scheme(name) {
  const colors = app.slice(app.indexOf('export const colors'));
  const start = colors.indexOf(`  ${name}: {`);
  const end = colors.indexOf('\n  },', start);
  const block = colors.slice(start, end);
  return Object.fromEntries(
    [...block.matchAll(/^ {4}([a-zA-Z]+): '(#[0-9A-Fa-f]{6})'/gm)].map((m) => [m[1], m[2]]),
  );
}

const channel = (v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** [foreground, background, minimum]. */
const TEXT = 4.5;
const UI = 3;
const PAIRS = [
  ...['surface', 'canvas', 'surfaceRaised', 'surfaceAlt', 'openRow'].flatMap((bg) => [
    ['textPrimary', bg, TEXT],
    ['textSecondary', bg, TEXT],
  ]),
  ['link', 'surface', TEXT],
  ['textAlert', 'surface', TEXT],
  ['textAlert', 'openRow', TEXT],
  ['onPrimary', 'primary', TEXT],
  ['secondaryFg', 'secondaryBg', TEXT],
  ['infoFg', 'infoBg', TEXT],
  ['ctaFg', 'ctaBg', TEXT],
  ['successSubtleFg', 'successSubtleBg', TEXT],
  ['alertSubtleFg', 'alertSubtleBg', TEXT],
  ['entryBannedFg', 'entryBannedBg', TEXT],
  ['entryRestrictedFg', 'entryRestrictedBg', TEXT],
  ['borderControl', 'surface', UI],
  ['focusRing', 'surface', UI],
  ['primary', 'surface', UI],
  ['activeBar', 'surface', UI],
];

describe('WCAG AA contrast of the tokens (sprint 13 AC-11)', () => {
  for (const name of ['light', 'dark']) {
    const c = scheme(name);
    it(`${name}: every pair meets its minimum`, () => {
      const failing = PAIRS.filter(([fg, bg]) => c[fg] && c[bg])
        .map(([fg, bg, min]) => ({
          pair: `${fg} on ${bg}`,
          ratio: +ratio(c[fg], c[bg]).toFixed(2),
          min,
        }))
        .filter((p) => p.ratio < p.min);
      assert.deepEqual(failing, []);
    });
    it(`${name}: the pairs are all there`, () => {
      const missing = PAIRS.flatMap(([fg, bg]) => [fg, bg]).filter((k) => !c[k]);
      assert.deepEqual([...new Set(missing)], []);
    });
  }
});
