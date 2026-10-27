import '@/i18n';

import { act, renderHook } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';

import * as push from './push';
import { usePushSetup } from './usePushSetup';

jest.mock('@/lib/supabase', () => {
  const chain = {
    select: () => chain,
    not: () => chain,
    gte: async () => ({ count: 1, error: null }),
  };
  return { supabase: { from: () => chain } };
});
jest.mock('./push', () => ({
  ...jest.requireActual('./push'),
  ensureChannel: jest.fn(async () => {}),
  explainerState: jest.fn(),
  permissionState: jest.fn(async () => 'undetermined'),
  flightAlertsOn: jest.fn(async () => false),
  recordShown: jest.fn(async () => {}),
  syncConsent: jest.fn(async () => {}),
  registerDevice: jest.fn(async () => true),
}));

const m = push as jest.Mocked<typeof push>;
const n = Notifications as jest.Mocked<typeof Notifications>;

const mount = () =>
  renderHook(() => usePushSetup({ userId: 'u', ready: true, quiet: true, onToast: () => {} }));

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

describe('usePushSetup (QA S6 regressions)', () => {
  it('at launch the explainer shows only to a user never shown it (bug 2)', async () => {
    m.explainerState.mockResolvedValue({ shown: 0, allowed: false });
    const first = await mount();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });
    expect(first.result.current.visible).toBe(true);
    await first.unmount();

    m.explainerState.mockResolvedValue({ shown: 1, allowed: false });
    const second = await mount();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });
    expect(second.result.current.visible).toBe(false);
  });

  it('a new token goes through the consent check, never straight to the server (bug 3)', async () => {
    let onToken: () => void = () => {};
    n.addPushTokenListener.mockImplementation((l) => {
      onToken = l as never;
      return { remove: jest.fn() };
    });
    m.explainerState.mockResolvedValue({ shown: 2, allowed: false });
    await mount();
    m.syncConsent.mockClear();
    await act(async () => onToken());
    expect(m.syncConsent).toHaveBeenCalledWith('u', expect.any(String));
    expect(m.registerDevice).not.toHaveBeenCalled();
  });
});
