import type { Flight } from './flightModel';
import {
  checkDetails,
  checkSearch,
  defaultDate,
  defaultDirection,
  emptyValues,
  toSaved,
  valuesOf,
  warnings,
  withDepartureDate,
  withLeg,
  type FlightFormValues,
} from './flightFormRules';

const trip = { startDate: '2026-12-20', endDate: '2027-01-05' };
const TLV = { iata: 'TLV', tz: 'Asia/Jerusalem', country: 'IL', title: 'תל אביב · נתב"ג' };
const BKK = { iata: 'BKK', tz: 'Asia/Bangkok', country: 'TH', title: 'בנגקוק · Suvarnabhumi' };
const filled = (over: Partial<FlightFormValues> = {}): FlightFormValues => ({
  ...emptyValues('out', '2026-12-20'),
  numberInput: 'LY81',
  origin: TLV,
  destination: BKK,
  depTime: '23:40',
  arrDate: '2026-12-21',
  arrTime: '17:15',
  ...over,
});

describe('flight form rules (sprint 5 design 2, 4, 6)', () => {
  it('direction and date defaults follow the trip', () => {
    expect(defaultDirection([])).toBe('out');
    expect(defaultDirection([{ direction: 'out' }])).toBe('return');
    expect(defaultDirection([{ direction: 'out' }, { direction: 'return' }])).toBe('internal');
    expect(defaultDate('return', trip)).toBe('2027-01-05');
    expect(defaultDate('internal', trip)).toBeNull();
  });

  it('search needs a valid number and a date within 355 days', () => {
    expect(checkSearch(emptyValues('out', null), '2026-10-27')).toEqual({
      number: 'number',
      date: 'date',
    });
    expect(checkSearch(filled({ date: '2027-12-01' }), '2026-10-27')).toEqual({ date: 'tooFar' });
    expect(checkSearch(filled(), '2026-10-27')).toEqual({});
  });

  it('details: airports, a departure time, different airports, arrival after departure, codes', () => {
    expect(checkDetails(filled(), '2026-10-27')).toEqual({});
    expect(checkDetails(filled({ origin: null, depTime: null }), '2026-10-27')).toEqual({
      origin: 'origin',
      depTime: 'depTime',
    });
    expect(checkDetails(filled({ destination: TLV }), '2026-10-27').destination).toBe(
      'sameAirport',
    );
    expect(
      checkDetails(filled({ arrDate: '2026-12-20', arrTime: '20:00' }), '2026-10-27').arrTime,
    ).toBe('arrBeforeDep');
    expect(checkDetails(filled({ pnr: 'AB1', seat: '12345' }), '2026-10-27')).toEqual({
      pnr: 'pnr',
      seat: 'seat',
    });
  });

  it('warnings: a past flight, a date outside the trip, a skipped hour', () => {
    const now = new Date('2026-12-21T00:00:00Z');
    expect(warnings(filled(), trip, now).map((w) => w.kind)).toEqual(['past']);
    expect(
      warnings(filled({ date: '2026-12-25' }), trip, new Date('2026-10-01')).map((w) => w.kind),
    ).toEqual([]);
    expect(
      warnings(
        filled({ date: '2027-02-01', depDate: '2027-02-01' }),
        trip,
        new Date('2026-10-01'),
      ).map((w) => w.kind),
    ).toEqual(['outsideTrip']);
    const gap = warnings(
      filled({ depDate: '2027-03-26', date: '2027-03-26', depTime: '02:30' }),
      { startDate: '2027-03-25', endDate: '2027-04-01' },
      new Date('2026-10-01'),
    );
    expect(gap.map((w) => w.kind)).toEqual(['dst']);
  });

  it('saves times as UTC at each airport and the number normalised', () => {
    const saved = toSaved(filled({ numberInput: 'ly 081', pnr: 'ABC123' }));
    expect(saved).toMatchObject({
      number: 'LY81',
      depSched: '2026-12-20T21:40:00.000Z',
      arrSched: '2026-12-21T10:15:00.000Z',
      depCountry: 'IL',
      pnr: 'ABC123',
      arrGate: null,
    });
  });

  it('a provider leg fills what it has and keeps direction, booking code and seat', () => {
    const before = filled({ direction: 'return', pnr: 'ABC123', seat: '34A', depTerminal: 'X' });
    const leg = {
      number: 'LY81',
      airlineIata: 'LY',
      airlineName: 'El Al',
      status: 'Expected',
      departure: {
        iata: 'TLV',
        timeZone: 'Asia/Jerusalem',
        scheduledUtc: '2026-12-20T21:40:00.000Z',
        revisedUtc: null,
        predictedUtc: null,
        runwayUtc: null,
        terminal: '3',
        gate: null,
      },
      arrival: {
        iata: 'BKK',
        timeZone: 'Asia/Bangkok',
        scheduledUtc: '2026-12-21T10:15:00.000Z',
        revisedUtc: null,
        predictedUtc: null,
        runwayUtc: null,
        terminal: null,
        gate: null,
      },
    };
    const after = withLeg(before, leg, (iata) =>
      iata === 'TLV' ? TLV : iata === 'BKK' ? BKK : null,
    );
    expect(after).toMatchObject({
      direction: 'return',
      pnr: 'ABC123',
      seat: '34A',
      airline: 'El Al',
      depTime: '23:40',
      arrTime: '17:15',
      depTerminal: '3',
    });
  });

  it('editing shows the saved values', () => {
    const flight = { ...toSaved(filled()), id: 'f', tripId: 't', watch: null } as Flight;
    expect(valuesOf(flight)).toMatchObject({
      depTime: '23:40',
      arrTime: '17:15',
      arrDate: '2026-12-21',
    });
  });
});

describe('withDepartureDate (v0.14.1, Raz 4)', () => {
  it('moves the arrival date by as many days as the departure moved', () => {
    expect(
      withDepartureDate(
        { date: '2026-12-10', depDate: '2026-12-10', arrDate: '2026-12-10' },
        '2026-12-08',
      ),
    ).toEqual({ date: '2026-12-08', depDate: '2026-12-08', arrDate: '2026-12-08' });
    // An overnight flight keeps its night.
    expect(
      withDepartureDate(
        { date: '2026-12-10', depDate: '2026-12-10', arrDate: '2026-12-11' },
        '2026-12-20',
      ),
    ).toEqual({ date: '2026-12-20', depDate: '2026-12-20', arrDate: '2026-12-21' });
  });

  it('with no arrival date yet, the arrival is the same day', () => {
    expect(withDepartureDate({ date: null, depDate: null, arrDate: null }, '2026-12-20')).toEqual({
      date: '2026-12-20',
      depDate: '2026-12-20',
      arrDate: '2026-12-20',
    });
  });
});
