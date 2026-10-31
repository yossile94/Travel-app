// v0.14.1 (Raz's review of PR 30): on the device copy while NetInfo says
// connected, the load is tried again every 30s and when the app returns.
import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { RETRY_MS, useRetryWhileUnreached } from './useRetryWhileUnreached';

const mockNet = { isConnected: true as boolean | null };
jest.mock('@react-native-community/netinfo', () => ({
  fetch: async () => ({ isConnected: mockNet.isConnected }),
}));

let appListener: ((state: string) => void) | null = null;
beforeEach(() => {
  jest.useFakeTimers();
  mockNet.isConnected = true;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appListener = listener as (state: string) => void;
    return { remove: () => (appListener = null) } as ReturnType<typeof AppState.addEventListener>;
  });
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('tries again every 30s and on return to the front, while connected', async () => {
  const retry = jest.fn();
  await renderHook(() => useRetryWhileUnreached(true, retry));
  await act(async () => jest.advanceTimersByTimeAsync(RETRY_MS));
  expect(retry).toHaveBeenCalledTimes(1);
  await act(async () => {
    appListener?.('active');
    await Promise.resolve();
  });
  expect(retry).toHaveBeenCalledTimes(2);
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
  await act(async () => jest.advanceTimersByTimeAsync(RETRY_MS * 2));
  expect(retry).not.toHaveBeenCalled();
  expect(appListener).toBeNull();
});
