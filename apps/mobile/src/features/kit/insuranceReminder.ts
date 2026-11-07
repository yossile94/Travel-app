/**
 * The "no insurance" reminder (sprint 8 AC-10, design 11): one local
 * notification at 09:00 device time a week before departure, only on the
 * device that saved the trip, never asking for permission. A fixed id per
 * trip, so scheduling again replaces it and cancelling never misses one.
 */
import * as Notifications from 'expo-notifications';
import { AndroidImportance, AndroidNotificationVisibility } from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { countryByAdm0 } from '@/features/globe/countryData';
import { countryName } from '@/features/trips/countryName';
import { fromPgDate, todayPg } from '@/features/trips/tripDates';

import { countryWords } from './hebrewPrefix';
import { reminderDay } from './kitModel';

export const REMINDERS_CHANNEL_ID = 'trip-reminders';
const PREFIX = 'insurance-reminder:';
const idOf = (tripId: string) => `${PREFIX}${tripId}`;

/** Its own channel, so muting reminders keeps flight changes (Raz design 8). */
export async function ensureRemindersChannel(name: string, description: string): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(REMINDERS_CHANNEL_ID, {
    name,
    description,
    importance: AndroidImportance.DEFAULT,
    // The country is personal: only when unlocked.
    lockscreenVisibility: AndroidNotificationVisibility.PRIVATE,
    showBadge: false,
  });
}

/** When it fires: 09:00 local on start − 7, or null when that moment has passed (AC-10). */
export function reminderAt(startDate: string, now = new Date()): Date | null {
  const day = reminderDay(startDate);
  if (day <= todayPg(now)) return null;
  const at = fromPgDate(day);
  at.setHours(9, 0, 0, 0);
  return at;
}

export interface ReminderText {
  title: string;
  body: string;
  channel: { name: string; description: string };
}

/**
 * Schedules (or replaces) the trip's reminder; cancels it when there is
 * insurance or no time left. Silent without permission.
 */
export async function syncInsuranceReminder(
  trip: { id: string; startDate: string },
  hasInsurance: boolean,
  text: ReminderText,
  now = new Date(),
): Promise<'scheduled' | 'cancelled' | 'skipped'> {
  try {
    const at = hasInsurance ? null : reminderAt(trip.startDate, now);
    if (!at) {
      await Notifications.cancelScheduledNotificationAsync(idOf(trip.id));
      return 'cancelled';
    }
    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) return 'skipped';
    await ensureRemindersChannel(text.channel.name, text.channel.description);
    await Notifications.scheduleNotificationAsync({
      identifier: idOf(trip.id),
      content: {
        title: text.title,
        body: text.body,
        data: { v: 1, type: 'insurance_reminder', tripId: trip.id },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: at,
        channelId: REMINDERS_CHANNEL_ID,
      },
    });
    return 'scheduled';
  } catch {
    return 'skipped';
  }
}

export async function cancelInsuranceReminder(tripId: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(idOf(tripId));
  } catch {
    // Nothing scheduled.
  }
}

/**
 * Every trips load (design 11.3): a reminder whose trip has insurance now,
 * or is gone from a complete list, is cancelled. `complete` false: a trip
 * not in the list may just not be loaded, so only insured trips cancel.
 */
export async function pruneInsuranceReminders(
  trips: ReadonlyMap<string, { insured: boolean }>,
  complete: boolean,
): Promise<void> {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const n of scheduled) {
      if (!n.identifier.startsWith(PREFIX)) continue;
      const tripId = n.identifier.slice(PREFIX.length);
      const trip = trips.get(tripId);
      if ((!trip && complete) || trip?.insured) {
        await Notifications.cancelScheduledNotificationAsync(n.identifier);
      }
    }
  } catch {
    // Nothing scheduled, or notifications unavailable.
  }
}

/** Sign-out, account deletion, wipeDevice: every reminder goes (Raz design 4). */
export async function cancelAllInsuranceReminders(): Promise<void> {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      scheduled
        .filter((n) => n.identifier.startsWith(PREFIX))
        .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
    );
  } catch {
    // Nothing to cancel.
  }
}

/** A tapped reminder's trip (design 11.2), or null. */
export function reminderTripOf(
  response: Notifications.NotificationResponse | null | undefined,
): string | null {
  const data = response?.notification.request.content.data as
    { v?: unknown; type?: unknown; tripId?: unknown } | undefined;
  return data?.v === 1 && data.type === 'insurance_reminder' && typeof data.tripId === 'string'
    ? data.tripId
    : null;
}

const LANGUAGE_KEY = 'insurance-reminder:language';

/**
 * Sprint 14 AC-6 (Raz, PR 34): a reminder scheduled before the device language
 * changed would fire in the old one. Once per change, the reminders this
 * device has are scheduled again in the new language; none is added where
 * there wasn't one (only the device that saved the trip reminds, design 11).
 * Before sprint 14 every reminder was Hebrew. Resolves how many were redone.
 */
export async function rescheduleInLanguage(
  language: string,
  trips: ReadonlyMap<string, { startDate: string; countryAdm0: string; insured: boolean }>,
  textFor: (countryAdm0: string) => ReminderText,
): Promise<number> {
  try {
    const was = (await AsyncStorage.getItem(LANGUAGE_KEY)) ?? 'he';
    if (was === language) return 0;
    let count = 0;
    let skipped = 0;
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const n of scheduled) {
      if (!n.identifier.startsWith(PREFIX)) continue;
      const tripId = n.identifier.slice(PREFIX.length);
      const trip = trips.get(tripId);
      if (!trip) {
        // Not in the loaded list (over 50): the next load tries again.
        skipped++;
        continue;
      }
      const done = await syncInsuranceReminder(
        { id: tripId, startDate: trip.startDate },
        trip.insured,
        textFor(trip.countryAdm0),
      );
      if (done === 'scheduled') count++;
    }
    if (skipped === 0) await AsyncStorage.setItem(LANGUAGE_KEY, language);
    return count;
  } catch {
    return 0;
  }
}

/** The reminder's words for a trip, in the language of the moment (design 11.1). */
export function reminderText(
  t: (k: string, o?: Record<string, unknown>) => string,
  language: string,
  countryAdm0: string,
): ReminderText {
  const country = countryByAdm0(countryAdm0);
  const words = countryWords(country ? countryName(country, language) : countryAdm0, language);
  // Design 11.1 (sprint 6 3.1): an RLM leads Hebrew titles, so a country in Latin script stays in place.
  const rlm = language === 'he' ? String.fromCharCode(0x200f) : '';
  return {
    title: rlm + t('reminder.insurance.title', words),
    body: rlm + t('reminder.insurance.body'),
    channel: { name: t('channel.reminders.name'), description: t('channel.reminders.description') },
  };
}
