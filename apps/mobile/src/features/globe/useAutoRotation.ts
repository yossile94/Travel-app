import type { Camera } from '@rnmapbox/maps';
import { useEffect, useRef, type ComponentRef } from 'react';

import { motion } from '@/theme/tokens';

import { rotationPlan } from './camera';

interface Options {
  cameraRef: React.RefObject<ComponentRef<typeof Camera> | null>;
  /** Current camera centre, read when rotation (re)starts. */
  getCenter: () => Promise<[number, number] | null>;
  /** False while a card is open, a finger or flight is on the globe, or motion is reduced. */
  allowed: boolean;
  /** Timestamp of the last touch on the globe or of the card closing. */
  lastInteractionAt: number;
}

/**
 * Idle auto-rotation (sprint 0 AC-2): starts 5 s after the last interaction,
 * eases in over 1 s, then turns steadily westward in long native camera
 * animations. A touch cancels the native animation by itself; the caller
 * stops it explicitly when reduced motion is switched on (AC-6).
 */
export function useAutoRotation({ cameraRef, getCenter, allowed, lastInteractionAt }: Options) {
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const clear = () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
    if (!allowed) {
      clear();
      return clear;
    }

    let cancelled = false;

    // Each plan continues from where the last one ends. Longitudes are not
    // wrapped at ±180°, so the native animation never takes the long way round
    // when it crosses the date line.
    const run = (start: [number, number], fromStop: boolean) => {
      let [lng] = start;
      const [, lat] = start;
      let delay = 0;
      for (const segment of rotationPlan(fromStop)) {
        lng -= segment.degrees;
        const target = lng;
        timers.current.push(
          setTimeout(() => {
            if (cancelled) return;
            cameraRef.current?.setCamera({
              centerCoordinate: [target, lat],
              animationMode: 'linearTo',
              animationDuration: segment.durationMs,
            });
          }, delay),
        );
        delay += segment.durationMs;
      }
      timers.current.push(
        setTimeout(() => {
          if (!cancelled) run([lng, lat], false);
        }, delay),
      );
    };

    const begin = async () => {
      let center: [number, number] | null = null;
      try {
        center = await getCenter();
      } catch {
        center = null;
      }
      if (!cancelled && center) run(center, true);
    };

    const idleFor = Date.now() - lastInteractionAt;
    timers.current.push(
      setTimeout(() => void begin(), Math.max(0, motion.autoRotateResumeDelay - idleFor)),
    );

    return () => {
      cancelled = true;
      clear();
    };
  }, [allowed, lastInteractionAt, cameraRef, getCenter]);
}
