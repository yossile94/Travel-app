import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import * as Reanimated from 'react-native-reanimated';

import { launchAlertOnce, resetLaunchAlertForTests } from '@/features/push/usePushOpen';
import { launch, motion, timing } from '@/theme/tokens';

import { LaunchOverlay } from './LaunchOverlay';
import { launchShown, launchSignals, resetLaunchForTests } from './launchSignals';

jest.mock('expo-splash-screen', () => ({
  hide: jest.fn(),
  preventAutoHideAsync: jest.fn(() => Promise.resolve(true)),
  setOptions: jest.fn(),
}));
jest.mock('@/lib/supabase', () => ({ supabase: null }));

const n = Notifications as jest.Mocked<typeof Notifications>;
const r = Reanimated as jest.Mocked<typeof Reanimated>;
const hide = SplashScreen.hide as jest.Mock;

const flightAlert = {
  notification: {
    request: {
      identifier: 'a1',
      content: { title: '', body: '', data: { v: 1, type: 'flight_change', flightId: 'f1' } },
    },
  },
} as never;
const insuranceAlert = {
  notification: {
    request: {
      identifier: 'a2',
      content: { title: '', body: '', data: { v: 1, type: 'insurance_reminder', tripId: 't1' } },
    },
  },
} as never;

/** The animations of the storyboard (design 1.3): the route's dash offset reaching 0. */
const routeDrawn = () =>
  r.withTiming.mock.calls.some(
    ([target, config]) =>
      target === 0 && (config as { duration?: number })?.duration === motion.launchRoute,
  );
/** The pin's jump, delayed to motion.launchPinDelay (design 1.3). */
const pinPlayed = () => r.withDelay.mock.calls.some(([delay]) => delay === motion.launchPinDelay);

async function mount() {
  const onFadeStart = jest.fn();
  const onGone = jest.fn();
  await render(<LaunchOverlay onFadeStart={onFadeStart} onGone={onGone} />);
  return { onFadeStart, onGone };
}

