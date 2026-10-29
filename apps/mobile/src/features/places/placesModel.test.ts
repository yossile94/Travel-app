// Sprint 11 F-029 (design 3 – 7, AC-3 – AC-6; Raz 29.10): "What to see",
// table by table.
import type { CityEntry } from '@/features/trips/citySearch';
import type { Trip } from '@/features/trips/tripsApi';

import {
  byCategory,
  cityPickerOptions,
  contextTrip,
  distanceKm,
  formatDistance,
  mergeCurated,
  placesInCity,
  placesNear,
  shouldAskCity,
  type Place,
} from './placesModel';

const bangkok: [number, number] = [100.5018, 13.7563];
const place = (
  ref: string,
  popularity: number,
  [lng, lat]: [number, number],
  over: Partial<Place> = {},
): Place => ({
  ref,
  nameHe: null,
  nameEn: `Place ${ref}`,
  lat,
  lng,
  category: 'culture',
  popularity,
  ...over,
});
const city = (id: number, nameHe: string, population: number): CityEntry => ({
  id,
  nameHe,
  nameEn: nameHe,
  ascii: nameHe,
  population,
});
const cities = [
  city(1609350, 'בנגקוק', 5_000_000),
  city(1153671, "צ'אנג מאי", 200_000),
  city(1151254, 'פוקט', 90_000),
  city(1150515, 'פטאיה', 80_000),
  city(1605245, 'אודון', 70_000),
  city(1607779, 'קרבי', 30_000),
];
const trip = (over: Partial<Trip> = {}): Trip => ({
  id: 't1',
  countryAdm0: 'THA',
  title: 'תאילנד בדצמבר',
  startDate: '2026-12-20',
  endDate: '2027-01-03',
  notes: null,
  travelers: [],
  cities: [],
  ...over,
});

describe('distance and its words (design 4)', () => {
  it('measures a great circle', () => {
    expect(distanceKm([34.78, 32.08], [35.21, 31.77])).toBeCloseTo(54, -1); // Tel Aviv – Jerusalem
  });
  it.each([
    [0.012, { value: '50', unit: 'm' }],
    [0.849, { value: '850', unit: 'm' }],
    [1.24, { value: '1.2', unit: 'km' }],
    [9.96, { value: '10.0', unit: 'km' }],
    [14.4, { value: '14', unit: 'km' }],
  ] as const)('%d km → %j', (km, expected) => {
    expect(formatDistance(km)).toEqual(expected);
  });
});

describe('the list (AC-3, AC-4, AC-20)', () => {
  const temple = place('wd:Q1', 90, bangkok);
  const far = place('wd:Q2', 99, [98.98, 18.79]); // Chiang Mai
  const chabad = place('cu:0f0e0d0c-0000-4000-8000-000000000001', 0, bangkok, {
    nameHe: 'בית חב"ד',
    category: 'chabad',
    curated: {
      body: null,
      sourceUrl: 'https://x.org',
      verifiedAt: '2026-10-12',
      wikidataQid: null,
    },
  });
  const twin = place('cu:0f0e0d0c-0000-4000-8000-000000000002', 0, bangkok, {
    nameHe: 'ארמון',
    curated: {
      body: null,
      sourceUrl: 'https://x.org',
      verifiedAt: '2026-10-12',
      wikidataQid: 'Q1',
    },
  });

  it('curated first, then by popularity; a Wikidata twin of a curated place is hidden', () => {
    const list = mergeCurated([temple, far], [chabad, twin]);
    expect(list.map((p) => p.ref)).toEqual([twin.ref, chabad.ref, far.ref]);
  });

  it('a city: within 15 km of its centre, in the list order, with the distance', () => {
    const shown = placesInCity(mergeCurated([temple, far], [chabad]), bangkok);
    expect(shown.map((s) => s.place.ref)).toEqual([chabad.ref, temple.ref]);
    expect(shown[1]!.km).toBeCloseTo(0, 3);
  });

  it('"בכל המדינה": the whole list, no distance', () => {
    const shown = placesInCity([temple, far], null);
    expect(shown.map((s) => s.km)).toEqual([null, null]);
  });

  it('near the hotel: in the radius, curated first, then the nearest', () => {
    const near = place('wd:Q3', 1, [100.505, 13.7563]);
    const shown = placesNear([temple, near, far, chabad], [100.5051, 13.7563], 3);
    expect(shown.map((s) => s.place.ref)).toEqual([chabad.ref, near.ref, temple.ref]);
  });

  it('a category chip filters; "all" keeps the curated special categories', () => {
    const shown = placesInCity([temple, chabad], bangkok);
    expect(byCategory(shown, 'culture').map((s) => s.place.ref)).toEqual([temple.ref]);
    expect(byCategory(shown, 'all')).toHaveLength(2);
  });
});

