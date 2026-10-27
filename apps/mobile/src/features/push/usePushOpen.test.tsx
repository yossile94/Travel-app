import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';

import { launchedFromAlert, usePushOpen } from './usePushOpen';

jest.mock('@/lib/supabase', () => ({ supabase: null }));

const n = Notifications as jest.Mocked<typeof Notifications>;
const response = (id: string, data: unknown) =>
  ({
    notification: {
      request: { identifier: id, content: { title: 'LY81 delayed', body: 'New departure', data } },
    },
  }) as never;
const flight = { v: 1, type: 'flight_change', flightId: 'f1' };

const mount = async (signedIn = true) => {
  const onOpen = jest.fn();
  const onSignedOut = jest.fn();
  const hook = await renderHook(() => usePushOpen({ ready: true, signedIn, onOpen, onSignedOut }));
  await act(async () => {});
  return { onOpen, onSignedOut, hook };
};

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe('usePushOpen (design 4)', () => {
  it('opens the flight of the alert that started the app, once across launches', async () => {
    n.getLastNotificationResponse.mockReturnValue(response('a', flight));
    expect(await launchedFromAlert()).toBe(true);
    const first = await mount();
    expect(first.onOpen).toHaveBeenCalledWith('f1', {
      title: 'LY81 delayed',
      body: 'New departure',
    });
    await first.hook.unmount();
    // The next launch: Android still hands back the same response (Raz review 8).
    expect(await launchedFromAlert()).toBe(false);
  });

  it('a tap while signed out says the flight is not there (design 4.3)', async () => {
    n.getLastNotificationResponse.mockReturnValue(response('b', flight));
    const { onOpen, onSignedOut } = await mount(false);
    expect(onSignedOut).toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('the getter and the listener with the same tap open it once', async () => {
    let listener: (r: never) => void = () => {};
    n.addNotificationResponseReceivedListener.mockImplementation((l) => {
      listener = l as never;
      return { remove: jest.fn() };
    });
    n.getLastNotificationResponse.mockReturnValue(response('c', flight));
    const { onOpen } = await mount();
    await act(async () => listener(response('c', flight)));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('a payload that is not a flight change opens nothing', async () => {
    n.getLastNotificationResponse.mockReturnValue(response('d', { v: 2, type: 'x' }));
    const { onOpen, onSignedOut } = await mount();
    expect(onOpen).not.toHaveBeenCalled();
    expect(onSignedOut).not.toHaveBeenCalled();
  });
});
