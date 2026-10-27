import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

import {
  allowPush,
  consentPending,
  flightAlertsOn,
  registerDevice,
  setFlightAlerts,
  signedInAgain,
  explainerState,
  permissionState,
  pushRowState,
  recordShown,
  shouldOfferPush,
  unregisterDevice,
  UNREGISTER_TIMEOUT_MS,
  flightIdOf,
} from './push';

const mockRpc = jest.fn();
const mockUpdate = jest.fn();
const mockSelect = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: () => ({
      update: (v: unknown) => ({ eq: () => mockUpdate(v) }),
      select: () => ({ eq: () => ({ maybeSingle: () => mockSelect() }) }),
    }),
  },
}));

const n = Notifications as jest.Mocked<typeof Notifications>;
const os = (granted: boolean, canAskAgain = true) =>
  n.getPermissionsAsync.mockResolvedValue({ granted, canAskAgain } as never);

beforeEach(async () => {
  signedInAgain();
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockRpc.mockResolvedValue({ error: null });
  mockUpdate.mockResolvedValue({ error: null });
  mockSelect.mockResolvedValue({ data: { flight_alerts: false }, error: null });
  os(false);
});

const offer = {
  trigger: true,
  flightAlerts: false,
  allowedHere: false,
  shown: 0,
  permission: 'undetermined' as const,
  shownThisSession: false,
  quiet: true,
};

describe('shouldOfferPush (design 2.2)', () => {
  it('offers on a trigger when nothing says no', () => {
    expect(shouldOfferPush(offer)).toBe(true);
  });

  it.each([
    ['no trigger', { trigger: false }],
    ['alerts already on', { flightAlerts: true }],
    ['allowed on this device', { allowedHere: true }],
    ['a system refusal', { permission: 'denied' as const }],
    ['shown twice', { shown: 2 }],
    ['shown this session', { shownThisSession: true }],
    ['something else on screen', { quiet: false }],
  ])('not with %s', (_, change) => {
    expect(shouldOfferPush({ ...offer, ...change })).toBe(false);
  });

  it('offers offline, when the switch is unknown', () => {
    expect(shouldOfferPush({ ...offer, flightAlerts: null })).toBe(true);
  });
});

const row = {
  flightAlerts: true as boolean | null,
  permission: 'granted' as const,
  channelEnabled: true,
  tokenRegistered: true,
  consentPending: false,
  allowedHere: true,
};

describe('pushRowState (design 6.2)', () => {
  it.each([
    ['on', row],
    ['not_connected', { ...row, tokenRegistered: false }],
    [
      'not_connected',
      { ...row, flightAlerts: false, consentPending: true, tokenRegistered: false },
    ],
    ['off', { ...row, flightAlerts: false }],
    ['never_asked', { ...row, flightAlerts: false, allowedHere: false }],
    [
      'never_asked',
      { ...row, flightAlerts: false, allowedHere: false, permission: 'undetermined' },
    ],
    ['blocked', { ...row, permission: 'denied' }],
    ['blocked', { ...row, channelEnabled: false }],
    ['blocked', { ...row, flightAlerts: false, permission: 'denied' }],
    ['loading', { ...row, flightAlerts: null }],
  ] as const)('%s', (expected, input) => {
    expect(pushRowState(input)).toBe(expected);
  });
});

describe('the explainer count is per user', () => {
  it('counts each showing for its user only', async () => {
    await recordShown('a');
    await recordShown('a');
    expect((await explainerState('a')).shown).toBe(2);
    expect((await explainerState('b')).shown).toBe(0);
  });
});

