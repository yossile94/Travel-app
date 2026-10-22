/**
 * Guards the globe card data built by scripts/build-country-meta.mjs.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const meta = JSON.parse(
  readFileSync(
    join(root, 'apps', 'mobile', 'src', 'features', 'globe', 'countryMeta.json'),
    'utf8',
  ),
);
const { features } = JSON.parse(
  readFileSync(join(root, 'apps', 'mobile', 'assets', 'geo', 'countries.geojson'), 'utf8'),
);

describe('globe card data', () => {
  it('has an entry for every selectable area, and only for those', () => {
    const selectable = features.filter((f) => f.properties.code).map((f) => f.properties.adm0);
    assert.deepEqual(Object.keys(meta).sort(), [...selectable].sort());
  });

  it('uses only time zones the runtime knows', () => {
    for (const [adm0, entry] of Object.entries(meta)) {
      if (!entry.timeZone) continue;
      assert.doesNotThrow(
        () => new Intl.DateTimeFormat('en-US', { timeZone: entry.timeZone }),
        adm0,
      );
    }
  });

  it('gives every currency a code, a Hebrew name and a symbol', () => {
    for (const [adm0, { currency }] of Object.entries(meta)) {
      if (!currency) continue;
      assert.match(currency.code, /^[A-Z]{3}$/, adm0);
      assert.ok(currency.nameHe.trim(), `${adm0} Hebrew name`);
      assert.ok(currency.symbol.trim(), `${adm0} symbol`);
    }
  });

  it('shows the right data for popular destinations', () => {
    assert.deepEqual(meta.THA, {
      timeZone: 'Asia/Bangkok',
      currency: { code: 'THB', nameHe: 'בהט תאילנדי', symbol: '฿' },
    });
    assert.equal(meta.GRC.timeZone, 'Europe/Athens');
    assert.equal(meta.GRC.currency.code, 'EUR');
    assert.equal(meta.ISR.currency.code, 'ILS');
  });

  it('is up to date with currency changes (Bulgaria joined the euro on 2026-01-01)', () => {
    assert.equal(meta.BGR.currency.code, 'EUR');
  });

  it('labels the capital for countries that span several time offsets', () => {
    assert.deepEqual(
      { timeZone: meta.USA.timeZone, city: meta.USA.city },
      { timeZone: 'America/New_York', city: 'וושינגטון' },
    );
    assert.equal(meta.RUS.city, 'מוסקבה');
    assert.equal(meta.AUS.city, 'קנברה');
  });

  it('gives territories their own clock, not their parent country’s', () => {
    assert.equal(meta.IOA.timeZone, 'Indian/Christmas');
    assert.notEqual(meta.IOA.timeZone, meta.AUS.timeZone);
  });

  it('hides time and currency for uninhabited areas', () => {
    for (const adm0 of ['ATA', 'CSI', 'ATC', 'CLP', 'HMD', 'UMI']) {
      assert.deepEqual(meta[adm0], {}, adm0);
    }
  });

  it('keeps Kosovo on Belgrade time', () => {
    assert.equal(meta.KOS.timeZone, 'Europe/Belgrade');
  });
});
