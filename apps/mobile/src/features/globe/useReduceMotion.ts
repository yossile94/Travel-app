import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * The device's reduce-motion setting (on Android: Accessibility → "Remove
 * animations"), live-updated (sprint 0 AC-6). `null` until it is known, so
 * callers can hold motion back instead of starting and then stopping it.
 */
export function useReduceMotion(): boolean | null {
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}