describe('allowPush (design 2.6)', () => {
  const channel = { name: 'n', description: 'd' };

  it('Android 13+: a refused prompt is final, nothing reaches the server', async () => {
    const { Platform } = jest.requireActual('react-native');
    jest.replaceProperty(Platform, 'OS', 'android');
    jest.spyOn(Platform, 'Version', 'get').mockReturnValue(34);
    n.requestPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: true } as never);
    expect(await allowPush('u', 'he', channel)).toBe('refused');
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
    // Still "can ask again" for Android, but never for us (Raz 4).
    expect(await permissionState()).toBe('denied');
    jest.restoreAllMocks();
  });

  it('allowed: the switch on, then this device registered', async () => {
    os(true);
    mockSelect.mockResolvedValue({ data: { flight_alerts: true }, error: null });
    expect(await allowPush('u', 'en', channel)).toBe('on');
    expect(mockUpdate).toHaveBeenCalledWith({ flight_alerts: true });
    expect(mockRpc).toHaveBeenCalledWith(
      'register_push_token',
      expect.objectContaining({ p_locale: 'en' }),
    );
    expect((await explainerState('u')).allowed).toBe(true);
  });

  it('offline: the consent waits on the device', async () => {
    os(true);
    mockUpdate.mockResolvedValue({ error: { code: 'offline' } });
    expect(await allowPush('u', 'he', channel)).toBe('on');
    expect(await AsyncStorage.getItem('push.consentPending.u')).toBe('1');
  });
});

describe('unregisterDevice (Raz 5, design 6.4)', () => {
  beforeEach(async () => {
    await AsyncStorage.setItem(
      'push-token',
      JSON.stringify({ userId: 'u', token: 'ExponentPushToken[x]' }),
    );
  });

  it('tells the server and keeps Push on the device', async () => {
    await unregisterDevice();
    expect(mockRpc).toHaveBeenCalledWith('unregister_push_token', {
      p_token: 'ExponentPushToken[x]',
    });
    expect(n.unregisterForNotificationsAsync).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem('push-token')).toBeNull();
  });

  it('the server failed: the device stops taking Push', async () => {
    mockRpc.mockResolvedValue({ error: { code: 'x' } });
    await unregisterDevice();
    expect(n.unregisterForNotificationsAsync).toHaveBeenCalled();
  });

  it('gives up after 3 seconds', async () => {
    jest.useFakeTimers();
    mockRpc.mockReturnValue(new Promise(() => {}));
    const done = unregisterDevice();
    await jest.advanceTimersByTimeAsync(UNREGISTER_TIMEOUT_MS);
    await done;
    expect(n.unregisterForNotificationsAsync).toHaveBeenCalled();
    jest.useRealTimers();
  });
});

describe('flightIdOf (design 4.3)', () => {
  const response = (data: unknown) =>
    ({ notification: { request: { content: { data } } } }) as never;

  it('reads only a v1 flight change', () => {
    expect(flightIdOf(response({ v: 1, type: 'flight_change', flightId: 'f' }))).toBe('f');
    expect(flightIdOf(response({ v: 2, type: 'flight_change', flightId: 'f' }))).toBeNull();
    expect(flightIdOf(response({ v: 1, type: 'other', flightId: 'f' }))).toBeNull();
    expect(flightIdOf(response({ v: 1, type: 'flight_change' }))).toBeNull();
  });
});

describe('review fixes (Raz 3, 10, 12; Dudi 9)', () => {
  it('a switch change clears a consent still waiting, so it never comes back on', async () => {
    await AsyncStorage.setItem('push.consentPending.u', '1');
    expect(await setFlightAlerts('u', false)).toBe(true);
    expect(await consentPending('u')).toBe(false);
  });

  it('offline, the switch reads as last seen', async () => {
    await setFlightAlerts('u', true);
    mockSelect.mockResolvedValue({ data: null, error: { code: 'offline' } });
    expect(await flightAlertsOn('u')).toBe(true);
  });

  it('registers once a day unless the token or the language changes', async () => {
    os(true);
    expect(await registerDevice('u', 'he')).toBe(true);
    expect(await registerDevice('u', 'he')).toBe(true);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    await registerDevice('u', 'en');
    expect(mockRpc).toHaveBeenCalledTimes(2);
  });

  it('nothing registers between unregister and sign-out', async () => {
    os(true);
    await unregisterDevice();
    expect(await registerDevice('u', 'he')).toBe(false);
    signedInAgain();
    expect(await registerDevice('u', 'he')).toBe(true);
  });
});
