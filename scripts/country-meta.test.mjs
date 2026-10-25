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

  it('uses the symbol locals use when English has none (not the ISO code again)', () => {
    assert.equal(meta.ARE.currency.symbol, 'د.إ.');
    assert.equal(meta.KEN.currency.symbol, 'Ksh');
    assert.equal(meta.PER.currency.symbol, 'S/');
    assert.equal(meta.COD.currency.symbol, 'FC');
    assert.equal(meta.PNG.currency.symbol, 'K');
    // CLDR has no other symbol for these; the card shows the code alone.
    const codeOnly = new Set();
    for (const { currency } of Object.values(meta)) {
      if (currency && currency.symbol === currency.code) codeOnly.add(currency.code);
    }
    assert.deepEqual([...codeOnly].sort(), ['CHF', 'CVE', 'HTG', 'RSD', 'TMT', 'ZWG']);
  });

  it('gives every area its names, a label point and a size for the camera', () => {
    for (const [adm0, entry] of Object.entries(meta)) {
      assert.ok(entry.nameHe?.trim() && entry.nameEn?.trim(), `${adm0} names`);
      assert.equal(entry.label.length, 2, `${adm0} label`);
      assert.ok(entry.span >= 0 && entry.span < 180, `${adm0} span ${entry.span}`);
    }
  });

  it('frames the mainland, not overseas territories, so the camera zooms in', () => {
    // zoomForSpan(span) > 3 needs span < 123 / 2^3 ≈ 15.4 (apps/mobile/src/features/globe/camera.ts)
    for (const adm0 of ['FRA', 'NLD', 'NOR', 'DNK', 'PRT', 'ESP', 'GBR']) {
      assert.ok(meta[adm0].span < 15.4, `${adm0} span ${meta[adm0].span}`);
    }
  });

  it('measures countries that cross the antimeridian the short way round', () => {
    assert.ok(meta.RUS.span < 100, `Russia ${meta.RUS.span}`);
    assert.ok(meta.FJI.span < 15, `Fiji ${meta.FJI.span}`);
  });

  it('enlarges the tap target of small areas, measured by land not by spread', () => {
    for (const adm0 of ['VAT', 'MCO', 'SGP', 'MLT', 'LUX', 'MDV', 'KIR']) {
      assert.equal(meta[adm0].small, true, adm0);
    }
    for (const adm0 of ['ISR', 'BEL', 'CHE', 'CYP', 'THA']) {
      assert.equal(meta[adm0].small, undefined, adm0);
    }
  });

  it('shows the right data for popular destinations', () => {
    assert.equal(meta.THA.nameHe, 'תאילנד');
    assert.equal(meta.THA.timeZone, 'Asia/Bangkok');
    assert.deepEqual(meta.THA.currency, { code: 'THB', nameHe: 'בהט תאילנדי', symbol: '฿' });
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
      assert.equal(meta[adm0].timeZone, undefined, adm0);
      assert.equal(meta[adm0].currency, undefined, adm0);
    }
  });

  it('names every currency once, without a repeated word (AFN was "אפגני אפגני")', () => {
    assert.equal(meta.AFG.currency.nameHe, 'אפגני');
    // The currency uses the country's own word, not CLDR's "הנסיכויות" (sprint 1 QA).
    assert.equal(meta.ARE.currency.nameHe, 'דירהם של איחוד האמירויות הערביות');
    for (const [adm0, { currency }] of Object.entries(meta)) {
      if (!currency) continue;
      const words = currency.nameHe.split(' ');
      assert.equal(new Set(words).size, words.length, `${adm0}: ${currency.nameHe}`);
    }
  });

  it('links each territory to its sovereign, for search results', () => {
    assert.equal(meta.GIB.parent, 'GBR');
    assert.equal(meta.GUM.parent, 'USA');
    assert.equal(meta.IOA.parent, 'AUS');
    assert.equal(meta.HKG.parent, 'CHN');
    for (const adm0 of ['FRA', 'GBR', 'ISR', 'USA'])
      assert.equal(meta[adm0].parent, undefined, adm0);
    for (const [adm0, entry] of Object.entries(meta)) {
      if (entry.parent) assert.ok(meta[entry.parent], `${adm0} → ${entry.parent}`);
    }
  });

  it('keeps Kosovo on Belgrade time', () => {
    assert.equal(meta.KOS.timeZone, 'Europe/Belgrade');
  });
});
