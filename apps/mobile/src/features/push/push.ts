/**
 * Flight alerts on the device (sprint 6 F-018, ADR-011): the Android channel,
 * the permission, this device's Expo push token on the server, and the
 * account switch. Logs carry codes only: never the token.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { AndroidImportance, AndroidNotificationVisibility } from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

export const CHANNEL_ID = 'flight-changes';
const TOKEN_KEY = 'push-token';
/** The system prompt answered with anything but "allow": never asked again (Raz 4). */
const REFUSED_KEY = 'push-refused';
const explainerKey = (userId: string) => `push.explainer.${userId}`;
const pendingKey = (userId: string) => `push.consentPending.${userId}`;
const lastKnownKey = (userId: string) => `push.flightAlerts.${userId}`;
/** Re-register at most daily when nothing changed (Dudi 9): last_seen_at stays fresh for the 90 days. */
const REGISTER_EVERY_MS = 24 * 60 * 60_000;

/** This user's device keys, for an account deletion (Raz review 15). */
export const pushKeysOf = (userId: string) => [
  explainerKey(userId),
  pendingKey(userId),
  lastKnownKey(userId),
];

/** Between unregister and sign-out nothing registers this device again (Raz review 12). */
let leaving = false;
export function signedInAgain(): void {
  leaving = false;
}
/** The explainer shows at most twice per user on a device (design 2.2). */
export const ASK_MAX = 2;
/** Sign-out waits this long for the server (design 6.4). */
export const UNREGISTER_TIMEOUT_MS = 3000;

/**
 * Android 13+ shows the system prompt only once a channel exists (Raz 6), so
 * the channel comes first. Private on the lock screen: the flight number only
 * when unlocked (Raz 9). Called again on a language change: same id, new name.
 */
export async function ensureChannel(name: string, description: string): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name,
    description,
    importance: AndroidImportance.HIGH,
    lockscreenVisibility: AndroidNotificationVisibility.PRIVATE,
    // No `sound`: left out, Android uses the system's default sound; a value
    // is a custom file's name, so 'default' logs "custom sound not found".
    showBadge: false,
  });
}

export type PermissionState = 'granted' | 'denied' | 'undetermined';

/** The system's answer; a prompt refused once counts as final (Raz 4). */
export async function permissionState(): Promise<PermissionState> {
  const [p, refused] = await Promise.all([
    Notifications.getPermissionsAsync(),
    AsyncStorage.getItem(REFUSED_KEY).catch(() => null),
  ]);
  if (p.granted) return 'granted';
  return p.canAskAgain && !refused ? 'undetermined' : 'denied';
}

/** The "flight changes" channel turned off in Android's settings. */
export async function channelEnabled(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    const channel = await Notifications.getNotificationChannelAsync(CHANNEL_ID);
    return !channel || channel.importance !== AndroidImportance.NONE;
  } catch {
    return true;
  }
}

/** Android 13+ asks; below it, the explainer's "allow" is the consent (design 2.6). */
export const systemPrompts = () =>
  Platform.OS === 'android' && typeof Platform.Version === 'number' && Platform.Version >= 33;

/** After "allow": the system prompt where there is one. Anything but "granted" is final. */
export async function requestPermission(): Promise<PermissionState> {
  const p = await Notifications.requestPermissionsAsync();
  if (p.granted) return 'granted';
  await AsyncStorage.setItem(REFUSED_KEY, '1').catch(() => {});
  return 'denied';
}

export interface ExplainerState {
  shown: number;
  /** "Allow" answered on this device by this user. */
  allowed: boolean;
}

export async function explainerState(userId: string): Promise<ExplainerState> {
  try {
    const raw = await AsyncStorage.getItem(explainerKey(userId));
    const s = raw ? (JSON.parse(raw) as Partial<ExplainerState>) : {};
    return { shown: s.shown ?? 0, allowed: s.allowed === true };
  } catch {
    return { shown: 0, allowed: false };
  }
}

async function saveExplainer(userId: string, next: ExplainerState): Promise<void> {
  await AsyncStorage.setItem(explainerKey(userId), JSON.stringify(next)).catch(() => {});
}

