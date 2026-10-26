/**
 * "My trips" over the globe (sprint 2 design 1): a pill in the thumb zone,
 * shown signed in or out (signed out, it opens sign-in: AC-5). It steps
 * aside while a card, search, a sheet or a full screen is open.
 */
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { SuitcaseIcon } from '@/components/icons';
import { colors, fonts, layout, motion, radius, type ColorScheme } from '@/theme/tokens';

const DECELERATE = Easing.bezier(0.05, 0.7, 0.1, 1);
const ACCELERATE = Easing.bezier(0.3, 0, 1, 1);

export function TripsButton({
  visible,
  colorScheme,
  reduceMotion,
  bottomInset,
  onPress,
}: {
  visible: boolean;
  colorScheme: ColorScheme;
  reduceMotion: boolean;
  bottomInset: number;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const palette = colors[colorScheme];
  const shown = useSharedValue(0);
  useEffect(() => {
    shown.set(
      withTiming(visible ? 1 : 0, {
        duration: reduceMotion ? motion.short : visible ? 320 : motion.short,
        easing: reduceMotion ? Easing.linear : visible ? DECELERATE : ACCELERATE,
        reduceMotion: ReduceMotion.Never,
      }),
    );
  }, [visible, reduceMotion, shown]);
  const style = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: reduceMotion ? [] : [{ translateY: (1 - shown.value) * 80 }],
  }));

  return (
    <Animated.View
      style={[styles.wrap, { bottom: bottomInset + layout.tripsButtonBottom }, style]}
      pointerEvents={visible ? 'box-none' : 'none'}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('myTrips.button')}
        onPress={onPress}
        style={({ pressed }) => [
          styles.pill,
          {
            backgroundColor: palette.chromeBg,
            borderColor: palette.chromeBorder,
            borderWidth: colorScheme === 'dark' ? 1 : 0,
            elevation: colorScheme === 'dark' ? 0 : 2,
            transform: [{ scale: pressed ? 0.96 : 1 }],
          },
        ]}
        testID="my-trips-button"
      >
        <SuitcaseIcon color={palette.chromeFg} />
        <Text style={[styles.label, { color: palette.chromeFg }]} maxFontSizeMultiplier={1.6}>
          {t('myTrips.button')}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', start: 0, end: 0, alignItems: 'center' },
  pill: {
    minHeight: layout.touchTargetMin,
    paddingHorizontal: 20,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  label: { fontFamily: fonts.medium, fontSize: 16, lineHeight: 22 },
});
