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
  };
});

// Native modules from sprint 1 F-003a, replaced with their maintainers' Jest mocks.
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@react-native-community/netinfo', () =>
  jest.requireActual('@react-native-community/netinfo/jest/netinfo-mock.js'),
);
