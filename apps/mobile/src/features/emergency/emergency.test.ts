import type { Flight } from '@/features/flights/flightModel';

import {
  countryEmergency,
  emergencyRows,
  joinLabels,
  MFA,
  missionsFor,
  sourceName,
  type EmergencyData,
} from './emergencyData';
import bundled from './emergencyData.json';
import { pickerOrder, sosTarget } from './sosTarget';

const data: EmergencyData = {
  missions: bundled.missions as EmergencyData['missions'],
  countries: bundled.countries as EmergencyData['countries'],
  missionsReadOn: bundled.source.readOn,
};

describe('emergency rows (design 12.2)', () => {
  it('one shared number and no others: one row for all three', () => {
    expect(emergencyRows({ police: null, ambulance: null, fire: null, shared: '112' })).toEqual([
      { keys: ['police', 'ambulance', 'fire'], number: '112' },
    ]);
  });
  it('equal numbers merge (Japan: ambulance and fire 119)', () => {
    expect(emergencyRows({ police: '110', ambulance: '119', fire: '119', shared: null })).toEqual([
      { keys: ['police'], number: '110' },
      { keys: ['ambulance', 'fire'], number: '119' },
    ]);
  });
  it('a shared number with own numbers comes first as "general"', () => {
    expect(emergencyRows({ police: '17', ambulance: '15', fire: '18', shared: '112' })[0]).toEqual({
      keys: ['general'],
      number: '112',
    });
  });
  it('a service on the shared number is not shown twice (Thailand: 191, Dudi 8)', () => {
    expect(emergencyRows({ police: '191', ambulance: '1669', fire: '199', shared: '191' })).toEqual(
      [
        { keys: ['general'], number: '191' },
        { keys: ['ambulance'], number: '1669' },
        { keys: ['fire'], number: '199' },
      ],
    );
  });
  it('joins labels in Hebrew and English', () => {
    expect(joinLabels(['משטרה', 'אמבולנס', 'כבאות'], 'he')).toBe('משטרה, אמבולנס וכבאות');
    expect(joinLabels(['Police', 'Ambulance', 'Fire'], 'en')).toBe('Police, ambulance and fire');
    expect(joinLabels(['Ambulance', 'Fire'], 'en')).toBe('Ambulance and fire');
  });
});

describe('the bundled data', () => {
  it('Thailand: checked numbers and the Bangkok embassy', () => {
    const tha = countryEmergency(data, 'THA')!;
    expect(tha.numbersStatus).toBe('verified');
    expect(tha.police).toBe('191');
    expect(missionsFor(data, 'THA')[0]!.cityEn).toBe('Bangkok');
  });
  it('Cambodia is served from Bangkok', () => {
    expect(missionsFor(data, 'KHM')[0]!.adm0).toBe('THA');
  });
  it('a country without a check is pending, never a guessed number (AC-14)', () => {
    const mar = countryEmergency(data, 'MAR')!;
    expect(mar.numbersStatus).toBe('pending');
    expect(mar.police ?? mar.shared).toBeNull();
  });
  it('a territory uses its sovereign (Aruba → the Netherlands)', () => {
    expect(countryEmergency(data, 'ABW')?.adm0).toBe('NLD');
  });
  it('the Foreign Ministry center is locked, with its source (AC-12)', () => {
    expect(MFA).toEqual({
      phone: '+97225303155',
      sourceUrl: expect.stringMatching(/^https:\/\/embassies\.gov\.il\//),
      verifiedAt: '2026-10-28',
    });
  });
  it('names the source by its domain', () => {
    expect(sourceName('https://www.gov.uk/foreign-travel-advice/thailand')).toBe('FCDO');
    expect(sourceName('https://embassies.gov.il/bangkok')).toBe('gov.il');
    expect(sourceName('https://data.gov.il/dataset/ntz-short')).toBe('gov.il');
    expect(sourceName('https://www.example.org/x')).toBe('example.org');
  });
});

const trip = (id: string, countryAdm0: string, startDate: string, endDate: string) => ({
  id,
  countryAdm0,
  title: id,
  startDate,
  endDate,
});
const flight = (o: Partial<Flight>): Flight =>
  ({
    id: 'f',
    tripId: 't',
    depDateLocal: '2026-12-21',
    depSched: null,
    arrSched: null,
    watch: null,
    ...o,
  }) as Flight;

describe('sosTarget (AC-16)', () => {
  const tha = trip('tha', 'THA', '2026-12-18', '2027-01-03');
  const jpn = trip('jpn', 'JPN', '2026-12-20', '2026-12-30');
  const now = new Date('2026-12-21T12:00:00Z');

  it("the trip of today's landed flight wins: Thailand, though Japan started later", () => {
    const flights = {
      tha: [
        flight({
          depDateLocal: '2026-12-21',
          depSched: '2026-12-21T02:00:00Z',
          arrSched: '2026-12-21T08:00:00Z',
        }),
      ],
      jpn: [],
    };
    expect(sosTarget([tha, jpn], (id) => flights[id as 'tha'] ?? [], '2026-12-21', now)?.id).toBe(
      'tha',
    );
  });
  it('no flight today: the latest start date', () => {
    expect(sosTarget([tha, jpn], () => [], '2026-12-21', now)?.id).toBe('jpn');
  });
  it("a flight today that hasn't landed: today's first", () => {
    const flights = {
      tha: [],
      jpn: [
        flight({
          depDateLocal: '2026-12-21',
          depSched: '2026-12-21T20:00:00Z',
          arrSched: '2026-12-22T02:00:00Z',
        }),
      ],
    };
    expect(sosTarget([tha, jpn], (id) => flights[id as 'tha'] ?? [], '2026-12-21', now)?.id).toBe(
      'jpn',
    );
  });
  it('only active trips; none: null', () => {
    expect(sosTarget([tha], () => [], '2027-01-04', now)).toBeNull();
    expect(sosTarget([tha, jpn], () => [], '2026-12-19', now)?.id).toBe('tha');
  });
  it('orders the picker: the target, then latest start', () => {
    expect(pickerOrder([tha, jpn], tha).map((t) => t.id)).toEqual(['tha', 'jpn']);
  });
});
