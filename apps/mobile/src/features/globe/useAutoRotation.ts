import type { Camera } from '@rnmapbox/maps';
import { useEffect, useRef, type ComponentRef } from 'react';

import { motion } from '@/theme/tokens';

import { rotationPlan, westOf } from './camera';

interface Options {
  cameraRef: React.RefObject<ComponentRef<typeof Camera> | null>;
  /** Current camera centre, read when a new plan starts. */
  getCenter: () => Promise<[number, number] | null>;
  /** False while a card is open, a gesture or flight is in progress, or motion is reduced. */
  allowed: boolean;
  /** Timestamp of the last touch on the globe or of the card closing. */
  lastInteractionAt: number;
}

/**
 * Idle auto-rotation (sprint 0 AC-2): starts 5 s after the last interaction,
 * eases in over 1 s, then turns steadily westward. Drives the camera with a
 * few long native animations rather than a per-frame update; a user gesture
 * cancels the native animation by itself.
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

    const runPlan = async () => {
      const center = await getCenter();
      if (cancelled || !center) return;
      let [lng] = center;
      const [, lat] = center;
      let delay = 0;
      const plan = rotationPlan();
      plan.forEach((segment, i) => {
        const target = westOf(lng, segment.degrees);
        lng = target;
        timers.current.push(
          setTimeout(() => {
            if (cancelled) return;
            cameraRef.current?.setCamera({
              centerCoordinate: [target, lat],
              animationMode: 'linearTo',
              animationDuration: segment.durationMs,
            });
            // When the long segment ends, start again from wherever the camera is.
            if (i === plan.length - 1) {
              timers.current.push(setTimeout(() => void runPlan(), segment.durationMs));
            }
          }, delay),
        );
        delay += segment.durationMs;
      });
    };

    const idleFor = Date.now() - lastInteractionAt;
    timers.current.push(
      setTimeout(() => void runPlan(), Math.max(0, motion.autoRotateResumeDelay - idleFor)),
    );

    return () => {
      cancelled = true;
      clear();
    };
  }, [allowed, lastInteractionAt, cameraRef, getCenter]);
}
