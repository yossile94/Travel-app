/**
 * Sprint 11 F-031 (scope ח2, ח3; D1, D23): everything the planner needs, put
 * together from what the device already has — the trip, its board, the
 * flights' anchors, the hotels, the bundled cities and climate, and the
 * country's places. Pure: "today" and the ids come in.
 */
import type { Hotel } from '@/features/kit/kitModel';
import { nightCityId, type Place, type PlaceCategory } from '@/features/places/placesModel';
import type { Trip } from '@/features/trips/tripsApi';

import { busyDays, type Anchors, type Board } from './itineraryModel';
import type { Category, Pace, PlannerInput, PlannerPlace } from './planner';

/** Scope ח2: a day is tropical when that month's daily average is 24° or more. */
export const TROPICAL_FROM_HUNDREDTHS = 2400;

/**
 * Night by night (ח3): a hotel with a point that covers the night, else the
 * night's trip city (nightCityId), else unknown.
 */
export function nightPointFor(
  trip: Pick<Trip, 'cities' | 'startDate' | 'endDate'>,
  hotels: readonly Pick<Hotel, 'checkIn' | 'checkOut' | 'point'>[],
  pointOf: (id: number) => [number, number] | null,
) {
  return (day: string): { point: [number, number]; cityId: number | null } | null => {
    const hotel = hotels.find((h) => h.point && h.checkIn <= day && day < h.checkOut);
    const cityId = nightCityId(trip, hotels, day, pointOf);
    if (hotel?.point) return { point: hotel.point, cityId };
    const at = cityId !== null ? pointOf(cityId) : null;
    return at ? { point: at, cityId } : null;
  };
}

/** Only AC-3's categories go into a plan; curated special ones (kosher, chabad…) stay out. */
const PLANNABLE: ReadonlySet<string> = new Set<PlaceCategory>([
  'attraction',
  'nature',
  'culture',
  'family',
  'food',
  'shopping',
]);

export function plannerPlaces(places: readonly Place[], language: string): PlannerPlace[] {
  return places
    .filter((p) => PLANNABLE.has(p.category))
    .map((p) => ({
      ref: p.ref,
      name: (language === 'he' && p.nameHe) || p.nameEn,
      lat: p.lat,
      lng: p.lng,
      category: p.category as Category,
      // Curated places first among equals (AC-20).
      popularity: p.curated ? Number.MAX_SAFE_INTEGER : p.popularity,
    }));
}

export function planInput(args: {
  trip: Trip;
  board: Board;
  anchors: Anchors;
  hotels: readonly Hotel[];
  places: readonly Place[];
  pointOf: (id: number) => [number, number] | null;
  /** The country's monthly daily averages, in hundredths of a degree; null when unknown. */
  normals: readonly number[] | null;
  pace: Pace;
  language: string;
  airportTitle: string;
  newId: (index: number) => string;
  /** Today at the destination (AC-18). */
  today: string;
}): PlannerInput {
  const night = nightPointFor(args.trip, args.hotels, args.pointOf);
  return {
    start: args.trip.startDate,
    end: args.trip.endDate,
    today: args.today,
    arrival: args.anchors.arrival,
    departure: args.anchors.departure,
    busyDays: busyDays(args.board),
    places: plannerPlaces(args.places, args.language),
    nightPoint: (day) => night(day)?.point ?? null,
    tropical: (day) =>
      args.normals !== null &&
      (args.normals[Number(day.slice(5, 7)) - 1] ?? 0) >= TROPICAL_FROM_HUNDREDTHS,
    pace: args.pace,
    airportTitle: args.airportTitle,
    newId: args.newId,
  };
}
