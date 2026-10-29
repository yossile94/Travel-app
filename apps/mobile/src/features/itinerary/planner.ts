/**
 * Sprint 11 F-031 (ADR-016, Raz D1, D14, D16, D17): the rule-based planner.
 * Pure and deterministic: everything comes in, "today" included; no clock and
 * no randomness; ties break by place ref. It fills only empty days; the
 * server applies the result atomically (apply_auto_plan).
 *
 * Dates are the destination's calendar days ("YYYY-MM-DD"), times "HH:MM".
 */

export type Category = 'attraction' | 'nature' | 'culture' | 'family' | 'food' | 'shopping';
export type Pace = 'calm' | 'intense';

export interface PlannerPlace {
  ref: string;
  name: string;
  lat: number;
  lng: number;
  category: Category;
  popularity: number;
}

export interface PlannerInput {
  start: string;
  end: string;
  /** The outbound arrival, local to the destination; null with no flights. */
  arrival: { date: string; time: string; flightHours: number } | null;
  /** The return departure, local; null with no flights. */
  departure: { date: string; time: string } | null;
  /** Days that already have an item: never touched (AC-14). */
  busyDays: ReadonlySet<string>;
  places: readonly PlannerPlace[];
  /** Where the night of a day is (Raz ח3), [lng, lat]. */
  nightPoint: (day: string) => [number, number];
  /** Raz ח2: the `hot` band that month, there. */
  tropical: (day: string) => boolean;
  pace: Pace;
  airportTitle: string;
  /** A new item's id (a UUID in the app; fixed in tests). */
  newId: (index: number) => string;
}

export interface PlannedItem {
  id: string;
  day: string;
  time: string;
  title: string;
  placeRef: string | null;
  placeName: string | null;
  lat: number | null;
  lng: number | null;
  order: number;
}

/**
 * noPlaces: no known place near that night (D23); placesUsed: there were, but
 * all are already in earlier days, and a place never repeats (Raz, 29.10).
 * Neither counts as a day the plan will fill (the preview's count).
 */
export type DayKind =
  'busy' | 'inTransit' | 'rest' | 'planned' | 'noPlaces' | 'placesUsed' | 'beyondLimit';

export interface PlanResult {
  items: PlannedItem[];
  days: { day: string; kind: DayKind }[];
}

