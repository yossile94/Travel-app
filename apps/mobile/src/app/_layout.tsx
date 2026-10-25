import '@/i18n';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { AuthProvider } from '@/features/auth/AuthProvider';
import { TripsProvider } from '@/features/trips/TripsProvider';

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
