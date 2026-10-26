import NetInfo from '@react-native-community/netinfo';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { Trip, TripCursor, TripSection } from './tripsApi';
import { useTripList } from './useTripList';

type Page = { trips: Trip[]; next: TripCursor | null };
type Answer = { ok: true; value: Page } | { ok: false; reason: 'offline' | 'error' };

/** Answers per call: keyed by section and cursor id ('' for the first page). */
const mockPages = new Map<string, Answer>();
const mockCalls: string[] = [];
jest.mock('./tripsApi', () => ({
  loadTripPage: jest.fn(
    async ({ section, cursor }: { section: TripSection; cursor?: TripCursor | null }) => {
      const key = `${section}:${cursor?.id ?? ''}`;
      mockCalls.push(key);
      return mockPages.get(key) ?? { ok: false, reason: 'error' };
    },
  ),
}));

const trip = (id: string, startDate: string): Trip => ({
  id,
  countryAdm0: 'THA',
  title: id,
  startDate,
  endDate: startDate,
  notes: null,
  travelers: [],
  cities: [],
});
const page = (trips: Trip[], next: string | null): Answer => ({
  ok: true,
  value: { trips, next: next ? { startDate: '2027-01-01', id: next } : null },
});
const ids = (trips: Trip[]) => trips.map((t) => t.id);

beforeEach(() => {
  mockPages.clear();
  mockCalls.length = 0;
  jest.mocked(NetInfo.addEventListener).mockImplementation(() => jest.fn());
});

describe('useTripList (sprint 2 AC-4, AC-5)', () => {
  it('upcoming that ends in one page is followed by the first past page', async () => {
    mockPages.set('upcoming:', page([trip('u1', '2027-01-01')], null));
    mockPages.set('past:', page([trip('p1', '2025-01-01')], null));
    const { result } = await renderHook(() => useTripList({ enabled: true, reloadKey: 0 }));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    expect(ids(result.current.state.upcoming)).toEqual(['u1']);
    expect(ids(result.current.state.past)).toEqual(['p1']);
    expect(result.current.state.hasMore).toBe(false);
  });

  it('"My trips": both first pages at once, past shown only once upcoming ends (design 5.1)', async () => {
    mockPages.set('upcoming:', page([trip('u1', '2027-01-01')], 'u1'));
    mockPages.set('past:', page([trip('p1', '2025-01-01')], 'p1'));
    mockPages.set('upcoming:u1', page([trip('u2', '2027-02-01')], null));
    mockPages.set('past:p1', page([trip('p2', '2024-01-01')], null));
    const { result } = await renderHook(() =>
      useTripList({ enabled: true, reloadKey: 0, parallelFirstPage: true }),
    );
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    expect(mockCalls).toEqual(['upcoming:', 'past:']);
    expect(ids(result.current.state.past)).toEqual([]);

    await act(async () => result.current.loadMore());
    // Upcoming ended: the past page fetched at the start shows without a new request.
    expect(ids(result.current.state.upcoming)).toEqual(['u1', 'u2']);
    expect(ids(result.current.state.past)).toEqual(['p1']);
    expect(mockCalls).toEqual(['upcoming:', 'past:', 'upcoming:u1']);

    await act(async () => result.current.loadMore());
    expect(ids(result.current.state.past)).toEqual(['p1', 'p2']);
    expect(result.current.state.hasMore).toBe(false);
  });

  it('upcoming ending exactly at a page boundary reads the first past page in the same step', async () => {
    mockPages.set('upcoming:', page([trip('u1', '2027-01-01')], 'u1'));
    mockPages.set('upcoming:u1', page([], null));
    mockPages.set('past:', page([trip('p1', '2025-01-01')], null));
    const { result } = await renderHook(() => useTripList({ enabled: true, reloadKey: 0 }));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    await act(async () => result.current.loadMore());
    expect(ids(result.current.state.past)).toEqual(['p1']);
    expect(result.current.state.loadingMore).toBe(false);
    expect(result.current.state.hasMore).toBe(false);
  });

  it('a failed later page keeps the rows and offers a retry', async () => {
    mockPages.set('upcoming:', page([trip('u1', '2027-01-01')], 'u1'));
    const { result } = await renderHook(() => useTripList({ enabled: true, reloadKey: 0 }));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    await act(async () => result.current.loadMore());
    expect(result.current.state).toMatchObject({ moreError: true, loadingMore: false });
    expect(ids(result.current.state.upcoming)).toEqual(['u1']);
  });

  it('offline at the start says so (AC-7), and disabled empties at once (AC-8)', async () => {
    mockPages.set('upcoming:', { ok: false, reason: 'offline' });
    const { result, rerender } = await renderHook(
      ({ enabled }: { enabled: boolean }) => useTripList({ enabled, reloadKey: 0 }),
      { initialProps: { enabled: true } },
    );
    await waitFor(() => expect(result.current.state.status).toBe('offline'));

    mockPages.set('upcoming:', page([trip('u1', '2027-01-01')], null));
    mockPages.set('past:', page([], null));
    await act(async () => result.current.reload());
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    await rerender({ enabled: false });
    expect(result.current.state).toMatchObject({ status: 'idle', upcoming: [], past: [] });
  });
});
