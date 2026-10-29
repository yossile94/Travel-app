// Sprint 11 AC-12, AC-13 (D2, D3; Raz ח3, ח9): the board's data access — the
// read and its encrypted copy, the offline view, a sign-out in the middle,
// and how each RPC answer reaches the screen.
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { renderHook, waitFor } from '@testing-library/react-native';

import { setCachedTrips } from '@/features/trips/tripCopies';
import { clearTripsCaches } from '@/features/trips/tripsCache';

import {
  applyPlan,
  clearBoards,
  deleteItem,
  loadBoard,
  moveItem,
  saveItem,
  useBoard,
} from './itineraryStore';

const mockKeys = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => mockKeys.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => void mockKeys.set(k, v)),
  deleteItemAsync: jest.fn(async (k: string) => void mockKeys.delete(k)),
}));
jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) % 256),
}));

/** What the next select answers; a promise holds it back until the test lets go. */
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

const row = (id: string, title = 'מקדש') => ({
  id,
  trip_id: 't1',
  day_date: '2027-01-10',
  time_of_day: '09:30:00',
  title,
  note: 'הערה פרטית',
  place_ref: null,
  place_name: null,
  lat: null,
  lng: null,
  source: 'manual',
  sort_order: 1024,
});

const online = (yes: boolean) =>
  jest.mocked(NetInfo.fetch).mockResolvedValue({ isConnected: yes } as never);

const board = async (tripId: string) => (await renderHook(() => useBoard(tripId))).result;

beforeEach(async () => {
  clearBoards();
  mockKeys.clear();
  await AsyncStorage.clear();
  mockSelect.answer = { data: [row('a')], error: null };
  mockRpc.mockReset();
  online(true);
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

const copyKeys = async () =>
  (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith('trips-cache.itinerary.'));

describe('the read and its device copy', () => {
  it('reads the items in order and keeps an encrypted copy for a kept trip only', async () => {
    setCachedTrips(['t1']);
    const result = await board('t1');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current).toMatchObject({ fromCache: false, items: [{ id: 'a', time: '09:30' }] });
    await waitFor(async () => expect(await copyKeys()).toEqual(['trips-cache.itinerary.t1']));
    const raw = await AsyncStorage.getItem('trips-cache.itinerary.t1');
    expect(raw).not.toContain('הערה פרטית');

    const other = await board('t2');
    await waitFor(() => expect(other.current.status).toBe('ready'));
    expect(await copyKeys()).toEqual(['trips-cache.itinerary.t1']);
  });

  it('offline: the device copy, read only; no copy says offline', async () => {
    setCachedTrips(['t1']);
    await loadBoard('t1');
    clearBoards();
    setCachedTrips(['t1']);
    online(false);
    const result = await board('t1');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current).toMatchObject({ fromCache: true, items: [{ id: 'a' }] });

    const none = await board('t9');
    await waitFor(() => expect(none.current).toEqual({ status: 'failed', offline: true }));
  });

  it('a server error falls back to the copy, else a failure that is not offline', async () => {
    mockSelect.answer = { data: null, error: { code: 'PGRST301', message: 'מקדש' } };
    const result = await board('t1');
    await waitFor(() => expect(result.current).toEqual({ status: 'failed', offline: false }));
    expect(JSON.stringify(jest.mocked(console.error).mock.calls)).not.toContain('מקדש');
  });

  it('a sign-out while the read runs: nothing comes back, nothing is written (Raz ח3)', async () => {
    setCachedTrips(['t1']);
    let release!: (v: unknown) => void;
    mockSelect.answer = new Promise((r) => (release = r));
    const result = await board('t1');
    await new Promise((r) => setTimeout(r, 0));
    await clearTripsCaches();
    clearBoards();
    release({ data: [row('a')], error: null });
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.status).toBe('loading');
    expect(await copyKeys()).toEqual([]);
  });
});

describe('the writes (RPC answers → the screen)', () => {
  const item = {
    day: '2027-01-10',
    time: null,
    title: 'מקדש',
    note: null,
    placeRef: null,
    placeName: null,
    lat: null,
    lng: null,
  };

  it.each([
    [{ data: 'ok', error: null }, 'ok'],
    [{ data: 'limit', error: null }, 'limit'],
    [{ data: 'day', error: null }, 'day'],
    [{ data: 'gone', error: null }, 'gone'],
    [{ data: 'weird', error: null }, 'error'],
    [{ data: null, error: { code: '42501', hint: 'consent_required' } }, 'consent'],
    [{ data: null, error: { code: '23505' } }, 'error'],
  ])('save answers %j → %s', async (answer, expected) => {
    mockRpc.mockResolvedValue(answer);
    expect(await saveItem('t1', 'i1', item)).toBe(expected);
  });

  it('sends the item as the RPC reads it: empty strings for no time, note or place', async () => {
    mockRpc.mockResolvedValue({ data: 'ok', error: null });
    await saveItem('t1', 'i1', item);
    expect(mockRpc).toHaveBeenCalledWith('save_itinerary_item', {
      p_id: 'i1',
      p_trip_id: 't1',
      p_item: { ...item, time: '', note: '', placeRef: '', placeName: '' },
    });
  });

  it('offline, nothing is sent', async () => {
    online(false);
    expect(await moveItem('t1', 'i1', '2027-01-11', 0)).toBe('offline');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('no answer in 15 s counts as offline', async () => {
    jest.useFakeTimers();
    mockRpc.mockReturnValue(new Promise(() => {}));
    const pending = deleteItem('t1', 'i1');
    await jest.advanceTimersByTimeAsync(15_000);
    await expect(pending).resolves.toBe('offline');
    jest.useRealTimers();
  });

  it('deleting what is already gone is fine', async () => {
    mockRpc.mockResolvedValue({ data: 'gone', error: null });
    expect(await deleteItem('t1', 'i1')).toBe('ok');
  });

  it('the auto plan: the items as given; ok with what was skipped, or the limit', async () => {
    const planned = [
      {
        id: 'p1',
        day: '2027-01-11',
        time: '09:30',
        title: 'שוק',
        placeRef: 'wd:Q1',
        placeName: 'שוק',
        lat: 13.7,
        lng: 100.5,
        order: 0,
      },
    ];
    mockRpc.mockResolvedValue({
      data: {
        result: 'ok',
        inserted: 1,
        skipped: [{ date: '2027-01-12', reason: 'filled_meanwhile' }],
      },
      error: null,
    });
    expect(await applyPlan('t1', planned)).toEqual({
      result: 'ok',
      inserted: 1,
      skipped: [{ date: '2027-01-12', reason: 'filled_meanwhile' }],
    });
    expect(mockRpc).toHaveBeenCalledWith('apply_auto_plan', { p_trip_id: 't1', p_items: planned });

    mockRpc.mockResolvedValue({ data: { result: 'limit' }, error: null });
    expect(await applyPlan('t1', planned)).toEqual({ result: 'limit' });
  });
});
