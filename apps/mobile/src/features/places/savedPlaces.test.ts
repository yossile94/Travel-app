// Sprint 11 AC-6, AC-13 (D3, D4; Raz ח2, ח3, ח9): a trip's saved places —
// the read and its encrypted copy, the offline view, a sign-out in the
// middle, and how the RPC answers reach the screen.
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { renderHook, waitFor } from '@testing-library/react-native';

import { setCachedTrips } from '@/features/trips/tripCopies';
import { clearTripsCaches } from '@/features/trips/tripsCache';

import type { Place } from './placesModel';
import { clearSaved, loadSaved, savePlace, unsavePlace, useSaved } from './savedPlaces';

const mockKeys = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => mockKeys.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => void mockKeys.set(k, v)),
  deleteItemAsync: jest.fn(async (k: string) => void mockKeys.delete(k)),
}));
jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) % 256),
  randomUUID: () => '00000000-0000-4000-8000-000000000001',
}));

const mockSelect: { answer: Promise<unknown> | unknown } = { answer: { data: [], error: null } };
const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => {
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'limit']) builder[m] = () => builder;
  builder.then = (resolve: (v: unknown) => void) =>
    void Promise.resolve(mockSelect.answer).then(resolve);
  return {
    supabase: { from: () => builder, rpc: (...args: unknown[]) => mockRpc(...args) },
  };
});

const row = (ref: string, name = 'ארמון המלך') => ({
  place_ref: ref,
  name,
  lat: 13.75,
  lng: 100.49,
  created_at: '2026-10-29T08:00:00Z',
});

const place: Place = {
  ref: 'wd:Q873769',
  nameHe: 'ארמון מלך תאילנד',
  nameEn: 'Grand Palace',
  lat: 13.75014,
  lng: 100.49203,
  category: 'culture',
  popularity: 48,
  curated: null,
} as unknown as Place;

const online = (yes: boolean) =>
  jest.mocked(NetInfo.fetch).mockResolvedValue({ isConnected: yes } as never);
const saved = async (tripId: string) => (await renderHook(() => useSaved(tripId))).result;
const copyKeys = async () =>
  (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith('trips-cache.saved.'));

beforeEach(async () => {
  clearSaved();
  mockKeys.clear();
  await AsyncStorage.clear();
  mockSelect.answer = { data: [row('wd:Q873769')], error: null };
  mockRpc.mockReset();
  online(true);
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('the read and its device copy (AC-13)', () => {
  it('keeps an encrypted copy for a kept trip only', async () => {
    setCachedTrips(['t1']);
    const result = await saved('t1');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current).toMatchObject({ fromCache: false, places: [{ ref: 'wd:Q873769' }] });
    await waitFor(async () => expect(await copyKeys()).toEqual(['trips-cache.saved.t1']));
    expect(await AsyncStorage.getItem('trips-cache.saved.t1')).not.toContain('ארמון');

    const other = await saved('t2');
    await waitFor(() => expect(other.current.status).toBe('ready'));
    expect(await copyKeys()).toEqual(['trips-cache.saved.t1']);
  });

  it('offline: the copy, read only (Raz ח2); no copy says offline', async () => {
    setCachedTrips(['t1']);
    await loadSaved('t1');
    clearSaved();
    online(false);
    const result = await saved('t1');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current).toMatchObject({ fromCache: true, places: [{ name: 'ארמון המלך' }] });

    const none = await saved('t9');
    await waitFor(() => expect(none.current).toEqual({ status: 'failed', offline: true }));
  });

  it('a server error with no copy is a failure that is not offline; logs carry a code only', async () => {
    mockSelect.answer = { data: null, error: { code: 'PGRST301', message: 'ארמון' } };
    const result = await saved('t1');
    await waitFor(() => expect(result.current).toEqual({ status: 'failed', offline: false }));
    expect(JSON.stringify(jest.mocked(console.error).mock.calls)).not.toContain('ארמון');
  });

  it('a sign-out while the read runs: nothing comes back, nothing is written (Raz ח3)', async () => {
    setCachedTrips(['t1']);
    let release!: (v: unknown) => void;
    mockSelect.answer = new Promise((r) => (release = r));
    const result = await saved('t1');
    await new Promise((r) => setTimeout(r, 0));
    await clearTripsCaches();
    clearSaved();
    release({ data: [row('wd:Q1')], error: null });
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.status).toBe('loading');
    expect(await copyKeys()).toEqual([]);
  });
});

describe('save and remove (AC-6)', () => {
  it('saves a snapshot in the app language, then reads the list again', async () => {
    mockRpc.mockResolvedValue({ data: 'ok', error: null });
    expect(await savePlace('t1', place, 'he')).toBe('ok');
    expect(mockRpc).toHaveBeenCalledWith('save_place', {
      p_id: '00000000-0000-4000-8000-000000000001',
      p_trip_id: 't1',
      p_place: { placeRef: 'wd:Q873769', name: 'ארמון מלך תאילנד', lat: 13.75014, lng: 100.49203 },
    });
    expect((mockRpc.mock.calls[0]![1] as { p_place: { name: string } }).p_place.name).not.toBe(
      'Grand Palace',
    );
  });

  it.each([
    [{ data: 'limit', error: null }, 'limit'],
    [{ data: 'gone', error: null }, 'gone'],
    [{ data: null, error: { code: '42501', hint: 'consent_required' } }, 'consent'],
    [{ data: null, error: { code: 'XX000' } }, 'error'],
  ])('save answers %j → %s', async (answer, expected) => {
    mockRpc.mockResolvedValue(answer);
    expect(await savePlace('t1', place, 'en')).toBe(expected);
  });

  it('offline, nothing is sent', async () => {
    online(false);
    expect(await savePlace('t1', place, 'he')).toBe('offline');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('removing what is already gone is fine; the list and its copy are read again', async () => {
    const result = await saved('t1');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    mockRpc.mockResolvedValue({ data: 'gone', error: null });
    mockSelect.answer = { data: [], error: null };
    expect(await unsavePlace('t1', 'wd:Q873769')).toBe('ok');
    await waitFor(() => expect(result.current).toMatchObject({ places: [] }));
  });
});
