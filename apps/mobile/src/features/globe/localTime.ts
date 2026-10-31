/**
 * Local time at a destination and its difference from Israel time, for the
 * globe card (sprint 0 AC-4).
 *
 * Written for Hermes on Android, whose Intl supports DateTimeFormat with a
 * timeZone but not formatToParts or timeZoneName: 'shortOffset'. Everything
 * here goes through DateTimeFormat.format() with a fixed en-US numeric
 * layout and parses that, so the result does not depend on locale data.
 */

export const ISRAEL_TIME_ZONE = 'Asia/Jerusalem';

export interface ZonedClock {
  hours: number;
  minutes: number;
  /** Offset from UTC in minutes, e.g. 420 for Bangkok. */
  offsetMinutes: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/**
 * v0.14.1 (Raz 3): zones newer than an old device's tzdata, under the older
 * name that keeps the same clock, so a flight or a day still draws there.
 */
const OLDER_NAME: Record<string, string> = {
  'America/Ciudad_Juarez': 'America/Denver',
  'America/Nuuk': 'America/Godthab',
  'Asia/Qostanay': 'Asia/Almaty',
  'Europe/Kyiv': 'Europe/Kiev',
  'Pacific/Kanton': 'Pacific/Enderbury',
};

function makeFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    try {
      formatter = makeFormatter(timeZone);
    } catch (error) {
      // An older name with the same clock; with none, the caller decides (the
      // card hides the time; a screen that doesn't catch shows ErrorScreen).
      const older = OLDER_NAME[timeZone];
      if (!older) throw error;
      formatter = makeFormatter(older);
    }
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

// "10/22/2026, 20:53" (some engines omit the comma or use "24" for midnight).
const EN_US_NUMERIC = /(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})/;

/** The wall clock in a time zone at a moment, and that zone's UTC offset then. */
export function zonedClock(timeZone: string, date: Date): ZonedClock {
  const text = formatterFor(timeZone).format(date);
  const match = EN_US_NUMERIC.exec(text);
  if (!match) throw new Error(`Unexpected date format "${text}" for ${timeZone}`);

  const [, month, day, year, hour, minute] = match.map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const hours = hour % 24;
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hours, minute);
  const instantToTheMinute = Math.floor(date.getTime() / 60_000) * 60_000;

  return {
    hours,
    minutes: minute,
    offsetMinutes: Math.round((wallClockAsUtc - instantToTheMinute) / 60_000),
  };
}

/** "07:05" — 24-hour clock with tabular digits, the same in every locale. */
export function formatClock({ hours, minutes }: Pick<ZonedClock, 'hours' | 'minutes'>): string {
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** Minutes the destination is ahead of Israel (negative when behind). */
export function differenceFromIsrael(timeZone: string, date: Date): number {
  return (
    zonedClock(timeZone, date).offsetMinutes - zonedClock(ISRAEL_TIME_ZONE, date).offsetMinutes
  );
}

export type TimeDifference =
  { kind: 'same' } | { kind: 'ahead' | 'behind'; hours: number; minutes: number };

export function describeDifference(differenceMinutes: number): TimeDifference {
  if (differenceMinutes === 0) return { kind: 'same' };
  const total = Math.abs(differenceMinutes);
  return {
    kind: differenceMinutes > 0 ? 'ahead' : 'behind',
    hours: Math.floor(total / 60),
    minutes: total % 60,
  };
}

/** Delay until the next minute boundary, so the card's clock ticks exactly on the minute. */
export function millisecondsToNextMinute(date: Date): number {
  return 60_000 - (date.getTime() % 60_000);
}
