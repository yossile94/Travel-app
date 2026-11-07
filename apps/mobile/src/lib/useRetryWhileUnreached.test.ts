// v0.14.1 (Raz's review of PR 30): on the device copy while NetInfo says
// connected, the load is tried again on a backoff and when the app returns.
// Sprint 14 AC-11: 30s doubling to 5 minutes, with jitter.
import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';

import {
  MAX_RETRY_MS,
  RETRY_MS,
  retryDelay,
  useRetryWhileUnreached,
} from './useRetryWhileUnreached';

const mockNet = { isConnected: true as boolean | null };
jest.mock('@react-native-community/netinfo', () => ({
  fetch: async () => ({ isConnected: mockNet.isConnected }),
}));

let appListener: ((state: string) => void) | null = null;
beforeEach(() => {
  jest.useFakeTimers();
  mockNet.isConnected = true;
  // The upper end of the jitter, so each wait is the full step.
  jest.spyOn(Math, 'random').mockReturnValue(1);
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appListener = listener as (state: string) => void;
    return { remove: () => (appListener = null) } as ReturnType<typeof AppState.addEventListener>;
  });
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('retryDelay', () => {
  it('doubles from 30 seconds and stops at 5 minutes', () => {
    const top = () => 1;
    expect([0, 1, 2, 3, 4, 10].map((n) => retryDelay(n, top))).toEqual([
      30_000,
      60_000,
      120_000,
      240_000,
      MAX_RETRY_MS,
      MAX_RETRY_MS,
    ]);
  });

  it('jitters within the upper half of each step', () => {
    expect(retryDelay(0, () => 0)).toBe(RETRY_MS / 2);
    expect(retryDelay(4, () => 0)).toBe(MAX_RETRY_MS / 2);
    expect(retryDelay(2, () => 0.5)).toBe(90_000);
  });
});

it('backs off between tries while connected', async () => {
  const retry = jest.fn();
  await renderHook(() => useRetryWhileUnreached(true, retry));
  await act(async () => jest.advanceTimersByTimeAsync(RETRY_MS));
  expect(retry).toHaveBeenCalledTimes(1);
  // The next wait is 60s, not another 30s.
  await act(async () => jest.advanceTimersByTimeAsync(RETRY_MS));
  expect(retry).toHaveBeenCalledTimes(1);
  await act(async () => jest.advanceTimersByTimeAsync(RETRY_MS));
  expect(retry).toHaveBeenCalledTimes(2);
});

it('tries at once and starts over on return to the front', async () => {
  const retry = jest.fn();
  await renderHook(() => useRetryWhileUnreached(true, retry));
  await act(async () => jest.advanceTimersByTimeAsync(RETRY_MS * 3));
  expect(retry).toHaveBeenCalledTimes(2);
  await act(async () => {
    appListener?.('active');
    await Promise.resolve();
  });
  expect(retry).toHaveBeenCalledTimes(3);
  // Back to a 30s wait.
  await act(async () => jest.advanceTimersByTimeAsync(RETRY_MS));
  expect(retry).toHaveBeenCalledTimes(4);
});

it('does nothing when not on the copy, or when the device is really offline', async () => {
  const retry = jest.fn();
  const { rerender } = await renderHook(
    ({ on }: { on: boolean }) => useRetryWhileUnreached(on, retry),
    {
      initialProps: { on: false },
    },
  );
  await act(async () => jest.advanceTimersByTimeAsync(RETRY_MS * 2));
  expect(retry).not.toHaveBeenCalled();
  mockNet.isConnected = false;
  await rerender({ on: true });
  await act(async () => jest.advanceTimersByTimeAsync(RETRY_MS));
  expect(retry).not.toHaveBeenCalled();
});

it('stops once the copy is left', async () => {
  const retry = jest.fn();
  const { rerender } = await renderHook(
    ({ on }: { on: boolean }) => useRetryWhileUnreached(on, retry),
    {
      initialProps: { on: true },
    },
  );
  await rerender({ on: false });
  await act(async () => jest.advanceTimersByTimeAsync(MAX_RETRY_MS * 2));
  expect(retry).not.toHaveBeenCalled();
  expect(appListener).toBeNull();
});
