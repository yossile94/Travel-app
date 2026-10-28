// Sprint 9 F-023 (spec 5.12): the rules on the real bundled data — the
// climate normals, the cities and the globe's areas — with a small set of
// advisories, so each acceptance criterion is checked as written.
import { parseClimate } from '@/features/climate/climateData';
import rawMeta from '@/features/globe/countryMeta.json';
import type { CityRow } from '@/features/trips/citySearch';

import {
  discover,
  flightHours,
  NO_FILTERS,
  shownTemp,
  weatherOf,
  type ClimatePoint,
  type DiscoverCountry,
  evaluate,
  type DiscoverFilters,
  type DiscoverInput,
} from './discover';
import type { Advisory } from '@/features/destination/destinationData';

import { BARRED } from './barred';
import { LANDLOCKED } from './landlocked';

declare const __dirname: string;
const { readFileSync } = jest.requireActual<{
  readFileSync(path: string, encoding: 'utf8'): string;
}>('fs');
const dataDir = `${__dirname}/../../../assets/data`;
const climate = parseClimate(readFileSync(`${dataDir}/climate.dat`, 'utf8'));
const cityAreas = JSON.parse(readFileSync(`${dataDir}/cities.dat`, 'utf8')).areas as Record<
  string,
  CityRow[]
>;
const meta = rawMeta as unknown as Record<string, { label: [number, number] }>;
const countries: DiscoverCountry[] = Object.entries(meta).map(([adm0, c]) => ({
  adm0,
  label: c.label,
}));

function pointsOf(adm0: string): ClimatePoint[] {
  const area = climate.area(adm0);
  if (!area) return [];
  const points: ClimatePoint[] = [{ temps: area.normals, wet: climate.areaWet(adm0), city: null }];
  for (const [id, nameHe, nameEn, , population] of cityAreas[adm0] ?? []) {
    const temps = climate.city(id);
    if (temps)
      points.push({ temps, wet: climate.cityWet(id), city: { id, nameHe, nameEn, population } });
  }
  return points;
}

type Row = Pick<Advisory, 'entryStatus' | 'nscLevels'>;
const allowed = (levels: number[]): Row => ({ entryStatus: 'allowed', nscLevels: levels });
const advisories = new Map<string, Row>([
  ['GRC', allowed([1])],
  ['CYP', allowed([1])],
  ['ITA', allowed([1])],
  ['THA', allowed([2])],
  ['ESP', allowed([1])],
  ['TUR', allowed([3])],
  ['EGY', allowed([1, 4])],
  ['ARE', { entryStatus: 'restricted' as const, nscLevels: [1] }],
  ['MYS', { entryStatus: 'banned' as const, nscLevels: [] }],
  ['FIN', allowed([1])],
  ['PRT', { entryStatus: null, nscLevels: [1] }],
]);
const input: DiscoverInput = {
  countries,
  advisories,
  pointsOf,
  landlocked: LANDLOCKED,
  banned: BARRED,
};
const run = (f: Partial<DiscoverFilters>) =>
  discover(input, { ...NO_FILTERS, ...f }).map((r) => r.adm0);

