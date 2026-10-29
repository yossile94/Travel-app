/**
 * Reanimated 4.7 can't load under jest-expo: with the native platform it
 * initialises its JS module through the native path, which throws
 * ("setCSSEventHandler is not available in JSReanimated"), and its own
 * react-native-reanimated/mock goes through the same import. Components are
 * tested for content and behaviour, not animation, so a minimal stand-in for
 * the APIs the app uses is enough: animated values land on their target at once.
 */
jest.mock('react-native-reanimated', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const identity = (t: number) => t;

  function useSharedValue<T>(initial: T) {
    const ref = {
      value: initial,
      get: () => ref.value,
      set: (next: T) => {
        ref.value = next;
      },
    };
    return ref;
  }

  return {
    __esModule: true,
    default: { View },
    View,
    Easing: { linear: identity, bezier: () => identity },
    useSharedValue,
    useAnimatedStyle: (factory: () => object) => factory(),
    useAnimatedKeyboard: () => ({ height: { value: 0 }, state: { value: 0 } }),
    ReduceMotion: { System: 'system', Always: 'always', Never: 'never' },
    withTiming: jest.fn(<T>(target: T) => target),
    useReducedMotion: () => false,
  };
});

// Native modules from sprint 1 F-003a, replaced with their maintainers' Jest mocks.
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@react-native-community/netinfo', () =>
  jest.requireActual('@react-native-community/netinfo/jest/netinfo-mock.js'),
);

// Sprint 11: Mapbox has no native side in Jest (the hotel's map point is in
// the kit screens). A map and a camera that draw nothing; the globe tests
// replace it with their own.
jest.mock('@rnmapbox/maps', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const MapView = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(View, { testID: 'mock-map' }, children);
  const Camera = React.forwardRef(function Camera() {
    return null;
  });
  return { MapView, Camera };
});

// Sprint 6: expo-notifications has no native side in Jest. A small stand-in
// with the calls the app makes; tests that care override it.
jest.mock('expo-notifications', () => ({
  AndroidImportance: { NONE: 0, DEFAULT: 3, HIGH: 6 },
  // Sprint 8: the local insurance reminder.
  SchedulableTriggerInputTypes: { DATE: 'date' },
  scheduleNotificationAsync: jest.fn(async () => 'id'),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  // Sprint 10: the passport alerts clear a shown notification when the trip is fine again.
  dismissNotificationAsync: jest.fn(async () => undefined),
  getPresentedNotificationsAsync: jest.fn(async () => []),
  AndroidNotificationVisibility: { PRIVATE: 2 },
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => null),
  getNotificationChannelAsync: jest.fn(async () => ({ importance: 6 })),
  unregisterForNotificationsAsync: jest.fn(async () => undefined),
  getPermissionsAsync: jest.fn(async () => ({
    granted: false,
    canAskAgain: true,
    status: 'undetermined',
  })),
  requestPermissionsAsync: jest.fn(async () => ({
    granted: true,
    canAskAgain: true,
    status: 'granted',
  })),
  getExpoPushTokenAsync: jest.fn(async () => ({
    type: 'expo',
    data: 'ExponentPushToken[test-token-123]',
  })),
  getLastNotificationResponse: jest.fn(() => null),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addPushTokenListener: jest.fn(() => ({ remove: jest.fn() })),
}));
