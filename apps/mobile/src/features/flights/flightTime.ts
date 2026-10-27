/**
 * Flight times (sprint 5 AC-4, design 9.3 and 20.3): a local wall clock at an
 * airport to UTC and back, without a time zone library. Like localTime.ts it
 * uses only DateTimeFormat.format() through zonedClock, so it runs on Hermes.
 */
import { formatClock, ISRAEL_TIME_ZONE, zonedClock } from '@/features/globe/localTime';

export type WallResult =
  /** One instant has this wall clock. */
  | { kind: 'ok'; utc: Date }
  /** The clock skips this time (spring forward): saved shifted by the gap. */
  | { kind: 'gap'; utc: Date; savedWall: string }
  /** The clock shows this time twice (fall back): the first one is saved. */
  | { kind: 'overlap'; utc: Date };

const MINUTE = 60_000;

function parse(date: string, time: string) {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const [h, mi] = time.split(':').map(Number) as [number, number];
  return Date.UTC(y, mo - 1, d, h, mi);
}

/** The local date "YYYY-MM-DD" and time "HH:MM" at a zone, for an instant. */
export function zonedWall(timeZone: string, at: Date): { date: string; time: string } {
  const clock = zonedClock(timeZone, at);
  const local = new Date(at.getTime() + clock.offsetMinutes * MINUTE);
  return { date: local.toISOString().slice(0, 10), time: formatClock(clock) };
}

/**
 * The instant at which a zone's wall clock reads `date` `time`. Tries the
 * zone's offsets around that day: two that both give the wall clock mean it
 * happens twice (the earlier, bigger offset is kept); none means it doesn't
 * exist, and the time is moved forward by the gap, as the clock itself does.
 */
export function zonedWallToUtc(date: string, time: string, timeZone: string): WallResult {
  const wall = parse(date, time);
  const offsets = new Set<number>();
  for (const probe of [wall - 12 * 60 * MINUTE, wall, wall + 12 * 60 * MINUTE]) {
    offsets.add(zonedClock(timeZone, new Date(probe)).offsetMinutes);
  }
  const fits = [...offsets]
    .map((offset) => new Date(wall - offset * MINUTE))
    .filter((utc) => {
      const back = zonedWall(timeZone, utc);
      return parse(back.date, back.time) === wall;
    })
    .sort((a, b) => a.getTime() - b.getTime());
  if (fits.length > 1) return { kind: 'overlap', utc: fits[0]! };
  if (fits.length === 1) return { kind: 'ok', utc: fits[0]! };
  // A gap: the offset before it, read with the offset after it, lands past it.
  const before = Math.min(...offsets);
  const utc = new Date(wall - before * MINUTE);
  return { kind: 'gap', utc, savedWall: zonedWall(timeZone, utc).time };
}

/** Whole days from one local date to another ("+1", "+2", "−1"). */
export function dayOffset(fromDate: string, toDate: string): number {
  return Math.round((Date.parse(toDate) - Date.parse(fromDate)) / (24 * 60 * MINUTE));
}

export type SideTimes = {
  /** The time shown big: actual, else estimated, else scheduled, at the airport. */
  local: string | null;
  localDate: string | null;
  /** Israel time, null when the airport is in Israel. */
  israel: string | null;
  /** Israel's date when it differs from the airport's (design 9.3). */
  israelDate: string | null;
  /** The scheduled time when the shown one moved 15 minutes or more. */
  scheduled: string | null;
  changed: boolean;
};

const CHANGE_MS = 15 * MINUTE;

/** One side of a flight as the card shows it (design 9.3). */
export function sideTimes(
  timeZone: string | null,
  country: string | null,
  scheduledUtc: string | null,
  liveUtc: string | null,
): SideTimes {
  const shownUtc = liveUtc ?? scheduledUtc;
  if (!timeZone || !shownUtc) {
    return {
      local: null,
      localDate: null,
      israel: null,
      israelDate: null,
      scheduled: null,
      changed: false,
    };
  }
  const at = new Date(shownUtc);
  const local = zonedWall(timeZone, at);
  const changed =
    liveUtc !== null &&
    scheduledUtc !== null &&
    Math.abs(Date.parse(liveUtc) - Date.parse(scheduledUtc)) >= CHANGE_MS;
  let israel: string | null = null;
  let israelDate: string | null = null;
  if (country !== 'IL') {
    const il = zonedWall(ISRAEL_TIME_ZONE, at);
    israel = il.time;
    israelDate = il.date !== local.date ? il.date : null;
  }
  return {
    local: local.time,
    localDate: local.date,
    israel,
    israelDate,
    scheduled: changed ? zonedWall(timeZone, new Date(scheduledUtc!)).time : null,
    changed,
  };
}

/** "20.12" from "2026-12-20". */
export const dayMonth = (date: string) =>
  `${Number(date.slice(8, 10))}.${Number(date.slice(5, 7))}`;

/** Letters spaced for screen readers: "LY81" → "L Y 81" (design 15.1). */
export function spellCode(code: string): string {
  return code.replace(/([A-Z])(?=[A-Z0-9])/g, '$1 ').replace(/(\d)(?=[A-Z])/g, '$1 ');
}
