import {
  airportOf,
  airportTitle,
  defaultGroups,
  indexAirports,
  searchAirports,
  type AirportRow,
} from './airportsData';

const rows: AirportRow[] = [
  [
    'TLV',
    'ISR',
    'IL',
    'Asia/Jerusalem',
    'תל אביב',
    'Tel Aviv',
    'Ben Gurion International Airport',
    0,
    'נתב"ג',
  ],
  ['BKK', 'THA', 'TH', 'Asia/Bangkok', 'בנגקוק', 'Bangkok', 'Suvarnabhumi Airport', 0, ''],
  [
    'DMK',
    'THA',
    'TH',
    'Asia/Bangkok',
    'בנגקוק',
    'Bangkok',
    'Don Mueang International Airport',
    0,
    '',
  ],
  ['HKT', 'THA', 'TH', 'Asia/Bangkok', 'פוקט', 'Phuket', 'Phuket International Airport', 0, ''],
  ['ETM', 'ISR', 'IL', 'Asia/Jerusalem', 'אילת', 'Eilat', 'Ramon International Airport', 0, 'רמון'],
  ['BKX', 'USA', 'US', 'America/Chicago', '', 'Brookings', 'Brookings Regional Airport', 2, ''],
];
const airports = rows.map(airportOf);
const index = indexAirports(airports, (iso) => (iso === 'TH' ? ['תאילנד', 'Thailand'] : []));

describe('airport search (sprint 5 design 5)', () => {
  it('an exact 3-letter code comes first', () => {
    expect(searchAirports(index, 'bkk').map((a) => a.iata)[0]).toBe('BKK');
  });

  it('finds by Hebrew or English city, airport name, or country', () => {
    expect(searchAirports(index, 'בנגק').map((a) => a.iata)).toEqual(['BKK', 'DMK']);
    expect(searchAirports(index, 'suvarna').map((a) => a.iata)).toEqual(['BKK']);
    expect(searchAirports(index, 'תאילנד').map((a) => a.iata)).toEqual(['BKK', 'DMK', 'HKT']);
  });

  it('nothing for an empty query', () => {
    expect(searchAirports(index, '  ')).toEqual([]);
  });

  it('default groups: the country top, and Israel in its fixed order', () => {
    const g = defaultGroups(airports, 'THA');
    expect(g.inCountry.map((a) => a.iata)).toEqual(['BKK', 'DMK', 'HKT']);
    expect(g.israel.map((a) => a.iata)).toEqual(['TLV', 'ETM']);
  });

  it('titles: Hebrew city and fixed Israeli names; English short names', () => {
    expect(airportTitle(airports[0]!, 'he')).toBe('תל אביב · נתב"ג');
    expect(airportTitle(airports[1]!, 'he')).toBe('בנגקוק · Suvarnabhumi');
    expect(airportTitle(airports[1]!, 'en')).toBe('Bangkok · Suvarnabhumi');
  });
});
