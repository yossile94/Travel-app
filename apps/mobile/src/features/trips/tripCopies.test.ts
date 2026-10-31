// Sprint 13 AC-8 (Dana, sprint 11): a trip that leaves the kept six loses its
// encrypted board and saved-places copies; the kept ones and other caches stay.
import AsyncStorage from '@react-native-async-storage/async-storage';

import { readTripCopy, setCachedTrips, writeTripCopy } from './tripCopies';
import { tripsCacheGeneration } from './tripsCache';

const mockKeys = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => mockKeys.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => void mockKeys.set(k, v)),
  deleteItemAsync: jest.fn(async (k: string) => void mockKeys.delete(k)),
}));
jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) % 256),
}));

beforeEach(async () => {
  mockKeys.clear();
  await AsyncStorage.clear();
});

it('removes the copies of a trip that is no longer kept, and keeps the rest', async () => {
  await setCachedTrips(['t1', 't2']);
  const g = tripsCacheGeneration();
  await writeTripCopy('itinerary', 't1', { items: [1] }, g);
  await writeTripCopy('saved', 't1', { places: [1] }, g);
  await writeTripCopy('itinerary', 't2', { items: [2] }, g);
  await AsyncStorage.setItem('trips-cache.kit.user-1', 'other');

  await setCachedTrips(['t2', 't3']);

  expect(await readTripCopy('itinerary', 't1')).toBeNull();
  expect(await readTripCopy('saved', 't1')).toBeNull();
  expect(await AsyncStorage.getItem('trips-cache.itinerary.t1')).toBeNull();
  expect(await readTripCopy('itinerary', 't2')).toEqual({ items: [2] });
  expect(await AsyncStorage.getItem('trips-cache.kit.user-1')).toBe('other');
});

it('a trip beyond the first six loses its copy too', async () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  await setCachedTrips(['g']);
  await writeTripCopy('itinerary', 'g', { items: [] }, tripsCacheGeneration());
  await setCachedTrips(ids);
  expect(await readTripCopy('itinerary', 'g')).toBeNull();
});

it('Raz 7: a copy written while its trip left the kept ones is removed', async () => {
  await setCachedTrips(['t1']);
  const g = tripsCacheGeneration();
  const writing = writeTripCopy('itinerary', 't1', { items: [1] }, g);
  void setCachedTrips(['t2']);
  await writing;
  expect(await AsyncStorage.getItem('trips-cache.itinerary.t1')).toBeNull();
});
