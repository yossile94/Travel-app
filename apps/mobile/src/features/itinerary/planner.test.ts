// Sprint 11 AC-14 – AC-18 (D16, D17): the planner's table of cases, the
// spec's own criterion first.
import { dayLabel, daySlots, planTrip, type PlannerInput, type PlannerPlace } from './planner';

const place = (
  ref: string,
  popularity: number,
  [lng, lat]: [number, number],
  category: PlannerPlace['category'] = 'culture',
): PlannerPlace => ({
  ref,
  name: `Place ${ref}`,
  lat,
  lng,
  category,
  popularity,
});
const bangkok: [number, number] = [100.5, 13.75];
const places = Array.from({ length: 40 }, (_, i) =>
  place(`wd:Q${100 + i}`, 100 - i, [100.5 + (i % 5) * 0.01, 13.75 + Math.floor(i / 5) * 0.01]),
);
const base: PlannerInput = {
  start: '2027-01-05',
  end: '2027-01-12',
  today: '2026-12-01',
  arrival: { date: '2027-01-05', time: '14:55', flightHours: 7 },
  departure: { date: '2027-01-12', time: '09:30' },
  busyDays: new Set(),
  places,
  nightPoint: () => bangkok,
  tropical: () => false,
  pace: 'intense',
  airportTitle: 'יציאה לשדה התעופה',
  newId: (i) => `id-${i}`,
};
const onDay = (r: ReturnType<typeof planTrip>, day: string) => r.items.filter((i) => i.day === day);

describe('today (AC-18, QA B3)', () => {
  it('a trip already under way: earlier days stay empty and unreported; today is planned', () => {
    const r = planTrip({ ...base, today: '2027-01-08' });
    expect(r.days.filter((d) => d.kind === 'past').map((d) => d.day)).toEqual([
      '2027-01-05',
      '2027-01-06',
      '2027-01-07',
    ]);
    expect(r.items.every((i) => i.day >= '2027-01-08')).toBe(true);
    expect(onDay(r, '2027-01-08').length).toBe(3);
  });
});

describe('the planner (sprint 11 AC-15, the spec criterion)', () => {
  it('8 days, landing 14:55, take-off 09:30: first day ≤ 2, last day only the airport, a busy day untouched', () => {
    const r = planTrip({ ...base, busyDays: new Set(['2027-01-08']) });
    expect(onDay(r, '2027-01-05').length).toBeLessThanOrEqual(2);
    expect(onDay(r, '2027-01-12').map((i) => [i.title, i.time])).toEqual([
      ['יציאה לשדה התעופה', '06:30'],
    ]);
    expect(onDay(r, '2027-01-08')).toEqual([]);
    expect(r.days.find((d) => d.day === '2027-01-08')?.kind).toBe('busy');
  });

  it('D17: landing 14:55 leaves only the 19:00 slot', () => {
    expect(daySlots('2027-01-05', base).slots).toEqual(['19:00']);
  });
});

describe('the first and last day (D16, D17)', () => {
  const first = (time: string, pace: PlannerInput['pace'] = 'intense', flightHours = 4) =>
    daySlots('2027-01-05', { ...base, pace, arrival: { date: '2027-01-05', time, flightHours } })
      .slots;

  it.each([
    ['06:00', 'intense', ['09:30', '15:30', '19:00']],
    ['06:00', 'calm', ['09:30', '15:30']],
    ['11:00', 'intense', ['15:30', '19:00']],
    ['13:00', 'intense', ['15:30', '19:00']],
    ['17:30', 'intense', []],
    ['19:30', 'intense', []],
  ] as const)('landing %s, pace %s → %j', (time, pace, slots) => {
    expect(first(time, pace)).toEqual(slots);
  });

  it('after a flight over 8 hours the first day rests', () => {
    expect(
      daySlots('2027-01-05', {
        ...base,
        arrival: { date: '2027-01-05', time: '06:00', flightHours: 11 },
      }).kind,
    ).toBe('rest');
  });

  it.each([
    ['09:30', [], '06:30'],
    ['13:59', [], '10:55'],
    ['18:00', ['09:30'], '15:00'],
    ['15:00', [], '12:00'],
  ] as const)('take-off %s → slots %j, leave at %s', (time, slots, leave) => {
    const d = daySlots('2027-01-12', { ...base, departure: { date: '2027-01-12', time } });
    expect(d.slots).toEqual(slots);
    expect(d.airportAt).toBe(leave);
  });

  it('a night flight: the days before landing are "on the way"', () => {
    const r = planTrip({ ...base, arrival: { date: '2027-01-06', time: '07:00', flightHours: 5 } });
    expect(r.days.find((d) => d.day === '2027-01-05')?.kind).toBe('inTransit');
    expect(onDay(r, '2027-01-05')).toEqual([]);
  });

  it('one-day trip: only the departure rule', () => {
    const r = planTrip({
      ...base,
      start: '2027-01-05',
      end: '2027-01-05',
      arrival: { date: '2027-01-05', time: '06:00', flightHours: 2 },
      departure: { date: '2027-01-05', time: '20:00' },
    });
    expect(onDay(r, '2027-01-05').map((i) => i.time)).toEqual(['09:30', '17:00']);
  });

  it('no flights: full days', () => {
    const r = planTrip({ ...base, arrival: null, departure: null, pace: 'calm' });
    expect(r.items.filter((i) => i.day === '2027-01-05').map((i) => i.time)).toEqual([
      '09:30',
      '15:30',
    ]);
    expect(r.items.filter((i) => i.day === '2027-01-12')).toHaveLength(2);
  });
});

