/**
 * Sprint 12 P-3 (polish-audit 3): a switch drawn by the app, for a row that is
 * itself the control. A pill, filled with a white thumb and a check when on,
 * outlined with a small grey thumb when off; it reads the same on both
 * platforms. Display only: the row takes the tap and carries the role, state
 * and label, so this is hidden from the screen reader and lets touches through.
 */
import { I18nManager, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  withTiming,
} from 'react-native-reanimated';

import { CheckIcon } from '@/components/icons';
import { colors, motion, radius, type ColorScheme } from '@/theme/tokens';

/** design-system 5.2 `standard`. */
const STANDARD = Easing.bezier(0.2, 0, 0, 1);
const TRACK = { width: 52, height: 32 };
const THUMB_OFF = 16;
const THUMB_ON = 24;
/**
 * Both thumbs are centred 16dp from their end of the track (20dp apart). The
 * thumb grows from its start edge, so that edge moves 20 minus half the growth.
 */
const TRAVEL = TRACK.width - 2 * 16 - (THUMB_ON - THUMB_OFF) / 2;

export function SwitchVisual({
  on,
  colorScheme,
  opacity = 1,
  testID,
}: {
  on: boolean;
  colorScheme: ColorScheme;
  /** 0.38 while loading, 0.5 blocked or offline, otherwise 1 (polish-audit 3). */
  opacity?: number;
  testID?: string;
}) {
  const p = colors[colorScheme];
  const reduceMotion = useReducedMotion();
  const timing = {
    duration: reduceMotion ? 0 : motion.short,
    easing: STANDARD,
  };
  // translateX keeps its physical axis in RTL, so "on" moves left in Hebrew (Raz 9).
  const travel = I18nManager.isRTL ? -TRAVEL : TRAVEL;
  const fillStyle = useAnimatedStyle(() => ({ opacity: withTiming(on ? 1 : 0, timing) }));
  const thumbStyle = useAnimatedStyle(() => {
    const size = withTiming(on ? THUMB_ON : THUMB_OFF, timing);
    return {
      width: size,
      height: size,
      transform: [{ translateX: withTiming(on ? travel : 0, timing) }],
    };
  });

  return (
    <View
      testID={testID}
      // For tests only: the element is hidden from the screen reader.
      accessibilityValue={{ text: on ? 'on' : 'off' }}
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[styles.track, { borderColor: on ? p.primary : p.borderControl, opacity }]}
    >
      {/* Raz 7: the fill fades in and out, so the track passes between the colours. */}
      <Animated.View style={[styles.fill, { backgroundColor: p.primary }, fillStyle]} />
      <Animated.View
        style={[styles.thumb, { backgroundColor: on ? p.onPrimary : p.borderControl }, thumbStyle]}
      >
        {on ? <CheckIcon color={p.primary} size={16} /> : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    ...TRACK,
    borderRadius: radius.pill,
    borderWidth: 2,
    justifyContent: 'center',
  },
  fill: {
    position: 'absolute',
    top: -2,
    bottom: -2,
    start: -2,
    end: -2,
    borderRadius: radius.pill,
  },
  // Centred 16dp from the start edge, inside the 2dp border.
  thumb: {
    position: 'absolute',
    start: 16 - 2 - THUMB_OFF / 2,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
