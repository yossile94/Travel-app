import { act, renderHook } from '@testing-library/react-native';

import { ROTATION_SEGMENT_MS } from './camera';
import { useAutoRotation } from './useAutoRotation';

type Center = [number, number];

async function setup({ allowed = true, idleSince = 0, center = [30, 20] as Center | null } = {}) {
  const setCamera = jest.fn();
  const cameraRef = { current: { setCamera } } as never;
  const getCenter = jest.fn(async () => center);
  const hook = await renderHook(
    (props: { allowed: boolean }) =>
      useAutoRotation({
        cameraRef,
        getCenter,
        allowed: props.allowed,
        lastInteractionAt: idleSince,
      }),
    { initialProps: { allowed } },
  );
  return { setCamera, getCenter, hook };
}

/** Advances fake time and lets the awaited getCenter() settle. */
async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

beforeEach(() => jest.useFakeTimers({ now: 100_000 }));
afterEach(() => jest.useRealTimers());

describe('useAutoRotation', () => {
  it('waits 5 seconds after the last interaction (AC-2)', async () => {
    const { setCamera } = await setup({ idleSince: Date.now() });
    await advance(4_900);
    expect(setCamera).not.toHaveBeenCalled();
    await advance(200); // 5 s reached: reads the centre
    await advance(0); // first segment goes out
    expect(setCamera).toHaveBeenCalled();
  });

  it('eases in, then turns west at a steady speed', async () => {
    const { setCamera } = await setup({ idleSince: 0 });
    await advance(0);
    await advance(1_000);
    const longitudes = setCamera.mock.calls.map(([stop]) => stop.centerCoordinate[0]);
    expect(longitudes.length).toBeGreaterThanOrEqual(3);
    longitudes.reduce((previous, lng) => {
      expect(lng).toBeLessThan(previous);
      return lng;
    }, 30);
    for (const [stop] of setCamera.mock.calls) expect(stop.animationMode).toBe('linearTo');
  });

  it('keeps turning without slowing down between long segments', async () => {
    const { setCamera } = await setup({ idleSince: 0 });
    await advance(0);
    await advance(1_000 + ROTATION_SEGMENT_MS + 10);
    const last = setCamera.mock.calls.at(-1)![0];
    expect(last.animationDuration).toBe(ROTATION_SEGMENT_MS);
  });

  it('crosses the date line without wrapping (no spin the long way round)', async () => {
    const { setCamera } = await setup({ idleSince: 0, center: [-175, 0] });
    await advance(0);
    await advance(1_000 + ROTATION_SEGMENT_MS + 10);
    const longitudes = setCamera.mock.calls.map(([stop]) => stop.centerCoordinate[0]);
    expect(Math.min(...longitudes)).toBeLessThan(-180);
  });

  it('stops issuing camera moves when no longer allowed', async () => {
    const { setCamera, hook } = await setup({ idleSince: 0 });
    await advance(0);
    const calls = setCamera.mock.calls.length;
    await act(async () => hook.rerender({ allowed: false }));
    await advance(60_000);
    expect(setCamera.mock.calls.length).toBe(calls);
  });

  it('does nothing if the centre arrives after it was cancelled', async () => {
    let resolve: (center: Center) => void = () => {};
    const setCamera = jest.fn();
    const hook = await renderHook(
      (props: { allowed: boolean }) =>
        useAutoRotation({
          cameraRef: { current: { setCamera } } as never,
          getCenter: () => new Promise<Center>((r) => (resolve = r)),
          allowed: props.allowed,
          lastInteractionAt: 0,
        }),
      { initialProps: { allowed: true } },
    );
    await advance(0);
    await act(async () => hook.rerender({ allowed: false }));
    await act(async () => resolve([0, 0]));
    await advance(30_000);
    expect(setCamera).not.toHaveBeenCalled();
  });
});
