/**
 * Sprint 10 AC-12, AC-13: when to check. The upcoming trips arrive with every
 * trips load (a trip created, its dates changed, the app opened); the holders
 * with every save in the wallet, offline too. Each arrival checks the trips
 * against the passports, and a holders change plans the reminders again.
 */
import i18n from '@/i18n';
import { loadDestination } from '@/features/destination/destinationData';
import { countryByAdm0 } from '@/features/globe/countryData';
import { countryWords } from '@/features/kit/hebrewPrefix';
import {
  onPassportsChanged,
  passportsSnapshot,
  loadPassports,
  wipePassports,
} from '@/features/passport/passportStore';
import type { Holder } from '@/features/passport/passportModel';
import { countryName } from '@/features/trips/countryName';
import rawMeta from '@/features/globe/countryMeta.json';

import {
  cancelAllPassportAlerts,
  checkTripPassports,
  syncExpiryReminders,
  type AlertTrip,
  type PassportTexts,
} from './passportAlerts';

const parents = rawMeta as unknown as Record<string, { parent?: string }>;
const parentOf = (adm0: string) => parents[adm0]?.parent;

let trips: readonly AlertTrip[] | null = null;
let running: Promise<void> = Promise.resolve();

function texts(): PassportTexts {
  const t = i18n.t.bind(i18n);
  const words = (trip: AlertTrip) => {
    const c = countryByAdm0(trip.countryAdm0);
    return countryWords(c ? countryName(c, i18n.language) : trip.countryAdm0, i18n.language);
  };
  return {
    channel: t('passport.channel'),
    tripRed: (trip) => ({
      title: t('passport.push.redTitle', words(trip)),
      body: t('passport.push.redBody'),
    }),
    tripOrange: (trip, months) => ({
      title: t('passport.push.orangeTitle', words(trip)),
      body:
        months > 0
          ? t('passport.push.orangeBody', { n: months })
          : t('passport.push.orangeBodyZero'),
    }),
    soon: (months, isMe) => ({
      title: isMe
        ? t('passport.push.soonMine', { n: months })
        : t('passport.push.soonOther', { n: months }),
      body: t('passport.push.soonBody'),
    }),
  };
}

async function check(holders: readonly Holder[]) {
  if (!trips) return;
  const destination = await loadDestination().catch(() => null);
  const monthsOf = (adm0: string) => destination?.advisories.get(adm0)?.passportValidityMonths;
  await checkTripPassports(trips, holders, monthsOf, parentOf, texts());
}

/** Runs one after another, so two quick saves never interleave. */
function queue(job: () => Promise<void>): Promise<void> {
  running = running.then(job).catch((e: unknown) => {
    console.warn('[passport] alerts failed', (e as Error).name);
  });
  return running;
}

async function holders(): Promise<readonly Holder[]> {
  if (passportsSnapshot().status !== 'ready') await loadPassports();
  const s = passportsSnapshot();
  return s.status === 'ready' ? s.holders : [];
}

/** The trips provider's upcoming trips, after each load (TripsProvider). */
export function passportTripsLoaded(next: readonly AlertTrip[]): Promise<void> {
  trips = next;
  return queue(async () => check(await holders()));
}

let unsubscribe: (() => void) | null = null;

/** Once, at the app's root: a save in the wallet checks the trips and plans the reminders. */
export function startPassportAlerts(): void {
  unsubscribe ??= onPassportsChanged((list) => {
    void queue(async () => {
      await check(list);
      await syncExpiryReminders(list, texts());
    });
  });
}

/** Sign-out, account deletion, wipeDevice (AC-6, D9): the passports and their notifications. */
export async function wipePassportDevice(): Promise<void> {
  trips = null;
  await queue(async () => {
    await cancelAllPassportAlerts();
    await wipePassports();
  });
}

/** Tests only. */
export function resetPassportRunnerForTests() {
  trips = null;
  unsubscribe?.();
  unsubscribe = null;
  running = Promise.resolve();
}