/** The image is drawn, and the next frame comes. */
async function imageDrawn() {
  await act(async () => {
    fireEvent(screen.getByTestId('launch-icon', { includeHiddenElements: true }), 'load');
    jest.advanceTimersByTime(20);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  resetLaunchForTests();
  resetLaunchAlertForTests();
  n.getLastNotificationResponse.mockReturnValue(null);
  (r.useReducedMotion as jest.Mock).mockReturnValue(false);
});
afterEach(() => jest.useRealTimers());

describe('LaunchOverlay (sprint 12 F-034)', () => {
  it('hides the system splash on the frame after the image is drawn, then plays (AC-5א)', async () => {
    await mount();
    expect(hide).not.toHaveBeenCalled();
    await imageDrawn();
    expect(hide).toHaveBeenCalledTimes(1);
    expect(routeDrawn()).toBe(true);
    expect(pinPlayed()).toBe(true);
    expect(launchShown.get()).toBe(true);
  });

  it('the glow fades in from t=0 once both images are there; hide() never waits for it', async () => {
    const glowFade = () =>
      r.withTiming.mock.calls.some(
        ([target, config]) =>
          target === 1 && (config as { duration?: number })?.duration === motion.launchGlow,
      );
    await mount();
    await imageDrawn();
    expect(hide).toHaveBeenCalledTimes(1);
    expect(glowFade()).toBe(false);
    await act(async () => {
      fireEvent(
        screen.getByTestId('launch-glow', { includeHiddenElements: true }).children[0] as never,
        'load',
      );
    });
    expect(glowFade()).toBe(true);
  });

  it('the glow never fades in over an empty frame: it waits for the globe (Raz)', async () => {
    await mount();
    await act(async () => {
      fireEvent(
        screen.getByTestId('launch-glow', { includeHiddenElements: true }).children[0] as never,
        'load',
      );
      jest.advanceTimersByTime(timing.launchHideFallback);
    });
    expect(hide).toHaveBeenCalledTimes(1);
    expect(
      r.withTiming.mock.calls.some(
        ([, config]) => (config as { duration?: number })?.duration === motion.launchGlow,
      ),
    ).toBe(false);
    await imageDrawn();
    expect(r.withTiming).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ duration: motion.launchGlow }),
    );
  });

  it('with reduce motion the glow still fades in: opacity in place (design 1.5)', async () => {
    (r.useReducedMotion as jest.Mock).mockReturnValue(true);
    await mount();
    await act(async () => {
      fireEvent(
        screen.getByTestId('launch-glow', { includeHiddenElements: true }).children[0] as never,
        'load',
      );
    });
    await imageDrawn();
    expect(r.withTiming).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ duration: motion.launchGlow, reduceMotion: 'never' }),
    );
  });

  it('hides the system splash after the fallback when the image never reports (design 1.3)', async () => {
    await mount();
    await act(async () => jest.advanceTimersByTime(timing.launchHideFallback));
    expect(hide).toHaveBeenCalledTimes(1);
    // No route over an empty frame: it waits for the globe (device check 30.10).
    expect(routeDrawn()).toBe(false);
    await imageDrawn();
    expect(hide).toHaveBeenCalledTimes(1);
    expect(routeDrawn()).toBe(true);
  });

  it('fades when the globe is ready, and leaves after motion.short (AC-5ג)', async () => {
    const { onFadeStart, onGone } = await mount();
    await imageDrawn();
    await act(async () => launchSignals.send('ready'));
    expect(onFadeStart).toHaveBeenCalledTimes(1);
    expect(
      screen.getByTestId('launch-overlay', { includeHiddenElements: true }).props.pointerEvents,
    ).toBe('none');
    expect(r.withTiming).toHaveBeenCalledWith(
      0,
      expect.objectContaining({ duration: motion.short }),
    );
    expect(onGone).not.toHaveBeenCalled();
    // Raz 5: two frames after motion.short, so the UI thread has finished the fade.
    await act(async () => jest.advanceTimersByTime(motion.short));
    expect(onGone).not.toHaveBeenCalled();
    await act(async () => jest.advanceTimersByTime(32));
    expect(onGone).toHaveBeenCalledTimes(1);
  });

  it('fades at once on an error (AC-5ד)', async () => {
    const { onFadeStart } = await mount();
    await act(async () => launchSignals.send('error'));
    expect(onFadeStart).toHaveBeenCalledTimes(1);
  });

  it('fades at the cap, whatever happens (AC-5ד)', async () => {
    const { onFadeStart } = await mount();
    await act(async () => jest.advanceTimersByTime(timing.launchCap - 1));
    expect(onFadeStart).not.toHaveBeenCalled();
    await act(async () => jest.advanceTimersByTime(1));
    expect(onFadeStart).toHaveBeenCalledTimes(1);
  });

  it('a ready sent before the overlay subscribed fades it on mount (design 1.4)', async () => {
    launchSignals.send('ready');
    const { onFadeStart } = await mount();
    expect(onFadeStart).toHaveBeenCalledTimes(1);
  });

  it('a second signal does not start a second fade (design 1.4)', async () => {
    const { onFadeStart, onGone } = await mount();
    await act(async () => launchSignals.send('ready'));
    await act(async () => launchSignals.send('error'));
    await act(async () => jest.advanceTimersByTime(timing.launchCap));
    expect(onFadeStart).toHaveBeenCalledTimes(1);
    expect(onGone).toHaveBeenCalledTimes(1);
  });

  it('with reduce motion: frame 0 stays still (AC-7)', async () => {
    (r.useReducedMotion as jest.Mock).mockReturnValue(true);
    await mount();
    await imageDrawn();
    expect(hide).toHaveBeenCalledTimes(1);
    expect(routeDrawn()).toBe(false);
    expect(pinPlayed()).toBe(false);
  });

  it.each([
    ['a flight alert', flightAlert],
    ['an insurance reminder', insuranceAlert],
  ])('a cold start from %s: frame 0 stays still (AC-8)', async (_name, response) => {
    n.getLastNotificationResponse.mockReturnValue(response);
    await mount();
    await imageDrawn();
    expect(routeDrawn()).toBe(false);
    expect(pinPlayed()).toBe(false);
  });

  it('asks about the launch alert once, at mount (design 1.5)', async () => {
    await mount();
    await imageDrawn();
    expect(n.getLastNotificationResponse).toHaveBeenCalledTimes(1);
  });

  it('Dana B-2: once the overlay is gone, the launch alert is asked again', async () => {
    const { onGone } = await mount();
    await imageDrawn();
    await act(async () => launchSignals.send('ready'));
    await act(async () => jest.advanceTimersByTime(motion.short + 32));
    expect(onGone).toHaveBeenCalledTimes(1);
    await launchAlertOnce();
    expect(n.getLastNotificationResponse).toHaveBeenCalledTimes(2);
  });

  it('Raz 6: unmounted before its fade, the launch alert is forgotten too', async () => {
    await mount();
    await imageDrawn();
    await act(async () => screen.unmount());
    await launchAlertOnce();
    expect(n.getLastNotificationResponse).toHaveBeenCalledTimes(2);
  });

  it('unmounting before the splash was hidden still hides it (design 1.3)', async () => {
    await mount();
    await act(async () => screen.unmount());
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it('places the pin tip on the route end (design 1.2)', async () => {
    await mount();
    const style = Object.assign(
      {},
      ...[screen.getByTestId('launch-pin', { includeHiddenElements: true }).props.style].flat(2),
    );
    const u = launch.viewBox / launch.iconFrame;
    expect(style.left + style.width / 2).toBeCloseTo(launch.pinAt[0] / u);
    expect(style.top + style.height).toBeCloseTo(launch.pinAt[1] / u);
  });
});

describe('launch.routeLength (design 1.2)', () => {
  it('matches the arc within 1%', () => {
    const nums = launch.routePath.match(/[\d.]+/g)!.map(Number);
    const [x0, y0, cx, cy, x1, y1] = nums as [number, number, number, number, number, number];
    let length = 0;
    let prev: [number, number] = [x0, y0];
    for (let i = 1; i <= 1000; i++) {
      const t = i / 1000;
      const x = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t * t * x1;
      const y = (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t * t * y1;
      length += Math.hypot(x - prev[0], y - prev[1]);
      prev = [x, y];
    }
    expect(Math.abs(length - launch.routeLength) / length).toBeLessThan(0.01);
    expect([x1, y1]).toEqual(launch.pinAt);
  });
});
