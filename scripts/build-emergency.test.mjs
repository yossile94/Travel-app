import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { buildMissions, DATASET_URL, normalizeTel, sourceOf } from './build-emergency.mjs';

test('phones become E.164; the first of two; nothing when unreadable', () => {
  assert.equal(normalizeTel('00-54-11-37244500'), '+541137244500');
  assert.equal(normalizeTel('00-212-3-7631976/7 00-212-3-7993214'), '+21237631976');
  assert.equal(normalizeTel('00-886-886-227579692'), '+886227579692');
  assert.equal(normalizeTel(''), null);
  assert.equal(normalizeTel('02-5303155'), null);
});

test('the source is the mission page only on gov.il', () => {
  assert.equal(
    sourceOf('<a href="https://embassies.gov.il/bangkok">https://embassies.gov.il/bangkok</a>'),
    'https://embassies.gov.il/bangkok',
  );
  assert.equal(sourceOf('<a href="https://example.com">x</a>'), DATASET_URL);
  assert.equal(sourceOf('https://evil.gov.il.example.com/'), DATASET_URL);
});

const row = (id, k, country, city, kind, extra = {}) => ({
  en: {
    _id: id,
    k_ntz: k,
    shem_mdn_a: country,
    shem_ntz_a: city,
    maamad_a: kind,
    Addrs: '',
    Kabala: '',
    tel: '00-66-2-2049200',
    Atar: '',
    ...extra,
  },
  he: {
    _id: id,
    k_ntz: k,
    shem_mdn: country,
    shem_ntz: city,
    maamad: kind,
    Address: '',
    Kabala: '',
    tel: '',
  },
});

test('rows of one mission become one mission covering every country; the first is the host', () => {
  const rows = [
    row(1, 12, 'Cameroon', 'Yaounde', 'Embassy'),
    row(2, 12, 'Gabon', 'Yaounde', 'Embassy'),
    row(3, 70, 'Switzerland', 'Geneva (UN)', 'Delegation'),
    row(4, 90, 'Armenia', 'Jerusalem', 'Non Resident'),
  ];
  const codes = { Cameroon: 'CMR', Gabon: 'GAB', Switzerland: 'CHE', Armenia: 'ARM' };
  const { missions, without } = buildMissions(
    rows.map((r) => r.en),
    rows.map((r) => r.he),
    (n) => codes[n],
  );
  assert.equal(missions.length, 1, 'the UN delegation is not a consular mission');
  assert.deepEqual(missions[0].covers, ['CMR', 'GAB']);
  assert.equal(missions[0].adm0, 'CMR');
  assert.deepEqual(without, ['ARM'], 'a non-resident row means no mission there');
});

test('the two lists must line up by row', () => {
  const a = row(1, 12, 'Cameroon', 'Yaounde', 'Embassy');
  const b = row(2, 13, 'Gabon', 'Libreville', 'Embassy');
  assert.throws(() => buildMissions([a.en], [b.he], () => 'CMR'));
});

test('the bundled file: every checked row cites a source; no mission only from the list', () => {
  const data = JSON.parse(
    readFileSync(
      new URL('../apps/mobile/src/features/emergency/emergencyData.json', import.meta.url),
      'utf8',
    ),
  );
  for (const c of data.countries) {
    if (c.numbersStatus === 'verified') {
      assert.match(c.sourceUrl, /^https:\/\//, c.adm0);
      assert.match(c.verifiedAt, /^\d{4}-\d{2}-\d{2}$/, c.adm0);
      assert.ok(c.police || c.ambulance || c.fire || c.shared, c.adm0);
    } else {
      assert.equal(
        c.police ?? c.ambulance ?? c.fire ?? c.shared ?? null,
        null,
        `${c.adm0}: no unchecked number`,
      );
    }
    if (c.missionStatus === 'covered') {
      assert.ok(
        data.missions.some((m) => m.covers.includes(c.adm0)),
        `${c.adm0} is covered by a mission`,
      );
    }
  }
  assert.ok(!data.countries.some((c) => c.adm0 === 'ISR'), 'no row for Israel');
  assert.ok(
    data.missions.find((m) => m.covers.includes('THA')),
    'Thailand has a mission',
  );
});
