import NetInfo from '@react-native-community/netinfo';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { TripsProvider, useTrips } from './TripsProvider';

const mockAuth = {
  state: { status: 'signedIn', user: { id: 'user-1' } } as Record<string, unknown>,
};
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => mockAuth }));

/** Each call waits for its own answer, so the test decides the order. */
const mockAnswers: ((value: unknown) => void)[] = [];
jest.mock('./tripsApi', () => ({
  loadTripCountries: jest.fn(() => new Promise((resolve) => mockAnswers.push(resolve))),
  loadTripPage: jest.fn(async () => mockNext),
}));
/** The offline copy (sprint 4 AC-12, AC-13). */
let mockSaved: unknown = null;
jest.mock('./tripsCache', () => ({
  ...jest.requireActual('./tripsCache'),
  readTripsCache: jest.fn(async () => mockSaved),
  saveTripsCache: jest.fn(async () => {}),
  tripsCacheGeneration: () => 0,
}));
jest.mock('@/features/flights/flightsStore', () => ({ prefetchFlights: jest.fn(async () => {}) }));
const tripsCache = jest.requireMock<Record<string, jest.Mock>>('./tripsCache');
jest.mock('@/features/passportAlerts/passportRunner', () => ({
  passportTripsLoaded: jest.fn(async () => {}),
}));
const passportRunner = jest.requireMock<Record<string, jest.Mock>>(
  '@/features/passportAlerts/passportRunner',
);
/** The pin's query (sprint 3 AC-7). */
let mockNext: unknown = { ok: true, value: { trips: [] } };

const wrapper = ({ children }: { children: ReactNode }) => (
  <TripsProvider>{children}</TripsProvider>
);
const answer = (index: number, adm0s: string[]) =>
  act(async () => mockAnswers[index]!({ ok: true, value: new Set(adm0s) }));

beforeEach(() => {
  mockAnswers.length = 0;
  mockNext = { ok: true, value: { trips: [] } };
  mockSaved = null;
  jest.clearAllMocks();
  mockAuth.state = { status: 'signedIn', user: { id: 'user-1' } };
  jest.mocked(NetInfo.addEventListener).mockImplementation(() => jest.fn());
});

describe('TripsProvider (sprint 2 AC-8, AC-10)', () => {
  it('loads only after the globe is up', async () => {
    const { result } = await renderHook(() => useTrips(), { wrapper });
    expect(mockAnswers).toHaveLength(0);
    await act(async () => result.current.start());
    expect(mockAnswers).toHaveLength(1);
    await answer(0, ['THA']);
    expect([...result.current.countries!]).toEqual(['THA']);
    expect(result.current.firstLoad).toBe(true);
  });

  it('brings the next trip with the countries, for the pin (sprint 3 AC-7)', async () => {
    mockNext = { ok: true, value: { trips: [{ id: 'trip-1', countryAdm0: 'THA' }] } };
    const { result } = await renderHook(() => useTrips(), { wrapper });
    await act(async () => result.current.start());
    await answer(0, ['THA']);
    expect(result.current.nextTrip).toEqual({ id: 'trip-1', countryAdm0: 'THA' });
  });

  it('a failed next-trip query leaves no pin but still loads the countries', async () => {
    mockNext = { ok: false, error: 'offline' };
    const { result } = await renderHook(() => useTrips(), { wrapper });
    await act(async () => result.current.start());
    await answer(0, ['THA']);
    expect(result.current.nextTrip).toBeNull();
    expect(result.current.firstLoad).toBe(true);
  });

  it('an older answer that lands last is dropped (review)', async () => {
    const { result } = await renderHook(() => useTrips(), { wrapper });
    await act(async () => result.current.start());
    await act(async () => result.current.changed({ adm0: 'GRC', has: true }));
    expect(mockAnswers).toHaveLength(2);
    await answer(1, ['THA', 'GRC']);
    await answer(0, ['THA']);
    expect([...result.current.countries!].sort()).toEqual(['GRC', 'THA']);
  });

  it('a sign-out drops everything at once, and a late answer stays dropped (AC-8)', async () => {
    mockNext = { ok: true, value: { trips: [{ id: 'trip-1', countryAdm0: 'THA' }] } };
    const { result, rerender } = await renderHook(() => useTrips(), { wrapper });
    await act(async () => result.current.start());
    await answer(0, ['THA']);
    expect(result.current.nextTrip).not.toBeNull();
    await act(async () => result.current.changed());
    mockAuth.state = { status: 'signedOut', expired: false };
    await rerender({});
    expect(result.current.countries).toBeNull();
    expect(result.current.nextTrip).toBeNull();
    expect(result.current.firstLoad).toBe(false);
    await answer(1, ['THA', 'GRC']);
    expect(result.current.countries).toBeNull();
  });

  it('updates the highlight at once after a save or the last delete (design 7.5)', async () => {
    const { result } = await renderHook(() => useTrips(), { wrapper });
    await act(async () => result.current.start());
    await answer(0, ['THA']);
    await act(async () => result.current.changed({ adm0: 'MLT', has: true }));
    expect(result.current.countries!.has('MLT')).toBe(true);
    await act(async () => result.current.changed({ adm0: 'THA', has: false }));
    expect(result.current.countries!.has('THA')).toBe(false);
    await waitFor(() => expect(result.current.changes).toBe(2));
  });
});

