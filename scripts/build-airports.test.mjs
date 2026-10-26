import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildAirports, parseCsv, shortName } from './build-airports.mjs';

const header =
  'id,ident,type,name,latitude_deg,longitude_deg,elevation_ft,continent,iso_country,iso_region,municipality,scheduled_service,icao_code,iata_code,gps_code,local_code,home_link,wikipedia_link,keywords';
const row = (type, name, country, city, sched, icao, iata) =>
  `1,${icao},${type},"${name}",0,0,0,EU,${country},X,"${city}",${sched},${icao},${iata},,,,,`;

test('CSV: quotes, doubled quotes and commas inside quotes', () => {
  assert.deepEqual(parseCsv('a,"b,c","d ""e"""\r\n1,2,3\n'), [
    ['a', 'b,c', 'd "e"'],
    ['1', '2', '3'],
  ]);
});

test('short names drop "International" and "Airport"', () => {
  assert.equal(shortName('Suvarnabhumi Airport'), 'Suvarnabhumi');
  assert.equal(shortName('Larnaca International Airport'), 'Larnaca');
});

test('keeps scheduled IATA airports with a time zone; Israel is on Israel time with fixed names', () => {
  const csv = parseCsv(
    [
      header,
      row(
        'large_airport',
        'Ben Gurion International Airport',
        'IL',
        'Tel Aviv',
        'yes',
        'LLBG',
        'TLV',
      ),
      row('large_airport', 'Ramon International Airport', 'IL', 'Eilat', 'yes', 'LLER', 'ETM'),
      row(
        'large_airport',
        'Athens Eleftherios Venizelos International Airport',
        'GR',
        'Spata',
        'yes',
        'LGAV',
        'ATH',
      ),
      row('small_airport', 'Strip', 'GR', 'Nowhere', 'no', 'LGXX', 'XXX'),
      row('heliport', 'Pad', 'GR', 'Athens', 'yes', 'LGHP', 'HHH'),
      row('medium_airport', 'No Zone', 'GR', 'Athens', 'yes', 'LGNZ', 'NZZ'),
    ].join('\n'),
  );
  const mwgg = {
    LLBG: { icao: 'LLBG', iata: 'TLV', tz: 'Asia/Jerusalem' },
    LLER: { icao: 'LLER', iata: 'ETM', tz: 'Asia/Amman' },
    LGAV: { icao: 'LGAV', iata: 'ATH', tz: 'Europe/Athens', city: 'Spata' },
  };
  const rows = buildAirports(
    csv,
    mwgg,
    new Map([
      ['IL', 'ISR'],
      ['GR', 'GRC'],
    ]),
    { GRC: [[264371, 'אתונה', 'Athens', '', 664046]] },
  );
  assert.deepEqual(
    rows.map((r) => [r[0], r[3], r[4], r[8]]),
    [
      ['ATH', 'Europe/Athens', 'אתונה', ''],
      ['ETM', 'Asia/Jerusalem', 'אילת', 'רמון'],
      ['TLV', 'Asia/Jerusalem', 'תל אביב', 'נתב"ג'],
    ],
  );
});
