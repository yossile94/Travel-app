/**
 * Modal bottom sheet (sprint 1 design 7.6): slides up over a scrim, closes
 * with Android back, a tap on the scrim or the × button. As a Modal it sits
 * above everything and receives "back" first, which gives the screen's back
 * order for free (design 5.5). `dismissable={false}` holds it open while a
 * sign-in is being exchanged.
 */
import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { colors, layout, motion, radius, type ColorScheme } from '@/theme/tokens';

interface Props {
  visible: boolean;
  colorScheme: ColorScheme;
  reduceMotion: boolean;
  insetsBottom: number;
  dismissable?: boolean;
  /** The sheet grows with its content up to this height; a list inside then scrolls (sprint 2 design 5.1). */
  maxHeight?: number;
  /** Android back, when it means something other than closing (sprint 2 design 8.2, 12). */
  onBack?: () => void;
  onClose: () => void;
  children: ReactNode;
  testID?: string;
}

const DECELERATE = Easing.bezier(0.05, 0.7, 0.1, 1);

export function BottomSheet({
  visible,
  colorScheme,
  reduceMotion,
  insetsBottom,
  dismissable = true,
  maxHeight,
  onBack,
  onClose,
  children,
  testID,
}: Props) {
  const { t } = useTranslation();
  const palette = colors[colorScheme];
  const progress = useSharedValue(0);

  useEffect(() => {
    if (!visible) return;
    progress.set(0);
    progress.set(
      withTiming(1, {
        duration: reduceMotion ? motion.short : motion.sheet,
        easing: reduceMotion ? Easing.linear : DECELERATE,
        reduceMotion: ReduceMotion.Never,
      }),
    );
  }, [visible, reduceMotion, progress]);

  const sheetStyle = useAnimatedStyle(() =>
    reduceMotion
      ? { opacity: progress.value }
      : { transform: [{ translateY: (1 - progress.value) * 400 }] },
  );
  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value }));

  const requestClose = () => {
    if (dismissable) onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType="none"
      onRequestClose={onBack ?? requestClose}
    >
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: palette.scrim }, scrimStyle]}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={requestClose}
          accessible={false}
          importantForAccessibility="no"
          testID={testID ? `${testID}-scrim` : undefined}
        />
      </Animated.View>
      <Animated.View
        style={[
          styles.sheet,
          { backgroundColor: palette.surfaceRaised, paddingBottom: insetsBottom + 16, maxHeight },
          sheetStyle,
        ]}
        accessibilityViewIsModal
        testID={testID}
      >
        <View style={[styles.handle, { backgroundColor: palette.borderControl }]} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('sheet.close')}
          accessibilityState={{ disabled: !dismissable }}
          onPress={requestClose}
          style={styles.close}
          testID={testID ? `${testID}-close` : undefined}
        >
          <Svg width={20} height={20} viewBox="0 0 24 24">
            <Path
              d="M6 6l12 12M18 6L6 18"
              stroke={palette.textPrimary}
              strokeWidth={2.2}
              strokeLinecap="round"
              opacity={dismissable ? 1 : 0.38}
            />
          </Svg>
        </Pressable>
        {children}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    start: 0,
    end: 0,
    bottom: 0,
    borderTopStartRadius: radius.sheet,
    borderTopEndRadius: radius.sheet,
    paddingTop: 12,
    paddingHorizontal: 16,
  },
  handle: { alignSelf: 'center', width: 32, height: 4, borderRadius: 2, marginBottom: 4 },
  close: {
    position: 'absolute',
    top: 8,
    end: 8,
    width: layout.touchTargetMin,
    height: layout.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
});