describe('TripsProvider offline (sprint 4 F-015)', () => {
  const saved = {
    userId: 'user-1',
    savedAt: '2026-10-26T10:00:00Z',
    upcoming: [{ id: 'trip-1', countryAdm0: 'THA' }],
    past: [],
    countries: ['THA'],
    nextTrip: { id: 'trip-1', countryAdm0: 'THA' },
    full: false,
  };
  const offline = (index: number) =>
    act(async () => mockAnswers[index]!({ ok: false, reason: 'offline' }));

  it("offline at launch: this user's saved copy, read only (AC-13)", async () => {
    mockSaved = saved;
    const { result } = await renderHook(() => useTrips(), { wrapper });
    await act(async () => result.current.start());
    await offline(0);
    expect(tripsCache.readTripsCache).toHaveBeenCalledWith('user-1');
    expect(result.current.fromCache).toBe(true);
    expect([...result.current.countries!]).toEqual(['THA']);
    expect(result.current.nextTrip).toEqual(saved.nextTrip);
  });

  it('the network dropping after a load is read only; its return reloads and clears it', async () => {
    let netListener: (net: { isConnected: boolean }) => void = () => {};
    jest.mocked(NetInfo.addEventListener).mockImplementation((listener) => {
      netListener = listener as never;
      return jest.fn();
    });
    const { result } = await renderHook(() => useTrips(), { wrapper });
    await act(async () => result.current.start());
    await answer(0, ['THA']);
    expect(result.current.cache).not.toBeNull();
    await act(async () => netListener({ isConnected: false }));
    expect(result.current.fromCache).toBe(true);
    await act(async () => netListener({ isConnected: true }));
    expect(mockAnswers).toHaveLength(2);
    await answer(1, ['THA']);
    expect(result.current.fromCache).toBe(false);
  });

  it('a server error after reconnecting does not keep editing blocked (Raz, S4-m9)', async () => {
    let netListener: (net: { isConnected: boolean }) => void = () => {};
    jest.mocked(NetInfo.addEventListener).mockImplementation((listener) => {
      netListener = listener as never;
      return jest.fn();
    });
    const { result } = await renderHook(() => useTrips(), { wrapper });
    await act(async () => result.current.start());
    await answer(0, ['THA']);
    await act(async () => netListener({ isConnected: false }));
    await act(async () => netListener({ isConnected: true }));
    await act(async () => mockAnswers[1]!({ ok: false, reason: 'error' }));
    expect(result.current.fromCache).toBe(false);
  });

  it('saves 50 upcoming, and "more" only when a 51st came (Raz, S4-m10)', async () => {
    const trips = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `trip-${i}`, countryAdm0: 'THA' }));
    // The past page stays empty: only the upcoming one counts here.
    jest
      .requireMock<Record<string, jest.Mock>>('./tripsApi')
      .loadTripPage!.mockImplementation(async ({ section }: { section: string }) =>
        section === 'past' ? { ok: true, value: { trips: [] } } : mockNext,
      );
    mockNext = { ok: true, value: { trips: trips(50) } };
    const { result } = await renderHook(() => useTrips(), { wrapper });
    await act(async () => result.current.start());
    await answer(0, ['THA']);
    expect(tripsCache.saveTripsCache!.mock.calls[0]![0].full).toBe(false);
    mockNext = { ok: true, value: { trips: trips(51) } };
    await act(async () => result.current.changed());
    await answer(1, ['THA']);
    const second = tripsCache.saveTripsCache!.mock.calls[1]![0];
    expect(second.full).toBe(true);
    expect(second.upcoming).toHaveLength(50);
  });

  it('past trips failing still checks the upcoming ones against the passports (Dana bug 4)', async () => {
    jest
      .requireMock<Record<string, jest.Mock>>('./tripsApi')
      .loadTripPage!.mockImplementation(async ({ section }: { section: string }) =>
        section === 'past' ? { ok: false, error: 'offline' } : mockNext,
      );
    mockNext = { ok: true, value: { trips: [{ id: 'trip-1', countryAdm0: 'THA' }] } };
    const { result } = await renderHook(() => useTrips(), { wrapper });
    await act(async () => result.current.start());
    await answer(0, ['THA']);
    expect(tripsCache.saveTripsCache).not.toHaveBeenCalled();
    expect(passportRunner.passportTripsLoaded).toHaveBeenCalledWith([
      { id: 'trip-1', countryAdm0: 'THA' },
    ]);
  });
});
