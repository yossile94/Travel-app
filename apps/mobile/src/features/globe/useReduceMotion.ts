import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * The device's reduce-motion setting (on Android: Accessibility → "Remove
 * animations"), live-updated (sprint 0 AC-6).
 */
export function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

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
