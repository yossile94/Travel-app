import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { msToNextMidnight, useToday } from './useToday';

describe('msToNextMidnight', () => {
  it('runs to one second past the next local midnight', () => {
    const now = new Date(2026, 9, 26, 23, 59, 0);
    expect(msToNextMidnight(now)).toBe(61_000);
  });

  it('from just after midnight, waits almost a full day', () => {
    const now = new Date(2026, 9, 26, 0, 0, 2);
    expect(msToNextMidnight(now)).toBe(24 * 3600_000 - 1000);
  });

  it('crosses a month end', () => {
    const now = new Date(2026, 9, 31, 12, 0, 0);
    expect(msToNextMidnight(now)).toBe(12 * 3600_000 + 1000);
  });
});

describe('useToday (sprint 3 AC-6)', () => {
  let appStateListener: ((state: string) => void) | null = null;
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date(2026, 9, 26, 23, 59, 0) });
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      appStateListener = listener as (state: string) => void;
      return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
    });
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('turns over just after local midnight', async () => {
    const { result, unmount } = await renderHook(() => useToday());
    expect(result.current).toBe('2026-10-26');
    await act(async () => jest.advanceTimersByTime(61_000));
    expect(result.current).toBe('2026-10-27');
    unmount();
  });

  it('checks again when the app comes back to the front', async () => {
    const { result } = await renderHook(() => useToday());
    // The timer was held up (the phone slept): the clock moved, the timer did not fire.
    jest.setSystemTime(new Date(2026, 9, 28, 9, 0, 0));
    await act(async () => appStateListener?.('active'));
    expect(result.current).toBe('2026-10-28');
  });
});