describe('discovery rules (sprint 9 AC-1 to AC-9)', () => {
  it('weather bands are half-open on the shown degrees: each value has one (AC-3, Raz 3)', () => {
    expect([24, 23, 16, 15, 1, 0, -5].map(weatherOf)).toEqual([
      'hot',
      'mild',
      'mild',
      'cool',
      'cool',
      'winter',
      'winter',
    ]);
    // 23.5 shows as 24, so it is hot; 0.4 shows as 0, so it is winter.
    expect(weatherOf(shownTemp(2350))).toBe('hot');
    expect(weatherOf(shownTemp(40))).toBe('winter');
  });

  it('flight hours: km ÷ 800 + 0.5, to the half hour (AC-4)', () => {
    expect(flightHours(0)).toBe(0.5);
    expect(flightHours(2000)).toBe(3);
    expect(flightHours(7000)).toBe(9.5);
  });

  it('December and hot and sunny: Thailand yes, Greece no', () => {
    const hits = run({ month: 11, weatherOn: true, weather: 'hot' });
    expect(hits).toContain('THA');
    expect(hits).not.toContain('GRC');
  });

  it('hot and sunny needs a coast: no landlocked country', () => {
    const hits = run({ month: 6, weatherOn: true, weather: 'hot' });
    expect(hits.filter((a) => LANDLOCKED.has(a))).toEqual([]);
  });

  it('near Israel: Cyprus and Greece yes, Thailand no', () => {
    const hits = run({ near: true });
    expect(hits).toEqual(expect.arrayContaining(['CYP', 'GRC']));
    expect(hits).not.toContain('THA');
  });

  it('January and winter: Finland', () => {
    expect(run({ month: 0, weatherOn: true, weather: 'winter' })).toContain('FIN');
  });

  it('family: no level 3 or 4 anywhere, entry allowed only (AC-2)', () => {
    // May: the family rule always uses the picker's month (Raz 1).
    const hits = run({ family: true, month: 4 });
    expect(hits).toEqual(expect.arrayContaining(['GRC', 'CYP', 'THA']));
    // January: Greece and Finland are under 12°.
    expect(run({ family: true, month: 0 })).not.toEqual(expect.arrayContaining(['GRC']));
    expect(hits).not.toEqual(expect.arrayContaining(['TUR']));
    expect(hits).not.toContain('EGY');
    expect(hits).not.toContain('ARE');
    // No advisory published: not included.
    expect(hits).not.toContain('FRA');
    // Entry not filled in yet: included, with "check entry" (until the sprint 10 admin).
    expect(hits).toContain('PRT');
    expect(
      evaluate(input, { adm0: 'PRT', label: [-8, 39.6] }, { ...NO_FILTERS, family: true }).reasons
        .entry,
    ).toBe('check');
  });

  it('explains the first failing rule, on the country own point (Raz, design 9)', () => {
    const f = { ...NO_FILTERS, month: 11, weatherOn: true, weather: 'hot' as const };
    const grc = countries.find((c) => c.adm0 === 'GRC')!;
    expect(evaluate(input, grc, f)).toMatchObject({ match: false, failure: 'tooCold' });
    const tur = countries.find((c) => c.adm0 === 'TUR')!;
    expect(evaluate(input, tur, { ...NO_FILTERS, family: true }).failure).toBe('nscHigh');
    const ira = countries.find((c) => c.adm0 === 'IRN')!;
    expect(evaluate(input, ira, { ...NO_FILTERS, near: true }).failure).toBe('barred');
  });

  it('the weather chip with no type filters nothing but still gives the temperature (Raz 2)', () => {
    expect(discover(input, { ...NO_FILTERS, weatherOn: true, month: 6 })).toEqual([]);
    const near = discover(input, { ...NO_FILTERS, near: true, weatherOn: true, month: 6 });
    expect(near.find((r) => r.adm0 === 'CYP')?.reasons.temp).toBeGreaterThan(20);
  });

  it('a copy with no entry value never lets a barred country through (AC-9, device QA)', () => {
    const blank = new Map<string, Row>([
      ['SAU', { entryStatus: null, nscLevels: [3] }],
      ['YEM', { entryStatus: null, nscLevels: [4] }],
    ]);
    const hits = discover(
      { ...input, advisories: blank },
      { ...NO_FILTERS, month: 11, weatherOn: true, weather: 'hot' },
    ).map((r) => r.adm0);
    expect(hits).not.toContain('SAU');
    expect(hits).not.toContain('YEM');
  });

  it('ties sort by code, so the order is stable (Raz 13)', () => {
    const a = discover(input, { ...NO_FILTERS, near: true }).map((r) => r.adm0);
    const b = discover(
      { ...input, countries: [...countries].reverse() },
      { ...NO_FILTERS, near: true },
    ).map((r) => r.adm0);
    expect(b).toEqual(a);
  });

  it('family and July: over 30° everywhere is out; the matching temperature is the reason', () => {
    const res = discover(input, { ...NO_FILTERS, family: true, month: 6 });
    const tha = res.find((r) => r.adm0 === 'THA');
    expect(tha?.reasons.temp).toBeLessThanOrEqual(30);
    expect(tha?.reasons).toMatchObject({ nsc: 2, entry: 'allowed' });
  });

  it('never Israel, never a banned country, nearest first (AC-6, AC-9)', () => {
    const res = discover(input, { ...NO_FILTERS, near: true });
    expect(res.map((r) => r.adm0)).not.toContain('ISR');
    expect(run({ month: 11, weatherOn: true, weather: 'hot' })).not.toContain('MYS');
    const kms = res.map((r) => r.km);
    expect(kms).toEqual([...kms].sort((a, b) => a - b));
  });

  it('a big country matches through its cities, and lists them (spec 5.12)', () => {
    const ind = discover(input, { ...NO_FILTERS, month: 0, weatherOn: true, weather: 'hot' }).find(
      (r) => r.adm0 === 'IND',
    );
    expect(ind?.cities.map((c) => c.nameEn)).toContain('Mumbai');
    expect(ind!.cities.length).toBeLessThanOrEqual(3);
    expect(ind!.reasons.tempCity?.nameEn).toBeTruthy();
  });

  it('no filter: no results', () => {
    expect(discover(input, NO_FILTERS)).toEqual([]);
  });

  it('runs on all areas well within the budget (AC-11)', () => {
    const start = Date.now();
    discover(input, { ...NO_FILTERS, month: 6, weatherOn: true, weather: 'mild' });
    expect(Date.now() - start).toBeLessThan(2000);
  });
});

describe('bundled fact lists (Raz D3, 5)', () => {
  it('every landlocked and barred code is a globe area, so a renamed code fails loudly', () => {
    const areas = new Set(countries.map((c) => c.adm0));
    expect([...LANDLOCKED, ...BARRED].filter((a) => !areas.has(a))).toEqual([]);
  });

  it('the landlocked list holds the known cases', () => {
    for (const a of ['AUT', 'CHE', 'KAZ', 'AZE', 'BOL', 'PRY', 'LAO', 'ETH']) {
      expect(LANDLOCKED.has(a)).toBe(true);
    }
    for (const a of ['THA', 'GRC', 'PER', 'JOR']) expect(LANDLOCKED.has(a)).toBe(false);
  });
});
