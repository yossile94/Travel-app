// Sprint 11 F-029 (D22; Raz design approval 8; design 7): a country's places
// read in pages, kept on the device, refreshed weekly or on a new version.
import AsyncStorage from '@react-native-async-storage/async-storage';

import { loadPlaces, PLACES_DATA_VERSION, resetPlacesForTests, retryPlaces } from './placesData';

/** A country of `count` places, most popular first, as the server returns them. */
const mockDb = {
  count: 3,
  ranges: [] as [number, number][],
  curated: [] as unknown[],
  fail: false,
};
const row = (i: number) => ({
  wikidata_id: `Q${1000 + i}`,
  name_he: null,
  name_en: `Place ${i}`,
  lat: 13.75,
  lng: 100.5,
  category: 'culture',
  popularity: 5000 - i,
});
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        range: async (from: number, to: number) => {
          mockDb.ranges.push([from, to]);
          if (mockDb.fail) return { data: null, error: { code: 'PGRST' } };
          const data = [];
          for (let i = from; i <= Math.min(to, mockDb.count - 1); i++) data.push(row(i));
          return { data, error: null };
        },
        then: (resolve: (v: unknown) => void) =>
          resolve(
            table === 'curated_places' && !mockDb.fail
              ? { data: mockDb.curated, error: null }
              : { data: null, error: { code: 'PGRST' } },
          ),
      };
      return query;
    },
  },
}));

const placesOf = async (adm0: string) =>
  JSON.parse((await AsyncStorage.getItem(`places.v1.${adm0}`))!) as {
    version: number;
    savedAt: string;
    wikidata: unknown[];
  };

beforeEach(async () => {
  resetPlacesForTests();
  await AsyncStorage.clear();
  Object.assign(mockDb, { count: 3, ranges: [], curated: [], fail: false });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('placesData (D22)', () => {
  it('reads a big country in pages of 500 until a short page (Germany: 1,085)', async () => {
    mockDb.count = 1085;
    await loadPlaces('DEU');
    expect(mockDb.ranges).toEqual([
      [0, 499],
      [500, 999],
      [1000, 1499],
    ]);
    expect((await placesOf('DEU')).wikidata).toHaveLength(1085);
  });

  it('a fresh copy of this version is not read again; an old one or another version is', async () => {
    const now = Date.parse('2026-10-29T12:00:00Z');
    await loadPlaces('THA', now);
    expect(mockDb.ranges).toHaveLength(1);

    resetPlacesForTests();
    mockDb.ranges = [];
    await loadPlaces('THA', now + 6 * 24 * 3600 * 1000);
    expect(mockDb.ranges).toHaveLength(0);

    resetPlacesForTests();
    await loadPlaces('THA', now + 8 * 24 * 3600 * 1000);
    expect(mockDb.ranges).toHaveLength(1);

    resetPlacesForTests();
    mockDb.ranges = [];
    const stored = await placesOf('THA');
    await AsyncStorage.setItem(
      'places.v1.THA',
      JSON.stringify({ ...stored, version: PLACES_DATA_VERSION - 1 }),
    );
    await loadPlaces('THA', now + 8 * 24 * 3600 * 1000);
    expect(mockDb.ranges).toHaveLength(1);
  });

  it('an empty copy is read again the next session, however new (sprint 12)', async () => {
    const now = Date.parse('2026-10-30T08:00:00Z');
    mockDb.count = 0;
    await loadPlaces('JPN', now);
    expect((await placesOf('JPN')).wikidata).toHaveLength(0);

    resetPlacesForTests();
    mockDb.ranges = [];
    mockDb.count = 736;
    await loadPlaces('JPN', now + 3600 * 1000);
    expect(mockDb.ranges.length).toBeGreaterThan(0);
    expect((await placesOf('JPN')).wikidata).toHaveLength(736);
  });

  it('once a session: a second opening reads nothing', async () => {
    await loadPlaces('THA');
    await loadPlaces('THA');
    expect(mockDb.ranges).toHaveLength(1);
  });

  it('a failed read keeps the device copy; with no copy it fails and a retry reads again', async () => {
    await loadPlaces('THA');
    resetPlacesForTests();
    mockDb.fail = true;
    await loadPlaces('THA', Date.now() + 8 * 24 * 3600 * 1000);
    expect((await placesOf('THA')).wikidata).toHaveLength(3);

    resetPlacesForTests();
    await loadPlaces('GRC');
    mockDb.ranges = [];
    mockDb.fail = false;
    await retryPlaces('GRC');
    expect(mockDb.ranges).toHaveLength(1);
  });
});
