import {
  flightChips,
  flightTrackState,
  normalizeFlightNumber,
  typingCode,
  type Flight,
  type FlightWatch,
} from './flightModel';

const now = new Date('2026-12-20T20:00:00Z');
const side = {
  iata: 'TLV',
  timeZone: 'Asia/Jerusalem',
  scheduledUtc: '2026-12-20T21:40:00Z',
  revisedUtc: null,
  predictedUtc: null,
  runwayUtc: null,
  terminal: '3',
  gate: null,
};
const flight = (watch: Partial<FlightWatch> | null, over: Partial<Flight> = {}): Flight => ({
  id: 'f1',
  tripId: 't1',
  direction: 'out',
  numberInput: 'LY81',
  number: 'LY81',
  depDateLocal: '2026-12-20',
  airline: null,
  depIata: 'TLV',
  depTz: 'Asia/Jerusalem',
  depCountry: 'IL',
  arrIata: 'BKK',
  arrTz: 'Asia/Bangkok',
  arrCountry: 'TH',
  depSched: '2026-12-20T21:40:00Z',
  arrSched: '2026-12-21T08:45:00Z',
  depTerminal: null,
  depGate: null,
  arrTerminal: null,
  arrGate: null,
  pnr: null,
  seat: null,
  cabin: null,
  watch:
    watch === null
      ? null
      : {
          state: 'active',
          checkedAt: '2026-12-20T19:56:00Z',
          landedAt: null,
          events: [],
          snapshot: {
            number: 'LY81',
            airlineIata: 'LY',
            status: 'Expected',
            departure: side,
            arrival: { ...side, iata: 'BKK' },
          },
          ...watch,
        },
  ...over,
});

describe('normalizeFlightNumber (design 2.1)', () => {
  it.each([
    ['ly 81', 'LY81'],
    ['LY081', 'LY81'],
    ['6H 012', '6H12'],
    ['W62345', 'W62345'],
    ['ly-81', 'LY81'],
  ])('%s → %s', (input, out) => expect(normalizeFlightNumber(input)).toBe(out));

  it.each(['LY81A', 'LY12345', '12345', 'LY0', '', 'L'])('%s is not a flight number', (input) =>
    expect(normalizeFlightNumber(input)).toBeNull(),
  );

  it('booking codes keep only A-Z and 0-9, upper case', () => {
    expect(typingCode('ab-12 c', 8)).toBe('AB12C');
  });
});

describe('flightTrackState (design 11)', () => {
  it('no watch: added after departure, or over and deleted', () => {
    expect(flightTrackState(flight(null), now)).toBe('untracked_past');
    expect(flightTrackState(flight(null), new Date('2027-01-05T00:00:00Z'))).toBe('ended');
  });

  it('not checked yet, then tracking', () => {
    expect(flightTrackState(flight({ checkedAt: null }), now)).toBe('not_checked');
    expect(flightTrackState(flight({}), now)).toBe('tracking');
  });

  it('paused, not found, landed, cancelled, diverted', () => {
    expect(flightTrackState(flight({ state: 'paused' }), now)).toBe('paused');
    expect(flightTrackState(flight({ state: 'failed' }), now)).toBe('not_found');
    expect(
      flightTrackState(flight({ state: 'stopped', landedAt: '2026-12-21T08:40:00Z' }), now),
    ).toBe('landed');
    const cancelled = flight({});
    cancelled.watch!.snapshot!.status = 'Canceled';
    expect(flightTrackState(cancelled, now)).toBe('cancelled');
  });
});

describe('flightChips (design 9.4)', () => {
  it('on time after a check, delayed at 15 minutes, gate changed', () => {
    expect(flightChips(flight({}), 'tracking')).toEqual(['on-time']);
    const late = flight({});
    late.watch!.snapshot!.departure = { ...side, revisedUtc: '2026-12-20T23:10:00Z' };
    late.watch!.events = [
      { id: 1, field: 'dep_gate', old: 'B4', new: 'B6', at: now.toISOString() },
    ];
    expect(flightChips(late, 'tracking')).toEqual(['delayed', 'gate-changed']);
  });

  it('cancelled stands alone; nothing before the first check', () => {
    expect(flightChips(flight({}), 'cancelled')).toEqual(['cancelled']);
    expect(flightChips(flight({ checkedAt: null }), 'not_checked')).toEqual([]);
    expect(flightChips(flight(null), 'untracked_past')).toEqual(['untracked']);
  });
});
