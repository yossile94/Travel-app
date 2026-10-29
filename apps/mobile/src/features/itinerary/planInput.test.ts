// Sprint 11 F-031 (scope ח2, ח3; D23): the planner's input from the device.
import type { Place } from '@/features/places/placesModel';

import { itineraryDays } from './itineraryModel';
import { nightPointFor, planInput, plannerPlaces } from './planInput';
import { planTrip } from './planner';

const BKK: [number, number] = [100.5, 13.75];
const CNX: [number, number] = [98.98, 18.79];
const pointOf = (id: number) => ({ 1: BKK, 2: CNX })[id] ?? null;
const trip = {
  id: 't',
  countryAdm0: 'THA',
  title: 'תאילנד',
  startDate: '2027-01-01',
  endDate: '2027-01-04',
  notes: null,
  travelers: [],
  cities: [
    { geonameId: 1, name: 'בנגקוק' },
    { geonameId: 2, name: "צ'אנג מאי" },
  ],
};
const place = (ref: string, at: [number, number], over: Partial<Place> = {}): Place => ({
  ref,
  nameHe: null,
  nameEn: ref,
  lat: at[1],
  lng: at[0],
  category: 'culture',
  popularity: 10,
  ...over,
});

describe("the night's point (ח3)", () => {
  it('a hotel with a point covering the night wins; else the night city; else unknown', () => {
    const hotel = {
      checkIn: '2027-01-01',
      checkOut: '2027-01-02',
      point: [100.6, 13.8] as [number, number],
    };
    const night = nightPointFor(trip, [hotel], pointOf);
    expect(night('2027-01-01')?.point).toEqual([100.6, 13.8]);
    expect(night('2027-01-04')?.point).toEqual(CNX);
    expect(nightPointFor({ ...trip, cities: [] }, [], pointOf)('2027-01-02')).toBeNull();
  });
});

describe('places for the planner (AC-20)', () => {
  it("curated first; kosher, chabad and memorial places aren't planned", () => {
    const list = plannerPlaces(
      [
        place('wd:Q1', BKK),
        place('cu:1', BKK, {
          category: 'chabad',
          curated: {
            body: null,
            sourceUrl: 'https://x',
            verifiedAt: '2026-10-01',
            wikidataQid: null,
          },
        }),
        place('cu:2', BKK, {
          category: 'food',
          curated: {
            body: null,
            sourceUrl: 'https://x',
            verifiedAt: '2026-10-01',
            wikidataQid: null,
          },
        }),
      ],
      'he',
    );
    expect(list.map((p) => p.ref)).toEqual(['wd:Q1', 'cu:2']);
    expect(list[1]!.popularity).toBeGreaterThan(list[0]!.popularity);
  });
});

describe('the whole input (D1, D23)', () => {
  it('fills each night near its own city; a hot month is tropical', () => {
    const board = itineraryDays({
      trip,
      anchors: { arrival: null, departure: null },
      items: [],
      today: '2026-12-01',
    });
    const input = planInput({
      trip,
      board,
      anchors: { arrival: null, departure: null },
      hotels: [],
      places: [place('wd:Q1', BKK), place('wd:Q2', CNX)],
      today: '2026-12-01',
      pointOf,
      normals: Array.from({ length: 12 }, () => 2700),
      pace: 'calm',
      language: 'he',
      airportTitle: 'יציאה לשדה התעופה',
      newId: (i) => `id-${i}`,
    });
    expect(input.tropical('2027-01-02')).toBe(true);
    const plan = planTrip(input);
    expect(plan.items.find((i) => i.day === '2027-01-01')?.placeRef).toBe('wd:Q1');
    expect(plan.items.find((i) => i.day === '2027-01-03')?.placeRef).toBe('wd:Q2');
    expect(plan.days.find((d) => d.day === '2027-01-02')?.kind).toBe('placesUsed');
  });
});
