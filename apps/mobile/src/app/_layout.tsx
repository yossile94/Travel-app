import '@/i18n';

import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AuthProvider } from '@/features/auth/AuthProvider';
import { clearViews } from '@/features/kit/policyFile';
import { LaunchOverlay } from '@/features/launch/LaunchOverlay';
import { launchShown } from '@/features/launch/launchSignals';
import { vault } from '@/features/passport/vault';
import { startPassportAlerts } from '@/features/passportAlerts/passportRunner';
import { TripsProvider } from '@/features/trips/TripsProvider';

// Sprint 12 design 1.3 (Raz 2): the system splash stays until the launch
// overlay's first frame is drawn. Both look the same, so no system fade.
void SplashScreen.preventAutoHideAsync().catch(() => {});
SplashScreen.setOptions({ fade: false });
// Sprint 8 AC-9: a decrypted policy copy left from the last run goes at launch.
clearViews();
// Sprint 10 AC-2 (Raz review, important 3): a passport photo left in the cache by a kill goes.
void vault.clearCaptures().catch(() => {});
// Sprint 10 AC-12, AC-13: a save in the passport wallet checks the trips and plans the reminders.
startPassportAlerts();

export default function RootLayout() {
  // A warm start (the JS still alive) shows no overlay (design 1.5).
  const [overlay, setOverlay] = useState(() => !launchShown.get());
  // While the overlay is opaque, the screens under it are hidden from TalkBack (design 1.6, Raz 9).
  const [covered, setCovered] = useState(overlay);
  useEffect(() => {
    // Every mount hides the system splash, so a recreated Activity never sticks on it (design 1.3).
    if (!overlay) SplashScreen.hide();
    // Mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthProvider>
      <TripsProvider>
        <StatusBar style="auto" />
        <View
          style={styles.fill}
          importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}
          accessibilityElementsHidden={covered}
        >
          <Stack screenOptions={{ headerShown: false }} />
        </View>
        {overlay && (
          <LaunchOverlay onFadeStart={() => setCovered(false)} onGone={() => setOverlay(false)} />
        )}
      </TripsProvider>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
