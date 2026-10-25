import Mapbox from '@rnmapbox/maps';

/**
 * The Mapbox public token comes from EXPO_PUBLIC_MAPBOX_TOKEN: .env.local on
 * the developer's machine, Expo environment variables for cloud builds
 * (docs/setup/accounts.md). It is a public pk. token, safe in the app bundle.
 */
const token = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;

export const hasMapboxToken = typeof token === 'string' && token.startsWith('pk.');

if (hasMapboxToken) {
  void Mapbox.setAccessToken(token!);
} else if (__DEV__) {
  console.warn('EXPO_PUBLIC_MAPBOX_TOKEN is missing or not a public (pk.) token.');
}

let telemetryTurnedOff = false;

/**
 * Sprint 1 AC-14 (Yossi, 2026-10-23): no usage telemetry to Mapbox, so it
 * need not appear in the privacy policy. Map-load billing events still go
 * out. On Android the call builds a throwaway map view, so it is never made
 * at startup: once per session, after the globe has drawn its first frame.
 */
export function turnOffMapboxTelemetryOnce(): void {
  if (!hasMapboxToken || telemetryTurnedOff) return;
  telemetryTurnedOff = true;
  try {
    Mapbox.setTelemetryEnabled(false);
  } catch (error) {
    console.error('[globe] could not turn Mapbox telemetry off', error);
  }
}
