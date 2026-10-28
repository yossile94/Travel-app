/**
 * Sprint 10 AC-12, AC-13 (D9, design 7): the passport's local notifications.
 * Outside features/passport on purpose: that module may not import
 * expo-notifications (D8). It gets only the holders and the trips, and the
 * notifications say no date, no number and no name.
 *
 *   passport-trip:{tripId}: at once, when a trip's state gets worse (red or
 *     orange), once per state; back to ok clears it.
 *   passport-expiry:{holderId}:{9|6|3}: at 09:00 local on the day 9, 6 and 3
 *     months before the expiry; a moment already past is not scheduled.
 *
 * Never asks for permission: without it nothing is scheduled (AC-12).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { AndroidImportance, AndroidNotificationVisibility } from 'expo-notifications';
import { Platform } from 'react-native';

import {
  addMonths,
  tripPassports,
  tripSeverity,
  validityMonths,
  type Holder,
} from '@/features/passport/passportModel';
import { fromPgDate, todayPg } from '@/features/trips/tripDates';

export const PASSPORT_CHANNEL_ID = 'passport';
const TRIP_PREFIX = 'passport-trip:';
const EXPIRY_PREFIX = 'passport-expiry:';
const NOTIFIED_KEY = 'passport.lastNotified';
export const REMINDER_MONTHS = [9, 6, 3] as const;

export interface AlertTrip {
  id: string;
  countryAdm0: string;
  startDate: string;
  endDate: string;
  travelers: readonly { name: string }[];
}

/** Everything the texts need, worked out by the caller in the app's language. */
export interface PassportTexts {
  channel: string;
  tripRed: (trip: AlertTrip) => { title: string; body: string };
  tripOrange: (trip: AlertTrip, months: number) => { title: string; body: string };
  soon: (months: number, isMe: boolean) => { title: string; body: string };
}

/** Design 7.3: the reminder moments still ahead, 09:00 device time. */
export function reminderPlan(expiry: string, now: Date): { months: number; at: Date }[] {
  const plan: { months: number; at: Date }[] = [];
  for (const months of REMINDER_MONTHS) {
    const at = fromPgDate(addMonths(expiry, -months));
    at.setHours(9, 0, 0, 0);
    if (at.getTime() > now.getTime()) plan.push({ months, at });
  }
  return plan;
}

async function permitted(): Promise<boolean> {
  try {
    return (await Notifications.getPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

async function ensureChannel(name: string) {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(PASSPORT_CHANNEL_ID, {
    name,
    importance: AndroidImportance.DEFAULT,
    lockscreenVisibility: AndroidNotificationVisibility.PRIVATE,
    showBadge: false,
  });
}

async function scheduledWith(prefix: string): Promise<string[]> {
  try {
    return (await Notifications.getAllScheduledNotificationsAsync())
      .map((n) => n.identifier)
      .filter((id) => id.startsWith(prefix));
  } catch {
    return [];
  }
}

/** AC-13: every holder's 9/6/3 reminders, cancelled and planned again. */
export async function syncExpiryReminders(
  holders: readonly Holder[],
  texts: PassportTexts,
  now = new Date(),
): Promise<number> {
  for (const id of await scheduledWith(EXPIRY_PREFIX)) {
    await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
  }
  if (!(await permitted())) return 0;
  await ensureChannel(texts.channel);
  let count = 0;
  for (const h of holders) {
    if (!h.expiry) continue;
    for (const { months, at } of reminderPlan(h.expiry, now)) {
      const text = texts.soon(months, h.isMe);
      await Notifications.scheduleNotificationAsync({
        identifier: `${EXPIRY_PREFIX}${h.id}:${months}`,
        content: { title: text.title, body: text.body, data: { v: 1, type: 'passport_expiry' } },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: at,
          channelId: PASSPORT_CHANNEL_ID,
        },
      });
      count++;
    }
  }
  return count;
}

async function readNotified(): Promise<Record<string, 'red' | 'orange'>> {
  try {
    const text = await AsyncStorage.getItem(NOTIFIED_KEY);
    return text ? (JSON.parse(text) as Record<string, 'red' | 'orange'>) : {};
  } catch {
    return {};
  }
}

/**
 * AC-12 (design 7.3): each upcoming trip against the holders; a trip whose
 * state got worse, or changed between red and orange, is told at once. Back to
 * ok: the record and the shown notification go. Trip ids only on the device.
 */
export async function checkTripPassports(
  trips: readonly AlertTrip[],
  holders: readonly Holder[],
  monthsOf: (adm0: string) => number | null | undefined,
  parentOf: (adm0: string) => string | undefined,
  texts: PassportTexts,
  now = new Date(),
): Promise<string[]> {
  const today = todayPg(now);
  const notified = await readNotified();
  const next: Record<string, 'red' | 'orange'> = {};
  const sent: string[] = [];
  const allowed = await permitted();
  for (const trip of trips) {
    const { months } = validityMonths(trip.countryAdm0, monthsOf, parentOf);
    const severity = tripSeverity(
      tripPassports(
        { start: trip.startDate, end: trip.endDate, travelers: trip.travelers },
        holders,
        months,
        today,
      ),
    );
    const id = `${TRIP_PREFIX}${trip.id}`;
    if (!severity) {
      if (notified[trip.id]) await Notifications.dismissNotificationAsync(id).catch(() => {});
      continue;
    }
    next[trip.id] = severity;
    if (notified[trip.id] === severity || !allowed) {
      // Without permission nothing is sent and nothing is marked: it is told once allowed.
      if (!allowed) delete next[trip.id];
      continue;
    }
    const text = severity === 'red' ? texts.tripRed(trip) : texts.tripOrange(trip, months);
    await ensureChannel(texts.channel);
    await Notifications.scheduleNotificationAsync({
      identifier: id,
      content: {
        title: text.title,
        body: text.body,
        data: { v: 1, type: 'passport_trip', tripId: trip.id },
      },
      trigger: { channelId: PASSPORT_CHANNEL_ID },
    }).catch(() => {});
    sent.push(trip.id);
  }
  // Trips not in this list (over, deleted, not loaded) keep no record.
  await AsyncStorage.setItem(NOTIFIED_KEY, JSON.stringify(next)).catch(() => {});
  return sent;
}

/** Sign-out and account deletion (D9): every passport notification goes. */
export async function cancelAllPassportAlerts(): Promise<void> {
  for (const id of [
    ...(await scheduledWith(TRIP_PREFIX)),
    ...(await scheduledWith(EXPIRY_PREFIX)),
  ]) {
    await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
  }
  try {
    const shown = await Notifications.getPresentedNotificationsAsync();
    for (const n of shown) {
      const id = n.request.identifier;
      if (id.startsWith(TRIP_PREFIX) || id.startsWith(EXPIRY_PREFIX)) {
        await Notifications.dismissNotificationAsync(id).catch(() => {});
      }
    }
  } catch {
    // Nothing shown.
  }
  await AsyncStorage.removeItem(NOTIFIED_KEY).catch(() => {});
}

/** A tapped passport notification (design 7.3). */
export function passportOpenOf(
  response: Notifications.NotificationResponse | null | undefined,
): { type: 'trip'; tripId: string } | { type: 'expiry' } | null {
  const data = response?.notification.request.content.data as
    { v?: unknown; type?: unknown; tripId?: unknown } | undefined;
  if (data?.v !== 1) return null;
  if (data.type === 'passport_trip' && typeof data.tripId === 'string')
    return { type: 'trip', tripId: data.tripId };
  if (data.type === 'passport_expiry') return { type: 'expiry' };
  return null;
}
