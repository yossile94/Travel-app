import { act, render, renderHook, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { NextTripPin, PULSE_CYCLE, PULSE_STEPS, usePulse } from './NextTripPin';

jest.mock('@rnmapbox/maps', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const React = jest.requireActual<typeof import('react')>('react');
  const layer = (props: { id: string; style?: object; children?: unknown }) =>
    React.createElement(
      View,
      { testID: `layer-${props.id}`, style: props.style },
      props.children as never,
    );
  const Nothing = () => null;
  return { CircleLayer: layer, SymbolLayer: layer, ShapeSource: layer, Images: Nothing };
});

describe('the pin pulse (Raz, R1)', () => {
  it('is three style updates per cycle, all inside it', () => {
    expect(PULSE_STEPS).toHaveLength(3);
    for (const step of PULSE_STEPS) expect(step.at).toBeLessThan(PULSE_CYCLE);
  });

  it('only jumps the ring back once it is invisible', () => {
    const fade = PULSE_STEPS.find((s) => s.change.opacity === 0)!;
    const reset = PULSE_STEPS.find((s) => s.change.radiusDuration === 0 && s.at > 0)!;
    expect(fade.at + (fade.change.opacityDuration ?? 0)).toBeLessThanOrEqual(reset.at);
  });
});

describe('usePulse (design 9.4)', () => {
  let appStateListener: ((state: string) => void) | null = null;
  let original: PropertyDescriptor | undefined;
  beforeEach(() => {
    jest.useFakeTimers();
    original = Object.getOwnPropertyDescriptor(AppState, 'currentState');
    Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      appStateListener = listener as (state: string) => void;
      return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
    });
  });
  afterEach(() => {
    if (original) Object.defineProperty(AppState, 'currentState', original);
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('runs the steps on time, cycle after cycle, without piling up timers (Raz, m3)', async () => {
    const { result, unmount } = await renderHook(() => usePulse(true));
    expect(result.current.opacity).toBe(0.7);
    await act(async () => jest.advanceTimersByTime(100));
    expect(result.current.opacity).toBe(0);
    await act(async () => jest.advanceTimersByTime(1100));
    expect(result.current.radiusDuration).toBe(0);
    await act(async () => jest.advanceTimersByTime(400));
    expect(result.current.opacity).toBe(0.7);
    // Nothing piles up: as many timers after 20 more cycles as after one.
    const running = jest.getTimerCount();
    for (let i = 0; i < 20; i++) await act(async () => jest.advanceTimersByTime(PULSE_CYCLE));
    expect(jest.getTimerCount()).toBe(running);
    unmount();
  });

  it('stays at rest when not allowed, and stops at once when it stops being allowed', async () => {
    const { result, rerender } = await renderHook(({ on }: { on: boolean }) => usePulse(on), {
      initialProps: { on: false },
    });
    expect(result.current.opacity).toBe(0);
    await act(async () => jest.advanceTimersByTime(PULSE_CYCLE));
    expect(result.current.opacity).toBe(0);
    await rerender({ on: true });
    expect(result.current.opacity).toBe(0.7);
    await rerender({ on: false });
    expect(result.current.opacity).toBe(0);
    await act(async () => jest.advanceTimersByTime(PULSE_CYCLE * 2));
    expect(result.current.opacity).toBe(0);
  });

  it('stops in the background and starts again in front', async () => {
    const { result } = await renderHook(() => usePulse(true));
    await act(async () => appStateListener?.('background'));
    expect(result.current.opacity).toBe(0);
    await act(async () => jest.advanceTimersByTime(PULSE_CYCLE * 2));
    expect(result.current.opacity).toBe(0);
    await act(async () => appStateListener?.('active'));
    expect(result.current.opacity).toBe(0.7);
  });
});

describe('NextTripPin under reduced motion (design 9.4, Raz R6)', () => {
  it('shows the pin with no pulse', async () => {
    jest.useFakeTimers();
    const original = Object.getOwnPropertyDescriptor(AppState, 'currentState');
    Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
    try {
      await render(
        <NextTripPin
          feature={{ adm0: 'GRC', tripId: 't1', coordinate: [22, 39] }}
          pulseAllowed
          reduceMotion
        />,
      );
      for (let i = 0; i < 3; i++) await act(async () => jest.advanceTimersByTime(PULSE_CYCLE));
      const ring = screen.getByTestId('layer-next-trip-pulse');
      expect(ring.props.style.circleStrokeOpacity).toBe(0);
      expect(screen.getByTestId('layer-next-trip-pin')).toBeOnTheScreen();
      // The same pin without reduced motion does pulse (the check above is real).
      await screen.rerender(
        <NextTripPin
          feature={{ adm0: 'GRC', tripId: 't1', coordinate: [22, 39] }}
          pulseAllowed
          reduceMotion={false}
        />,
      );
      expect(screen.getByTestId('layer-next-trip-pulse').props.style.circleStrokeOpacity).toBe(0.7);
    } finally {
      if (original) Object.defineProperty(AppState, 'currentState', original);
      jest.useRealTimers();
    }
  });
});
