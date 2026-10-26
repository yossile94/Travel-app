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
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <TripsProvider>{children}</TripsProvider>
);
const answer = (index: number, adm0s: string[]) =>
  act(async () => mockAnswers[index]!({ ok: true, value: new Set(adm0s) }));

beforeEach(() => {
  mockAnswers.length = 0;
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
    const { result, rerender } = await renderHook(() => useTrips(), { wrapper });
    await act(async () => result.current.start());
    await answer(0, ['THA']);
    await act(async () => result.current.changed());
    mockAuth.state = { status: 'signedOut', expired: false };
    await rerender({});
    expect(result.current.countries).toBeNull();
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
