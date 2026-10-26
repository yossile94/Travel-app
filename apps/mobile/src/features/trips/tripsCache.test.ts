import AsyncStorage from '@react-native-async-storage/async-storage';

import i18n from '@/i18n';

import {
  cachedWhen,
  clearTripsCaches,
  readTripsCache,
  saveTripsCache,
  type TripsCache,
} from './tripsCache';
import type { Trip } from './tripsApi';

const mockKeys = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => mockKeys.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => void mockKeys.set(k, v)),
  deleteItemAsync: jest.fn(async (k: string) => void mockKeys.delete(k)),
}));
jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) % 256),
}));

const trip = (id: string): Trip => ({
  id,
  countryAdm0: 'THA',
  title: 'תאילנד',
  startDate: '2027-01-05',
  endDate: '2027-01-12',
  notes: 'מלון',
  travelers: [{ name: 'דנה', relation: 'partner' }],
  cities: [{ geonameId: 1609350, name: 'בנגקוק' }],
});

const cache = (userId: string, upcoming = 1, past = 1): TripsCache => ({
  userId,
  savedAt: '2026-10-26T12:32:00Z',
  upcoming: Array.from({ length: upcoming }, (_, i) => trip(`u${i}`)),
  past: Array.from({ length: past }, (_, i) => trip(`p${i}`)),
  countries: ['THA'],
  nextTrip: trip('u0'),
  full: false,
});

beforeEach(async () => {
  mockKeys.clear();
  await AsyncStorage.clear();
});

describe('the offline copy of the trips (sprint 4 F-015)', () => {
  it('is encrypted: storage alone shows no trip data', async () => {
    await saveTripsCache(cache('user-1'));
    const raw = await AsyncStorage.getItem('trips-cache.user-1');
    expect(raw).not.toBeNull();
    expect(raw).not.toContain('דנה');
    expect(raw).not.toContain('THA');
    expect((await readTripsCache('user-1'))?.upcoming[0]?.travelers[0]?.name).toBe('דנה');
  });

  it("is only ever the signed-in user's own (AC-13)", async () => {
    await saveTripsCache(cache('user-1'));
    expect(await readTripsCache('user-2')).toBeNull();
  });

  it('keeps 50 upcoming and 20 past at most (AC-12)', async () => {
    await saveTripsCache(cache('user-1', 60, 30));
    const saved = await readTripsCache('user-1');
    expect(saved?.upcoming).toHaveLength(50);
    expect(saved?.past).toHaveLength(20);
  });

  it('is removed with its key for every user on sign-out (AC-13)', async () => {
    await saveTripsCache(cache('user-1'));
    await saveTripsCache(cache('user-2'));
    await clearTripsCaches();
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
    expect(mockKeys.size).toBe(0);
    expect(await readTripsCache('user-1')).toBeNull();
  });

  it('says when it was saved: today, yesterday or the date (design 10.2)', () => {
    const t = i18n.getFixedT('he');
    const isolates = new RegExp(
      `[${String.fromCodePoint(0x2066)}${String.fromCodePoint(0x2069)}]`,
      'g',
    );
    const strip = (s: string) => s.replace(isolates, '');
    const saved = new Date(2026, 9, 26, 14, 32).toISOString();
    expect(strip(cachedWhen(saved, t, new Date(2026, 9, 26, 20, 0)))).toBe('היום, 14:32');
    expect(strip(cachedWhen(saved, t, new Date(2026, 9, 27, 9, 0)))).toBe('אתמול, 14:32');
    expect(strip(cachedWhen(saved, t, new Date(2026, 9, 29, 9, 0)))).toBe('26.10.2026');
  });
});