describe('places (AC-16)', () => {
  it('no place twice in a trip; same input, same plan', () => {
    const a = planTrip(base);
    const refs = a.items.map((i) => i.placeRef).filter(Boolean);
    expect(new Set(refs).size).toBe(refs.length);
    expect(planTrip(base)).toEqual(a);
  });

  it('a day keeps near its anchor (within 10 km when it can)', () => {
    const far = place('wd:Q999', 1000, [101.5, 14.5]);
    const r = planTrip({
      ...base,
      places: [...places, far],
      nightPoint: () => [101.5, 14.5],
      arrival: null,
      departure: null,
    });
    // Only the far place is within reach of that night: one item a day, then empty days.
    expect(onDay(r, '2027-01-05').map((i) => i.placeRef)).toEqual(['wd:Q999']);
    // Its one place went on the first day: the places ran out (Raz, 29.10).
    expect(r.days.find((d) => d.day === '2027-01-06')?.kind).toBe('placesUsed');
  });

  it('D23: a night in a city with no places nearby stays empty, never filled from far away', () => {
    const r = planTrip({
      ...base,
      nightPoint: () => [102.8, 16.4],
      arrival: null,
      departure: null,
    });
    expect(r.items).toEqual([]);
    expect(r.days.every((d) => d.kind === 'noPlaces')).toBe(true);
  });

  it('QA B7: a night with no city and no hotel is its own kind, not a lack of places', () => {
    const r = planTrip({ ...base, nightPoint: () => null, arrival: null, departure: null });
    expect(r.items).toEqual([]);
    expect(r.days.every((d) => d.kind === 'noNight')).toBe(true);
  });

  it('an evening landing is its own kind, not a lack of places', () => {
    const r = planTrip({ ...base, arrival: { date: '2027-01-05', time: '19:30', flightHours: 4 } });
    expect(r.days[0]).toEqual({ day: '2027-01-05', kind: 'arrivalEvening' });
  });

  it('a city with one place, calm pace: that day gets one item', () => {
    const one = place('wd:Q5', 10, [101.5, 14.5]);
    const r = planTrip({
      ...base,
      places: [one],
      nightPoint: () => [101.5, 14.5],
      arrival: null,
      departure: null,
      pace: 'calm',
    });
    expect(onDay(r, '2027-01-05').map((i) => i.placeRef)).toEqual(['wd:Q5']);
    expect(r.days.find((d) => d.day === '2027-01-05')?.kind).toBe('planned');
  });

  it('tropical: the 15:30 slot takes an indoor place, outdoor ones go morning and evening', () => {
    const mixed = [
      place('wd:Q1', 90, bangkok, 'nature'),
      place('wd:Q2', 80, bangkok, 'culture'),
      place('wd:Q3', 70, bangkok, 'attraction'),
    ];
    const r = planTrip({
      ...base,
      places: mixed,
      tropical: () => true,
      arrival: null,
      departure: null,
    });
    const day = onDay(r, '2027-01-05');
    expect(day.find((i) => i.time === '15:30')?.placeRef).toBe('wd:Q2');
    expect(
      day
        .filter((i) => i.time !== '15:30')
        .map((i) => i.placeRef)
        .sort(),
    ).toEqual(['wd:Q1', 'wd:Q3']);
  });

  it('plans 60 days at most', () => {
    const r = planTrip({ ...base, end: '2027-04-30', arrival: null, departure: null });
    expect(r.days.filter((d) => d.kind === 'beyondLimit').length).toBeGreaterThan(0);
    expect(r.items.every((i) => i.day < '2027-03-06')).toBe(true);
  });
});

describe('the day labels share the planner rules (design 9.3)', () => {
  it.each([
    ['2027-01-05', { kind: 'arrival_short', time: '14:55' }],
    ['2027-01-07', null],
    ['2027-01-12', { kind: 'departure_airport', time: '09:30' }],
  ] as const)('%s → %j', (day, expected) => {
    expect(dayLabel(day, base)).toEqual(expected);
  });
  it('before landing: on the way; a long flight: rest; evening landing', () => {
    expect(dayLabel('2027-01-04', base)).toEqual({ kind: 'in_transit' });
    expect(
      dayLabel('2027-01-05', {
        ...base,
        arrival: { date: '2027-01-05', time: '06:10', flightHours: 11 },
      }),
    ).toEqual({ kind: 'arrival_rest', time: '06:10' });
    expect(
      dayLabel('2027-01-05', {
        ...base,
        arrival: { date: '2027-01-05', time: '21:10', flightHours: 4 },
      })?.kind,
    ).toBe('arrival_evening');
  });
});