/** Every showing counts, however it closes (design 2.2). */
export async function recordShown(userId: string): Promise<void> {
  const prev = await explainerState(userId);
  await saveExplainer(userId, { ...prev, shown: prev.shown + 1 });
}

/**
 * Whether to show the explainer now (design 2.2): a trigger, alerts not yet
 * on, no system refusal, fewer than two showings, once a session, nothing
 * else on screen.
 */
export function shouldOfferPush(s: {
  trigger: boolean;
  flightAlerts: boolean | null;
  allowedHere: boolean;
  shown: number;
  permission: PermissionState;
  shownThisSession: boolean;
  quiet: boolean;
}): boolean {
  return (
    s.trigger &&
    s.flightAlerts !== true &&
    !s.allowedHere &&
    s.permission !== 'denied' &&
    s.shown < ASK_MAX &&
    !s.shownThisSession &&
    s.quiet
  );
}

export type PushRow = 'loading' | 'never_asked' | 'on' | 'off' | 'blocked' | 'not_connected';

/** The account row (design 6.2): what this device gets, and why. */
export function pushRowState(s: {
  flightAlerts: boolean | null;
  permission: PermissionState;
  channelEnabled: boolean;
  tokenRegistered: boolean;
  consentPending: boolean;
  allowedHere: boolean;
}): PushRow {
  if (s.flightAlerts === null && !s.consentPending) return 'loading';
  // No permission: this device gets nothing, whatever the server says.
  if (s.permission === 'denied' || (s.permission === 'granted' && !s.channelEnabled)) {
    return 'blocked';
  }
  const on = s.flightAlerts === true || s.consentPending;
  if (on && s.permission === 'granted') return s.tokenRegistered ? 'on' : 'not_connected';
  if (on) return 'never_asked';
  return s.allowedHere ? 'off' : 'never_asked';
}

export async function consentPending(userId: string): Promise<boolean> {
  return (await AsyncStorage.getItem(pendingKey(userId)).catch(() => null)) === '1';
}

function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId;
}

interface StoredToken {
  userId: string;
  token: string;
  locale?: string;
  at?: number;
}

async function storedToken(): Promise<StoredToken | null> {
  try {
    const raw = await AsyncStorage.getItem(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as StoredToken) : null;
  } catch {
    return null;
  }
}

/** This device's token is on the server for this user. */
export async function tokenRegistered(userId: string): Promise<boolean> {
  return (await storedToken())?.userId === userId;
}

/**
 * This device's token on the server (AC-2): on launch while allowed, when
 * the token or the language changes, and otherwise at most once a day.
 */
export async function registerDevice(
  userId: string,
  locale: string,
  force = false,
): Promise<boolean> {
  if (!supabase || leaving) return false;
  if ((await permissionState()) !== 'granted') return false;
  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: projectId() });
    const lang = locale === 'en' ? 'en' : 'he';
    const prev = await storedToken();
    const fresh =
      prev?.userId === userId &&
      prev.token === token &&
      prev.locale === lang &&
      Date.now() - (prev.at ?? 0) < REGISTER_EVERY_MS;
    if (fresh && !force) return true;
    const { error } = await supabase.rpc('register_push_token', {
      p_token: token,
      p_platform: Platform.OS === 'ios' ? 'ios' : 'android',
      p_locale: lang,
    });
    if (error) {
      console.error('[push] register failed', error.code ?? 'no code');
      return false;
    }
    if (leaving) return false;
    const stored: StoredToken = { userId, token, locale: lang, at: Date.now() };
    await AsyncStorage.setItem(TOKEN_KEY, JSON.stringify(stored)).catch(() => {});
    return true;
  } catch (error) {
    // Offline, or Expo's servers: the next launch tries again.
    // The name and the module's code only: the message may carry device details.
    const e = error as { name?: string; code?: unknown };
    console.warn('[push] token unavailable', e?.name ?? 'no name', String(e?.code ?? 'no code'));
    return false;
  }
}

