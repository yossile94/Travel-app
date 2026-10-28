import '@/i18n';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { AuthProvider } from '@/features/auth/AuthProvider';
import { clearViews } from '@/features/kit/policyFile';
import { TripsProvider } from '@/features/trips/TripsProvider';

// Sprint 8 AC-9: a decrypted policy copy left from the last run goes at launch.
clearViews();

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
