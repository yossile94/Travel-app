// Sprint 11 D10, D11: which places are kept, in which category, under which name.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AREA_MAX,
  CITY_MAX,
  COUNTRY_MAX,
  cleanName,
  km,
  point,
  render,
  resolveShared,
  selectPlaces,
  withinCap,
} from './build-places.mjs';

const item = (qid, links, [lon, lat], en = `Place ${qid}`, he = undefined) => ({
  item: { value: `http://www.wikidata.org/entity/${qid}` },
  links: { value: String(links) },
  coord: { value: `Point(${lon} ${lat})` },
  en: en ? { value: en } : undefined,
  he: he ? { value: he } : undefined,
});

describe('places (sprint 11 D10)', () => {
  it('an item in two groups keeps the higher-priority one (a zoo that is also an attraction)', () => {
    const zoo = item('Q1', 50, [100.5, 13.7], 'Dusit Zoo', 'גן החיות דוסית');
    const rows = selectPlaces('THA', { family: [zoo], attraction: [zoo] }, []);
    assert.deepEqual(
      rows.map((r) => [r.qid, r.group, r.he, r.en]),
      [['Q1', 'family', 'גן החיות דוסית', 'Dusit Zoo']],
    );
  });

  it('keeps the area top 60, plus up to 20 near each large city', () => {
    const far = Array.from({ length: 80 }, (_, i) => item(`Q${100 + i}`, 1000 - i, [98, 18]));
    const near = Array.from({ length: 30 }, (_, i) =>
      item(`Q${500 + i}`, 5 - (i % 5), [100.5, 13.75]),
    );
    const rows = selectPlaces('THA', { attraction: [...far, ...near] }, [[100.5, 13.75]]);
    assert.equal(rows.length, AREA_MAX + CITY_MAX);
    assert.equal(rows.filter((r) => r.qid >= 'Q500' && r.qid.length === 4).length, CITY_MAX);
  });

  it('every bundled city gets its places, not only the 5 largest (D18)', () => {
    const far = Array.from({ length: 80 }, (_, i) => item(`Q${100 + i}`, 1000 - i, [30, 60]));
    const cities = Array.from({ length: 7 }, (_, i) => [10 + i, 50]);
    const small = cities.map(([lon, lat], i) => item(`Q${900 + i}`, 1, [lon, lat]));
    const rows = selectPlaces('DEU', { culture: [...far, ...small] }, cities);
    assert.equal(rows.length, AREA_MAX + 7);
    assert.ok(rows.some((r) => r.qid === 'Q906'));
  });

  it('a country over the cap fails the build (D22)', () => {
    const rows = Array.from({ length: COUNTRY_MAX + 1 }, () => ({}));
    assert.throws(() => withinCap('DEU', rows), /DEU: 1501 places, over 1500/);
    assert.equal(withinCap('THA', rows.slice(1)).length, COUNTRY_MAX);
  });

  it('no name and no point: dropped; a Hebrew-only name is used for English too', () => {
    const rows = selectPlaces(
      'ISR',
      {
        culture: [
          item('Q7', 9, [35.2, 31.7], null, 'הכותל'),
          item('Q8', 9, [35.2, 31.7], null, undefined),
          { ...item('Q9', 9, [0, 0]), coord: { value: 'nonsense' } },
        ],
      },
      [],
    );
    assert.deepEqual(
      rows.map((r) => [r.qid, r.he, r.en]),
      [['Q7', 'הכותל', 'הכותל']],
    );
  });

  it('names are one clean line, never a bare QID or too long', () => {
    assert.equal(cleanName('  Wat‏  Pho\n'), 'Wat Pho');
    assert.equal(cleanName('Q12345'), null);
    assert.equal(cleanName('x'.repeat(121)), null);
  });

  it('points and distances', () => {
    assert.deepEqual(point('Point(100.5 13.75)'), [100.5, 13.75]);
    assert.equal(point('Point(200 0)'), null);
    assert.ok(Math.abs(km([34.78, 32.08], [35.21, 31.77]) - 54) < 2); // Tel Aviv – Jerusalem
  });

  it('the migration upserts and hides, quoting names', () => {
    const sql = render(
      [
        {
          qid: 'Q1',
          adm0: 'THA',
          he: "בית ה'",
          en: "Ta'Prohm",
          group: 'culture',
          links: 5,
          at: [100, 13],
        },
      ],
      'abc',
    );
    assert.match(sql, /on conflict \(adm0, wikidata_id\) do update/);
    assert.match(sql, /set hidden = true\nwhere not p\.hidden and not exists/);
    assert.match(sql, /'Ta''Prohm'/);
    // The CLI's own transaction (Dudi 5).
    assert.doesNotMatch(sql, /^(begin|commit);$/m);
    assert.match(sql, /drop table places_build;/);
  });

  it('the same place twice in one country fails the build', () => {
    const row = {
      qid: 'Q1',
      adm0: 'THA',
      he: null,
      en: 'A',
      group: 'culture',
      links: 1,
      at: [100, 13],
    };
    assert.throws(() => render([row, row], 'x'), /twice in one country/);
  });

  it('D24: a shared place is in both countries, a disputed one in one only', () => {
    const at = (qid, adm0, point) => ({ qid, adm0, at: point });
    const rows = [
      at('Q34221', 'CAN', [-79.07, 43.08]),
      at('Q34221', 'USA', [-79.07, 43.08]),
      at('Q1', 'ISR', [35.69, 33.25]),
      at('Q1', 'SYR', [35.69, 33.25]),
      at('Q2', 'RUS', [34.13, 44.43]),
      at('Q2', 'UKR', [34.13, 44.43]),
      at('Q3', 'CHN', [118.8, 32.05]),
      at('Q3', 'TWN', [118.8, 32.05]),
    ];
    const cities = { CHN: [[118.78, 32.06]], TWN: [[121.56, 25.04]] };
    const kept = resolveShared(rows, cities).map((r) => `${r.adm0}:${r.qid}`);
    assert.deepEqual(kept, ['CAN:Q34221', 'USA:Q34221', 'ISR:Q1', 'UKR:Q2', 'CHN:Q3']);
  });
});
