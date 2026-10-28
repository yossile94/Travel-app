import '@/i18n';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { AuthProvider } from '@/features/auth/AuthProvider';
import { clearViews } from '@/features/kit/policyFile';
import { startPassportAlerts } from '@/features/passportAlerts/passportRunner';
import { TripsProvider } from '@/features/trips/TripsProvider';

// Sprint 8 AC-9: a decrypted policy copy left from the last run goes at launch.
clearViews();
// Sprint 10 AC-12, AC-13: a save in the passport wallet checks the trips and plans the reminders.
startPassportAlerts();

export default function RootLayout() {
  return (
    <AuthProvider>
      <TripsProvider>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false }} />
      </TripsProvider>
    </AuthProvider>
  );
}
