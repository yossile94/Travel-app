/**
 * Sprint 14 F-043 (AC-1, AC-3; Raz design approval 4): Google's attribution
 * wherever content from Places shows. Its own file, so the offline driver card
 * doesn't load the search, and so the official logo replaces the text here
 * alone (a recorded gap: before the Places key goes live, by v1.0.0).
 */
import { StyleSheet, Text } from 'react-native';

import { isolateLtr } from '@/features/globe/BoardingPassCard';
import { colors, fonts, type ColorScheme } from '@/theme/tokens';

/** "Google Maps", untranslated, left to right. */
export function GoogleAttribution({ colorScheme }: { colorScheme: ColorScheme }) {
  const p = colors[colorScheme];
  return (
    <Text
      style={[styles.attribution, { color: p.textSecondary }]}
      accessibilityLabel="Google Maps"
      testID="google-attribution"
    >
      {isolateLtr('Google Maps')}
    </Text>
  );
}

const styles = StyleSheet.create({
  // Intentional: the end side; React Native mirrors 'right' in RTL (design 1.3).
  attribution: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, textAlign: 'right' },
});
