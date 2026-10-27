/**
 * The connection-at-risk alert (sprint 7 AC-4, design 8; ADR-012): a check
 * that pushes the wait at a connection below the airport's minimum replaces
 * the flight's regular alert. No state is kept: the alert goes when the wait
 * crosses the minimum downward, so it goes once until the wait is back over it.
 */
import { clockAt, dateAt, RLM, shortDate } from './clock.ts';

/** What a check changed on one field, as push.ts merges a watch's events. */
export type TimeChange = { old: string | null; new: string | null };

/** The legs around the recipient's flight (flight_notification_targets). */
export type Around = {
  flight_id: string;
  flight_number: string;
  flight_number_input: string;
  dep_iata: string;
  dep_tz: string;
  arr_iata: string | null;
  arr_tz: string | null;
  prev_flight_id?: string | null;
  /** The leg before's watch: its own changes in the same claim (Raz review 1). */
  prev_watch_id?: number | null;
  prev_number?: string | null;
  prev_arr?: string | null;
  prev_arr_tz?: string | null;
  prev_mct?: number | null;
  next_flight_id?: string | null;
  next_watch_id?: number | null;
  next_number?: string | null;
  next_dep?: string | null;
  next_mct?: number | null;
};

export type Risk = {
  /** The connection airport. */
  apt: string;
  /** Its clock. */
  tz: string;
  prevNumber: string;
  nextNumber: string;
  /** The landing and the departure there, latest known. */
  arr: string;
  dep: string;
  /** Whole minutes on the ground, floored as the app does (Raz design 4). */
  wait: number;
  /** The alert opens the next leg (design 8.4). */
  nextFlightId: string;
  /** Which of this flight's changes set it off. */
  field: 'dep_time' | 'arr_time';
};

const minutes = (from: string, to: string) =>
  Math.floor((Date.parse(to) - Date.parse(from)) / 60_000);

/**
 * AC-4: the flight's departure moved and the wait before it crossed the
 * minimum downward, or its arrival moved and the wait after it did. Both:
 * the earlier connection speaks (Raz design q7), with "more changes".
 * `prevArr` / `nextDep`: the other leg's own change in the same claim, so
 * "before" is the wait before the whole claim, both legs as they were
 * (Raz review 1): both moving together never reads as a crossing.
 */
export function connectionRisks(
  dep: TimeChange | null,
  arr: TimeChange | null,
  t: Around,
  prevArr: TimeChange | null = null,
  nextDep: TimeChange | null = null,
): Risk[] {
  const out: Risk[] = [];
  const own = t.flight_number_input || t.flight_number;
  if (dep?.old && dep.new && t.prev_flight_id && t.prev_arr && t.prev_mct) {
    const before = minutes(prevArr?.old ?? t.prev_arr, dep.old);
    const after = minutes(t.prev_arr, dep.new);
    if (before >= t.prev_mct && after < t.prev_mct) {
      out.push({
        apt: t.dep_iata,
        tz: t.prev_arr_tz ?? t.dep_tz,
        prevNumber: t.prev_number ?? '',
        nextNumber: own,
        arr: t.prev_arr,
        dep: dep.new,
        wait: after,
        nextFlightId: t.flight_id,
        field: 'dep_time',
      });
    }
  }
  if (arr?.old && arr.new && t.arr_iata && t.next_flight_id && t.next_dep && t.next_mct) {
    const before = minutes(arr.old, nextDep?.old ?? t.next_dep);
    const after = minutes(arr.new, t.next_dep);
    if (before >= t.next_mct && after < t.next_mct) {
      out.push({
        apt: t.arr_iata,
        tz: t.arr_tz ?? t.dep_tz,
        prevNumber: own,
        nextNumber: t.next_number ?? '',
        arr: arr.new,
        dep: t.next_dep,
        wait: after,
        nextFlightId: t.next_flight_id,
        field: 'arr_time',
      });
    }
  }
  return out;
}

/** Design 8.3: the wait in words, never "0:40". */
export function waitWords(m: number, locale: 'he' | 'en'): string {
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (locale === 'en') {
    if (h === 0) return `${r} min`;
    return r === 0 ? `${h} hr` : `${h} hr ${r} min`;
  }
  const mins = (n: number) => (n === 1 ? 'דקה אחת' : `${n} דקות`);
  if (h === 0) return mins(r);
  const hours = h === 1 ? 'שעה' : h === 2 ? 'שעתיים' : `${h} שעות`;
  if (r === 0) return hours;
  return r === 1 ? `${hours} ודקה` : `${hours} ו-${r} דקות`;
}

const TEXT = {
  he: {
    title: (apt: string) => `הקונקשן ב-${apt} בסיכון`,
    body: (wait: string) => `זמן ההמתנה ירד ל-${wait}.`,
    missed: (next: string) => `ייתכן שלא תספיקו ל-${next}.`,
    times: (prev: string, arr: string, next: string, dep: string, apt: string) =>
      ` ${prev} נוחתת ב-${arr} ו-${next} ממריאה ב-${dep}, שעון ${apt}.`,
    onDate: (time: string, date: string) => `${time} ב-${date}`,
    more: ' יש עוד שינויים בטיסה.',
  },
  en: {
    title: (apt: string) => `Connection at ${apt} at risk`,
    body: (wait: string) => `Your layover is down to ${wait}.`,
    missed: (next: string) => `You may miss ${next}.`,
    times: (prev: string, arr: string, next: string, dep: string, apt: string) =>
      ` ${prev} lands at ${arr} and ${next} departs at ${dep}, ${apt} time.`,
    onDate: (time: string, date: string) => `${time} on ${date}`,
    more: ' There are more changes.',
  },
} as const;

/** Design 8.2, pure for tests: the title and body of a connection alert. */
export function buildConnectionContent(
  r: Risk,
  locale: 'he' | 'en',
  moreChanges: boolean,
): { title: string; body: string } {
  const x = TEXT[locale];
  const arr = clockAt(r.arr, r.tz);
  let dep = clockAt(r.dep, r.tz);
  // Past midnight at the airport: the departure says its day (design 8.1).
  if (dateAt(r.dep, r.tz) !== dateAt(r.arr, r.tz)) {
    dep = x.onDate(dep, shortDate(dateAt(r.dep, r.tz), locale));
  }
  let body = r.wait > 0 ? x.body(waitWords(r.wait, locale)) : x.missed(r.nextNumber);
  body += x.times(r.prevNumber, arr, r.nextNumber, dep, r.apt);
  if (moreChanges) body += x.more;
  const title = x.title(r.apt);
  return locale === 'he' ? { title: RLM + title, body: RLM + body } : { title, body };
}
