import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook } from '@testing-library/react-native';

import { loadDestination, resetDestination, useDestination } from './destinationData';

/** Each table answers from here; `throws` makes the query itself throw. */
const mockDb = {
  rates: [] as unknown[],
  advisories: [] as unknown[],
  error: null as unknown,
  throws: false,
  reads: 0,
};
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: async () => {
        if (table === 'exchange_rates') mockDb.reads += 1;
        if (mockDb.throws) throw new TypeError('Network request failed');
        return {
          data: table === 'exchange_rates' ? mockDb.rates : mockDb.advisories,
          error: mockDb.error,
        };
      },
    }),
  },
}));

const serverRate = {
  currency: 'EUR',
  rate_to_ils: '4.1',
  rate_to_usd: '0.9',
  source: 'erapi',
  rate_date: '2026-10-26',
  fetched_at: '2026-10-26T14:15:00Z',
};
const deviceRate = {
  currency: 'EUR',
  rateToIls: 3.9,
  rateToUsd: 0.9,
  source: 'erapi',
  rateDate: '2026-10-20',
  fetchedAt: '2026-10-20T14:15:00Z',
};

beforeEach(async () => {
  resetDestination();
  await AsyncStorage.clear();
  Object.assign(mockDb, {
    rates: [serverRate],
    advisories: [],
    error: null,
    throws: false,
    reads: 0,
  });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('destinationData (sprint 4 F-012, F-013)', () => {
  it('shows the device copy first, then the server read', async () => {
    await AsyncStorage.setItem(
      'destination-data-v1',
      JSON.stringify({ rates: [deviceRate], advisories: [] }),
    );
    const seen: (number | undefined)[] = [];
    const { result } = await renderHook(() => {
      const state = useDestination();
      seen.push(state.data?.rates.get('EUR')?.rateToIls);
      return state;
    });
    await act(async () => {
      await loadDestination();
    });
    expect(seen).toContain(3.9);
    expect(result.current.data?.rates.get('EUR')?.rateToIls).toBe(4.1);
    expect(result.current.data?.from).toBe('server');
    // The new values are kept for the next launch.
    const stored = JSON.parse((await AsyncStorage.getItem('destination-data-v1'))!);
    expect(stored.rates[0].rateToIls).toBe(4.1);
  });

  it('reads the server once per session', async () => {
    await loadDestination();
    await loadDestination();
    await renderHook(() => useDestination());
    expect(mockDb.reads).toBe(1);
  });

  it('nothing saved and the read fails: "failed"', async () => {
    mockDb.error = { code: '500' };
    const { result } = await renderHook(() => useDestination());
    await act(async () => {
      await loadDestination();
    });
    expect(result.current).toEqual({ data: null, failed: true });
  });

  it('a saved copy wins over a failed read', async () => {
    await AsyncStorage.setItem(
      'destination-data-v1',
      JSON.stringify({ rates: [deviceRate], advisories: [] }),
    );
    mockDb.error = { code: '500' };
    const { result } = await renderHook(() => useDestination());
    await act(async () => {
      await loadDestination();
    });
    expect(result.current.failed).toBe(false);
    expect(result.current.data?.from).toBe('device');
  });

  it('a query that throws is a failed read, tried again later (Raz, S4-m1)', async () => {
    mockDb.throws = true;
    await expect(loadDestination()).resolves.toBeNull();
    mockDb.throws = false;
    const data = await loadDestination();
    expect(data?.rates.get('EUR')?.rateToIls).toBe(4.1);
    expect(mockDb.reads).toBe(2);
  });
});
