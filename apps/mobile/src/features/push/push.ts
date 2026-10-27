/**
 * Flight alerts on the device (sprint 6 F-018, ADR-011): the Android channel,
 * the permission, this device's Expo push token on the server, and the
 * account switch. Logs carry codes only: never the token.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

export const CHANNEL_ID = 'flight-changes';
const TOKEN_KEY = 'push-token';
const ASKED_KEY = 'push-asked';
/** "Not now" brings the explainer back, at most twice (Raz 6). */
export const ASK_MAX = 2;

/**
 * Android 13+ shows the system prompt only once a channel exists (Raz 6), so
 * the channel comes first. Private on the lock screen: the flight number only
 * when unlocked (Raz 9).
 */
export async function ensureChannel(name: string, description: string): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name,
    description,
    importance: Notifications.AndroidImportance.HIGH,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    sound: 'default',
  });
}

export type PermissionState = 'granted' | 'denied' | 'undetermined';

export async function permissionState(): Promise<PermissionState> {
  const p = await Notifications.getPermissionsAsync();
  if (p.granted) return 'granted';
  return p.canAskAgain ? 'undetermined' : 'denied';
}

/** After the explainer's "allow": the system prompt where there is one (Android 13+). */
export async function requestPermission(): Promise<PermissionState> {
  const p = await Notifications.requestPermissionsAsync();
  if (p.granted) return 'granted';
  return p.canAskAgain ? 'undetermined' : 'denied';
}

/** How often the explainer was shown, and whether the user allowed it. */
export async function askedState(): Promise<{ shown: number; allowed: boolean }> {
  try {
    const raw = await AsyncStorage.getItem(ASKED_KEY);
    return raw
      ? (JSON.parse(raw) as { shown: number; allowed: boolean })
      : { shown: 0, allowed: false };
  } catch {
    return { shown: 0, allowed: false };
  }
}

export async function recordAsked(allowed: boolean): Promise<void> {
  const prev = await askedState();
  await AsyncStorage.setItem(ASKED_KEY, JSON.stringify({ shown: prev.shown + 1, allowed })).catch(
    () => {},
  );
}

/** Whether to show the explainer now (AC-1): never after "allow", a system refusal, or twice "not now". */
export async function shouldAsk(): Promise<boolean> {
  const [asked, state] = await Promise.all([askedState(), permissionState()]);
  if (state === 'denied') return false;
  if (state === 'granted' && asked.allowed) return false;
  return !asked.allowed && asked.shown < ASK_MAX;
}

function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId;
}

/**
 * This device's token on the server (AC-2), on every launch while allowed;
 * the explainer's "allow" counts as consent on Android 12 and below.
 */
export async function registerDevice(locale: string): Promise<boolean> {
  if (!supabase) return false;
  const [state, asked] = await Promise.all([permissionState(), askedState()]);
  if (state !== 'granted' || !asked.allowed) return false;
  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: projectId() });
    const { error } = await supabase.rpc('register_push_token', {
      p_token: token,
      p_platform: Platform.OS === 'ios' ? 'ios' : 'android',
      p_locale: locale === 'en' ? 'en' : 'he',
    });
    if (error) {
      console.error('[push] register failed', error.code ?? 'no code');
      return false;
    }
    await AsyncStorage.setItem(TOKEN_KEY, token).catch(() => {});
    return true;
  } catch (error) {
    // Offline, or Expo's servers: the next launch tries again.
    console.warn('[push] token unavailable', (error as Error)?.name ?? 'no name');
    return false;
  }
}

/** Before sign-out, while the session still holds (Raz 11). */
export async function unregisterDevice(): Promise<void> {
  try {
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    if (!token || !supabase) return;
    await supabase.rpc('unregister_push_token', { p_token: token });
    await AsyncStorage.removeItem(TOKEN_KEY);
  } catch {
    // The next sign-in on this device moves the token anyway.
  }
}

/** The account switch (AC-7): the server checks it before every send. */
export async function setFlightAlerts(userId: string, on: boolean): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from('profiles').update({ flight_alerts: on }).eq('id', userId);
  if (error) console.error('[push] switch failed', error.code ?? 'no code');
  return !error;
}

export async function flightAlertsOn(userId: string): Promise<boolean | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('flight_alerts')
    .eq('id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { flight_alerts: boolean }).flight_alerts;
}

/** A notification tapped (or the one that opened the app): the user's own flight row. */
export function flightIdOf(
  response: Notifications.NotificationResponse | null | undefined,
): string | null {
  const data = response?.notification.request.content.data as
    { type?: string; flightId?: unknown } | undefined;
  return data?.type === 'flight_change' && typeof data.flightId === 'string' ? data.flightId : null;
}
