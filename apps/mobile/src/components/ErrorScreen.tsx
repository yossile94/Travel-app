/**
 * v0.14.1 (Raz 2): what the app shows when a screen throws while rendering,
 * instead of closing. expo-router renders it through the root layout's
 * ErrorBoundary export; "try again" re-renders the screens.
 */
import type { ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, useColorScheme, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/fields';
import { colors } from '@/theme/tokens';

export function ErrorScreen({ error, retry }: ErrorBoundaryProps) {
  const { t } = useTranslation();
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const p = colors[scheme];
  const insets = useSafeAreaInsets();
  useEffect(() => {
    // Dana R3: an error before the launch overlay must not leave the system splash up.
    SplashScreen.hide();
    // The kind only: a message can carry what the user typed.
    console.error('[app] render error', error.name);
  }, [error]);
  return (
    <View
      style={[styles.screen, { backgroundColor: p.canvas, paddingTop: insets.top + 32 }]}
      testID="error-screen"
    >
      <Text style={[styles.title, { color: p.textPrimary }]} accessibilityRole="header">
        {t('appError.title')}
      </Text>
      <Text style={[styles.body, { color: p.textSecondary }]}>{t('appError.body')}</Text>
      <Button
        kind="primary"
        label={t('appError.retry')}
        onPress={() => void retry()}
        colorScheme={scheme}
        testID="error-retry"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 24, gap: 16 },
  title: { fontSize: 22, fontWeight: '700' },
  body: { fontSize: 17, lineHeight: 24 },
});