/** The account switch (AC-7): the server checks it before every send. */
export async function setFlightAlerts(userId: string, on: boolean): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from('profiles').update({ flight_alerts: on }).eq('id', userId);
  if (error) {
    console.error('[push] switch failed', error.code ?? 'no code');
    return false;
  }
  // The server has the user's latest word: a consent still waiting must not undo it (Raz review 3).
  await AsyncStorage.multiRemove([pendingKey(userId)]).catch(() => {});
  await AsyncStorage.setItem(lastKnownKey(userId), on ? '1' : '0').catch(() => {});
  return true;
}

export async function flightAlertsOn(userId: string): Promise<boolean | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('flight_alerts')
    .eq('id', userId)
    .maybeSingle();
  if (error || !data) {
    // Offline: the last value this device saw (Raz review 10).
    const last = await AsyncStorage.getItem(lastKnownKey(userId)).catch(() => null);
    return last === null ? null : last === '1';
  }
  const on = (data as { flight_alerts: boolean }).flight_alerts;
  await AsyncStorage.setItem(lastKnownKey(userId), on ? '1' : '0').catch(() => {});
  return on;
}

/**
 * The consent, kept on the device until the server has it (design 2.6): the
 * switch on, then this device's token. Run on "allow" and on every launch.
 */
export async function syncConsent(userId: string, locale: string): Promise<void> {
  if (await consentPending(userId)) {
    if (!(await setFlightAlerts(userId, true))) return;
  }
  const [allowed, on] = await Promise.all([explainerState(userId), flightAlertsOn(userId)]);
  if (on === true || (on === null && allowed.allowed)) await registerDevice(userId, locale);
}

/**
 * "Allow" (design 2.6, 6.2 never_asked): the channel, the system prompt on
 * Android 13+, then the consent. Without "allow" no token and no switch (AC-1).
 */
export async function allowPush(
  userId: string,
  locale: string,
  channel: { name: string; description: string },
): Promise<'on' | 'refused' | 'blocked'> {
  await ensureChannel(channel.name, channel.description);
  let permission = await permissionState();
  if (permission === 'undetermined' && systemPrompts()) permission = await requestPermission();
  if (permission === 'denied' && systemPrompts()) return 'refused';
  const prev = await explainerState(userId);
  await saveExplainer(userId, { ...prev, allowed: true });
  await AsyncStorage.setItem(pendingKey(userId), '1').catch(() => {});
  await syncConsent(userId, locale);
  // Android 12 and below: the app's alerts turned off in the settings.
  return permission === 'granted' && (await channelEnabled()) ? 'on' : 'blocked';
}

async function withTimeout<T>(work: PromiseLike<T>, ms: number): Promise<T | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'timeout'>((r) => (timer = setTimeout(() => r('timeout'), ms)));
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Before sign-out, while the session still holds (Raz 11), 3 s at most. If
 * the server can't be told, the device stops taking Push at all (Raz 5): the
 * token's next receipt says DeviceNotRegistered and the server drops it.
 */
export async function unregisterDevice(): Promise<void> {
  leaving = true;
  const stored = await storedToken();
  if (!stored) return;
  let done = false;
  try {
    const result = supabase
      ? await withTimeout(
          supabase.rpc('unregister_push_token', { p_token: stored.token }),
          UNREGISTER_TIMEOUT_MS,
        )
      : 'timeout';
    done = result !== 'timeout' && !result.error;
  } catch {
    done = false;
  }
  if (!done) await Notifications.unregisterForNotificationsAsync().catch(() => {});
  await AsyncStorage.removeItem(TOKEN_KEY).catch(() => {});
}

/** A notification tapped (or the one that opened the app): the user's own flight row. */
export function flightIdOf(
  response: Notifications.NotificationResponse | null | undefined,
): string | null {
  const data = response?.notification.request.content.data as
    { v?: unknown; type?: string; flightId?: unknown } | undefined;
  return data?.v === 1 && data.type === 'flight_change' && typeof data.flightId === 'string'
    ? data.flightId
    : null;
}
