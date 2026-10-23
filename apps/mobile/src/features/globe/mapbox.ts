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
