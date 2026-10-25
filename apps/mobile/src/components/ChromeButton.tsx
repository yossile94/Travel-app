/**
 * Round 48×48 button over the globe (sprint 1 design 7.1): an opaque-enough
 * "glass" without blur, which costs frames over Mapbox's surface on Android.
 */
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { colors, layout, radius, type ColorScheme } from '@/theme/tokens';

interface Props {
  colorScheme: ColorScheme;
  accessibilityLabel: string;
  onPress: () => void;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function ChromeButton({
  colorScheme,
  accessibilityLabel,
  onPress,
  children,
  style,
  testID,
}: Props) {
  const palette = colors[colorScheme];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      android_ripple={{
        color: palette.pressed,
        borderless: true,
        radius: layout.touchTargetMin / 2,
      }}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: palette.chromeBg,
          borderColor: palette.chromeBorder,
          borderWidth: colorScheme === 'dark' ? 1 : 0,
          elevation: colorScheme === 'dark' ? 0 : 2,
          transform: [{ scale: pressed ? 0.96 : 1 }],
        },
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: layout.touchTargetMin,
    height: layout.touchTargetMin,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
