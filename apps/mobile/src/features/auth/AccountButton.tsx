/**
 * The account button in the home screen's corner (sprint 1 AC-15, design 3.1):
 * a person icon when signed out, the first letter of the name when signed in.
 * Never Google's photo: no extra personal data, works offline, no flicker.
 */
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { ChromeButton } from '@/components/ChromeButton';
import { colors, fonts, type ColorScheme } from '@/theme/tokens';

import type { AuthUser } from './AuthProvider';

export function initialOf(user: AuthUser): string | null {
  const source = (user.name ?? user.email ?? '').trim();
  return source ? source[0]!.toLocaleUpperCase() : null;
}

export function AccountButton({
  user,
  colorScheme,
  top,
  onPress,
}: {
  user: AuthUser | null;
  colorScheme: ColorScheme;
  top: number;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const palette = colors[colorScheme];
  const initial = user ? initialOf(user) : null;
  return (
    <ChromeButton
      colorScheme={colorScheme}
      accessibilityLabel={
        user ? t('account.yours', { name: user.name ?? user.email ?? '' }) : t('account.signIn')
      }
      onPress={onPress}
      style={[styles.position, { top }]}
      testID="account-button"
    >
      {initial ? (
        <View style={[styles.avatar, { backgroundColor: palette.primary }]}>
          <Text style={[styles.initial, { color: palette.onPrimary }]}>{initial}</Text>
        </View>
      ) : (
        <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
          <Circle cx={12} cy={8.5} r={4} stroke={palette.chromeFg} strokeWidth={2} />
          <Path
            d="M4.5 20c1.2-3.6 4.1-5.5 7.5-5.5s6.3 1.9 7.5 5.5"
            stroke={palette.chromeFg}
            strokeWidth={2}
            strokeLinecap="round"
          />
        </Svg>
      )}
    </ChromeButton>
  );
}

const styles = StyleSheet.create({
  // Opposite the search button: the end side (left in Hebrew), design 1.
  position: { position: 'absolute', end: 12 },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: { fontFamily: fonts.semibold, fontSize: 18, lineHeight: 24 },
});
