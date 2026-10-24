/**
 * The Supabase client (sprint 1 F-003a). URL and publishable key are public
 * values from EXPO_PUBLIC_* (like the Mapbox pk. token); the session is kept
 * encrypted (secureSessionStorage). Without configuration the app still runs:
 * the globe and search need no account, and the account button stays hidden.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

import { secureSessionStorage } from './secureSessionStorage';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_KEY;

export const supabase: SupabaseClient | null =
  url && key && !key.startsWith('sb_secret_')
    ? createClient(url, key, {
        auth: {
          storage: secureSessionStorage,
          autoRefreshToken: true,
          persistSession: true,
          // Native app: no session in a URL to pick up.
          detectSessionInUrl: false,
        },
      })
    : null;

if (!supabase && __DEV__) {
  console.warn('EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_KEY missing: sign-in is off.');
}

// Refresh tokens only while the app is in front, as Supabase recommends for
// React Native; a backgrounded app doesn't need a live session.
if (supabase) {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') void supabase.auth.startAutoRefresh();
    else void supabase.auth.stopAutoRefresh();
  });
}
