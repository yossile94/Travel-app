/**
 * Sprint 11 F-030 (design 9, 25; AC-8, AC-12, D16): the board, pure. The days
 * come from the trip's dates, never stored; each day's label from the same
 * rules the planner uses (dayLabel); items outside the dates go to their own
 * section. The flights give the arrival and the departure, local to the
 * destination's airports.
 */
import type { Flight } from '@/features/flights/flightModel';
import { zonedWall } from '@/features/flights/flightTime';

import {
  addDays,
  dayLabel,
  MAX_DAYS,
  tripDays,
  type DayLabelKind,
  type PlannerInput,
} from './planner';

export interface Item {
  id: string;
  tripId: string;
  day: string;
  /** "HH:MM", or null. */
  time: string | null;
  title: string;
  note: string | null;
  placeRef: string | null;
  placeName: string | null;
  lat: number | null;
  lng: number | null;
  source: 'manual' | 'auto';
  sortOrder: number;
}

/** AC-12: the server's limits, also used to replace the "add" buttons. */
export const DAY_MAX = 30;
export const TRIP_MAX = 600;

export interface Anchors {
  arrival: PlannerInput['arrival'];
  departure: PlannerInput['departure'];
}

const local = (tz: string | null, iso: string | null) =>
  tz && iso ? zonedWall(tz, new Date(iso)) : null;

/**
 * The outbound arrival (the last 'out' leg, local at its airport) with the
 * hours from the first outbound take-off; the return's first take-off. Null
 * without times (a flight with no schedule doesn't move a label).
 */
export function flightAnchors(flights: readonly Flight[]): Anchors {
  const byDep = (a: Flight, b: Flight) => (a.depSched ?? '').localeCompare(b.depSched ?? '');
  const out = flights.filter((f) => f.direction === 'out' && f.depSched).sort(byDep);
  const back = flights.filter((f) => f.direction === 'return' && f.depSched).sort(byDep);
  const last = out.at(-1);
  const landed = last ? local(last.arrTz, last.arrSched) : null;
  const arrival =
    landed && last?.arrSched && out[0]?.depSched
      ? {
          date: landed.date,
          time: landed.time,
          flightHours: (Date.parse(last.arrSched) - Date.parse(out[0].depSched)) / 3_600_000,
        }
      : null;
  const first = back[0];
  const away = first ? local(first.depTz, first.depSched) : null;
  return { arrival, departure: away ? { date: away.date, time: away.time } : null };
}

export interface BoardDay {
  date: string;
  /** 1-based. */
  index: number;
  label: { kind: DayLabelKind; time?: string } | null;
  isToday: boolean;
  items: Item[];
}

export interface Board {
  days: BoardDay[];
  outOfRange: Item[];
  hasFlights: boolean;
  total: number;
}

const byOrder = (a: Item, b: Item) =>
  a.day.localeCompare(b.day) || a.sortOrder - b.sortOrder || a.id.localeCompare(b.id);

export function itineraryDays(input: {
  trip: { startDate: string; endDate: string };
  anchors: Anchors;
  items: readonly Item[];
  today: string;
}): Board {
  const { trip, anchors, items, today } = input;
  const dates = tripDays(trip.startDate, trip.endDate);
  const inRange = new Set(dates);
  const byDay = new Map<string, Item[]>();
  const outOfRange: Item[] = [];
  for (const item of [...items].sort(byOrder)) {
    if (!inRange.has(item.day)) outOfRange.push(item);
    else byDay.set(item.day, [...(byDay.get(item.day) ?? []), item]);
  }
  return {
    days: dates.map((date, i) => ({
      date,
      index: i + 1,
      label: dayLabel(date, anchors),
      isToday: date === today,
      items: byDay.get(date) ?? [],
    })),
    outOfRange,
    hasFlights: Boolean(anchors.arrival || anchors.departure),
    total: items.length,
  };
}

/** "8 ימים · 5 מתוכננים" (design 2.3): days in range, and how many have an item. */
export const boardCounts = (board: Board) => ({
  days: board.days.length,
  planned: board.days.filter((d) => d.items.length > 0).length,
});

/** Design 10: the days the planner may fill — up to 60, no item yet (AC-14). */
export const busyDays = (board: Board) =>
  new Set(board.days.filter((d) => d.items.length > 0).map((d) => d.date));

/** The last day the planner covers (D16: 60 days). */
export const plannerEnd = (start: string, end: string) => {
  const cap = addDays(start, MAX_DAYS - 1);
  return cap < end ? cap : end;
};

/** Up/down within a day (design 14.1): the new position, or null at the edge. */
export function moveWithinDay(day: BoardDay, id: string, delta: -1 | 1): number | null {
  const at = day.items.findIndex((i) => i.id === id);
  const next = at + delta;
  return at < 0 || next < 0 || next >= day.items.length ? null : next;
}
