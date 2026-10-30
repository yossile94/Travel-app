/**
 * Sprint 12 design 1.3, 1.5, 1.6: the root shows the launch overlay once per
 * run, hides the screens from TalkBack while it covers them, and hides the
 * system splash on every mount.
 */
import { act, render, screen } from '@testing-library/react-native';
import * as SplashScreen from 'expo-splash-screen';

import RootLayout from '@/app/_layout';

import { launchShown, launchSignals, resetLaunchForTests } from './launchSignals';

jest.mock('expo-splash-screen', () => ({
  hide: jest.fn(),
  preventAutoHideAsync: jest.fn(() => Promise.resolve(true)),
  setOptions: jest.fn(),
}));
jest.mock('expo-router', () => {
  const { Text: RNText } = jest.requireActual<typeof import('react-native')>('react-native');
  return { Stack: () => <RNText testID="stack">screens</RNText> };
});
jest.mock('@/features/auth/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/features/trips/TripsProvider', () => ({
  TripsProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/features/kit/policyFile', () => ({ clearViews: jest.fn() }));
jest.mock('@/features/passport/vault', () => ({
  vault: { clearCaptures: jest.fn(() => Promise.resolve()) },
}));
jest.mock('@/features/passportAlerts/passportRunner', () => ({ startPassportAlerts: jest.fn() }));
jest.mock('@/lib/supabase', () => ({ supabase: null }));

const hide = SplashScreen.hide as jest.Mock;

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  resetLaunchForTests();
});
afterEach(() => jest.useRealTimers());

describe('RootLayout and the launch overlay', () => {
  it('a cold start: the overlay covers the screens, which TalkBack does not reach until the fade', async () => {
    await render(<RootLayout />);
    expect(screen.getByTestId('launch-overlay', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId('stack')).toBeNull();
    expect(screen.getByTestId('stack', { includeHiddenElements: true })).toBeTruthy();

    await act(async () => launchSignals.send('ready'));
    expect(screen.getByTestId('stack')).toBeTruthy();
    await act(async () => jest.advanceTimersByTime(1_000));
    expect(screen.queryByTestId('launch-overlay', { includeHiddenElements: true })).toBeNull();
  });

  it('a warm start: no overlay, and the system splash is hidden at mount (design 1.3)', async () => {
    launchShown.mark();
    await render(<RootLayout />);
    expect(screen.queryByTestId('launch-overlay', { includeHiddenElements: true })).toBeNull();
    expect(screen.getByTestId('stack')).toBeTruthy();
    expect(hide).toHaveBeenCalledTimes(1);
  });
});