describe('the trip the country screen is tied to (Raz, 29.10)', () => {
  const today = '2026-12-25';
  it('the active trip that started last', () => {
    const a = trip({ id: 'a', startDate: '2026-12-20' });
    const b = trip({ id: 'b', startDate: '2026-12-24' });
    expect(contextTrip([a, b], 'THA', today)?.id).toBe('b');
  });
  it('none active: the next by start date; ties by id; past and other countries ignored', () => {
    const past = trip({ id: 'p', startDate: '2026-01-01', endDate: '2026-01-10' });
    const later = trip({ id: 'z', startDate: '2027-03-01', endDate: '2027-03-10' });
    const sooner = trip({ id: 'y', startDate: '2027-02-01', endDate: '2027-02-10' });
    const tie = trip({ id: 'x', startDate: '2027-02-01', endDate: '2027-02-05' });
    const greece = trip({ id: 'g', countryAdm0: 'GRC', startDate: '2026-12-26' });
    expect(contextTrip([past, later, sooner, tie, greece], 'THA', today)?.id).toBe('x');
  });
  it('a trip starting today is active', () => {
    expect(contextTrip([trip({ startDate: today })], 'THA', today)?.id).toBe('t1');
  });
  it('no trip here: none', () => {
    expect(contextTrip([], 'THA', today)).toBeNull();
  });
});

describe('the city picker (design 3.7.1, AC-4)', () => {
  const keys = (r: ReturnType<typeof cityPickerOptions>) => r!.options.map((o) => o.key);

  it('no trip: the 5 largest, "other", then the whole country last; the largest picked', () => {
    const r = cityPickerOptions({ trip: null, cities, nightCityId: null, searched: null });
    expect(keys(r)).toEqual([
      'city:1609350',
      'city:1153671',
      'city:1151254',
      'city:1150515',
      'city:1605245',
      'other',
      'country',
    ]);
    expect(r!.defaultKey).toBe('city:1609350');
    expect(r!.noTripCity).toBe(false);
  });

  it('a trip: its cities in order, each once, typed ones kept; its first city picked', () => {
    const r = cityPickerOptions({
      trip: trip({
        cities: [
          { geonameId: 1607779, name: 'קרבי' },
          { geonameId: null, name: 'קוסמוי' },
          { geonameId: 1609350, name: 'בנגקוק' },
          { geonameId: 1607779, name: 'קרבי' },
        ],
      }),
      cities,
      nightCityId: null,
      searched: null,
    });
    expect(keys(r)).toEqual(['city:1607779', 'typed:קוסמוי', 'city:1609350', 'other', 'country']);
    expect(r!.defaultKey).toBe('city:1607779');
  });

  it("an active trip: tonight's city", () => {
    const r = cityPickerOptions({
      trip: trip({
        cities: [
          { geonameId: 1607779, name: 'קרבי' },
          { geonameId: 1609350, name: 'בנגקוק' },
        ],
      }),
      cities,
      nightCityId: 1609350,
      searched: null,
    });
    expect(r!.defaultKey).toBe('city:1609350');
  });

  it('a trip without listed cities: like no trip, with the help line (Raz)', () => {
    const r = cityPickerOptions({ trip: trip(), cities, nightCityId: null, searched: null });
    expect(r!.options[0]).toMatchObject({ key: 'city:1609350', from: 'largest' });
    expect(r!.noTripCity).toBe(true);
  });

  it('a searched city goes before "other", once, and is picked; one already there is just picked', () => {
    const krabi = cities[5]!;
    const r = cityPickerOptions({ trip: null, cities, nightCityId: null, searched: krabi });
    expect(keys(r).slice(-3)).toEqual(['city:1607779', 'other', 'country']);
    expect(r!.defaultKey).toBe('city:1607779');
    const again = cityPickerOptions({
      trip: null,
      cities,
      nightCityId: null,
      searched: cities[0]!,
    });
    expect(keys(again).filter((k) => k === 'city:1609350')).toHaveLength(1);
  });

  it('a country with no bundled cities: no picker', () => {
    expect(
      cityPickerOptions({ trip: null, cities: [], nightCityId: null, searched: null }),
    ).toBeNull();
  });
});

describe('the trip form question (design 2.5, D19)', () => {
  it.each([
    ['create', [], false, true, true],
    ['duplicate', [{ geonameId: null }], false, true, true],
    ['create', [{ geonameId: 1609350 }], false, true, false],
    ['edit', [], false, true, false],
    ['create', [], true, true, false],
    ['create', [], false, false, false],
  ] as const)('%s, cities %j, asked %s, online %s → %s', (kind, list, asked, online, expected) => {
    expect(shouldAskCity(kind, list, asked, online)).toBe(expected);
  });
});