export const SLOTS = ['09:30', '15:30', '19:00'] as const;
/** D17: every slot is taken as two hours long. */
export const SLOT_MINUTES = 120;
export const MAX_DAYS = 60;
const NEAR_KM = 10;
const REACH_KM = 25;
const OUTDOOR: ReadonlySet<Category> = new Set(['attraction', 'nature', 'family']);

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
};
const clock = (total: number) =>
  `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
}

export function km([lng1, lat1]: [number, number], [lng2, lat2]: [number, number]): number {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

/** The trip's days, start to end. */
export function tripDays(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** D16, D17: the slots a day may use, and whether it ends with leaving for the airport. */
export function daySlots(
  day: string,
  input: Pick<PlannerInput, 'arrival' | 'departure' | 'pace'>,
): { slots: string[]; airportAt: string | null; kind: 'inTransit' | 'rest' | 'normal' } {
  const cap = input.pace === 'calm' ? 2 : 3;
  const { arrival, departure } = input;
  if (arrival && day < arrival.date) return { slots: [], airportAt: null, kind: 'inTransit' };
  if (departure && day === departure.date) {
    const dep = minutes(departure.time);
    // Three hours before take-off, down to 5 minutes (D17).
    const leave = Math.max(0, Math.floor((dep - 180) / 5) * 5);
    if (dep < 14 * 60) return { slots: [], airportAt: clock(leave), kind: 'normal' };
    const slots = SLOTS.filter((s) => minutes(s) + SLOT_MINUTES <= dep - 240).slice(0, 1);
    return { slots, airportAt: clock(leave), kind: 'normal' };
  }
  if (arrival && day === arrival.date) {
    if (arrival.flightHours > 8) return { slots: [], airportAt: null, kind: 'rest' };
    const land = minutes(arrival.time);
    const ceiling = land < 12 * 60 ? 3 : land < 18 * 60 ? 2 : 0;
    const slots = SLOTS.filter((s) => minutes(s) >= land + 120).slice(0, Math.min(cap, ceiling));
    return { slots, airportAt: null, kind: 'normal' };
  }
  return { slots: SLOTS.slice(0, cap), airportAt: null, kind: 'normal' };
}

const byPopularity = (a: PlannerPlace, b: PlannerPlace) =>
  b.popularity - a.popularity || a.ref.localeCompare(b.ref);

/** The rule-based plan of the empty days (AC-14 – AC-17). */
export function planTrip(input: PlannerInput): PlanResult {
  const items: PlannedItem[] = [];
  const days: PlanResult['days'] = [];
  const used = new Set<string>();
  let counter = 0;

  tripDays(input.start, input.end).forEach((day, index) => {
    if (index >= MAX_DAYS) return days.push({ day, kind: 'beyondLimit' });
    if (input.busyDays.has(day)) return days.push({ day, kind: 'busy' });
    const { slots, airportAt, kind } = daySlots(day, input);
    if (kind !== 'normal') return days.push({ day, kind });

    const night = input.nightPoint(day);
    const near = input.places.filter((p) => km([p.lng, p.lat], night) <= REACH_KM);
    const pool = near.filter((p) => !used.has(p.ref)).sort(byPopularity);
    // The day's anchor is the best place left near the night; the rest stay near it.
    const chosen: PlannerPlace[] = [];
    while (chosen.length < slots.length) {
      const anchor = chosen[0];
      const next = anchor
        ? (pool.find(
            (p) => !chosen.includes(p) && km([p.lng, p.lat], [anchor.lng, anchor.lat]) <= NEAR_KM,
          ) ??
          pool
            .filter((p) => !chosen.includes(p))
            .sort(
              (a, b) =>
                km([a.lng, a.lat], [anchor.lng, anchor.lat]) -
                  km([b.lng, b.lat], [anchor.lng, anchor.lat]) || a.ref.localeCompare(b.ref),
            )[0])
        : pool[0];
      if (!next) break;
      chosen.push(next);
    }
    // Tropical: the hot afternoon slot takes an indoor place when there is one (ח2).
    const placed = assignSlots(slots.slice(0, chosen.length), chosen, input.tropical(day));
    let order = 0;
    for (const { slot, place } of placed) {
      used.add(place.ref);
      items.push({
        id: input.newId(counter++),
        day,
        time: slot,
        title: place.name,
        placeRef: place.ref,
        placeName: place.name,
        lat: place.lat,
        lng: place.lng,
        order: order++,
      });
    }
    if (airportAt) {
      items.push({
        id: input.newId(counter++),
        day,
        time: airportAt,
        title: input.airportTitle,
        placeRef: null,
        placeName: null,
        lat: null,
        lng: null,
        order: order++,
      });
    }
    days.push({ day, kind: order ? 'planned' : near.length ? 'placesUsed' : 'noPlaces' });
  });
  return { items, days };
}

function assignSlots(slots: string[], places: PlannerPlace[], tropical: boolean) {
  if (!tropical) return slots.map((slot, i) => ({ slot, place: places[i]! }));
  const left = [...places];
  return slots.map((slot) => {
    const afternoon = slot === '15:30';
    const pick =
      (afternoon
        ? left.find((p) => !OUTDOOR.has(p.category))
        : left.find((p) => OUTDOOR.has(p.category))) ?? left[0]!;
    left.splice(left.indexOf(pick), 1);
    return { slot, place: pick };
  });
}

export type DayLabelKind =
  | 'arrival_full'
  | 'arrival_short'
  | 'arrival_evening'
  | 'arrival_rest'
  | 'in_transit'
  | 'departure_airport'
  | 'departure_short';

/**
 * Design 9.3 (D16): a day's label, from the same rules as daySlots, so the
 * board and the planner never disagree. Null: a full day (or no flights).
 * One-day trip: only the departure rule.
 */
export function dayLabel(
  day: string,
  input: Pick<PlannerInput, 'arrival' | 'departure'>,
): { kind: DayLabelKind; time?: string } | null {
  const { arrival, departure } = input;
  if (arrival && day < arrival.date) return { kind: 'in_transit' };
  if (departure && day === departure.date) {
    const dep = minutes(departure.time);
    return { kind: dep < 14 * 60 ? 'departure_airport' : 'departure_short', time: departure.time };
  }
  if (arrival && day === arrival.date) {
    if (arrival.flightHours > 8) return { kind: 'arrival_rest', time: arrival.time };
    const land = minutes(arrival.time);
    return {
      kind: land < 12 * 60 ? 'arrival_full' : land < 18 * 60 ? 'arrival_short' : 'arrival_evening',
      time: arrival.time,
    };
  }
  return null;
}
