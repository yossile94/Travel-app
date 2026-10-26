import {
  displayName,
  entryOf,
  hasExactMatch,
  indexCities,
  normalize,
  searchCities,
  type CityRow,
} from './citySearch';

// Population order, as the build writes it.
const thailand: CityRow[] = [
  [1609350, 'בנגקוק', 'Bangkok', '', 5104476],
  [1153671, "צ'יאנג מאי", 'Chiang Mai', '', 200952],
  [1607779, '', 'Phra Pradaeng', '', 100000],
  [1151254, 'פוקט', 'Phuket', '', 75000],
];
const iceland: CityRow[] = [
  [3413829, 'רייקיאוויק', 'Reykjavík', 'Reykjavik', 118918],
  [3414447, 'קואופווגיר', 'Kópavogur', 'Kopavogur', 34000],
  [3415667, 'הפנרפיירדיר', 'Hafnarfjörður', 'Hafnarfjoerdur', 29000],
];

describe('city search (sprint 3 AC-4, design 5.3)', () => {
  it('normalises accents, letters NFD keeps, Hebrew points, finals, quotes and dashes', () => {
    expect(normalize('São Paulo')).toBe('sao paulo');
    expect(normalize('Hafnarfjörður')).toBe('hafnarfjordur');
    expect(normalize('San Pawl il-Baħar')).toBe('san pawl il bahar');
    expect(normalize("צ'יאנג מאי")).toBe('ציאנג מאי');
    expect(normalize('ירושלים')).toBe(normalize('ירושלימ'));
    expect(normalize('Tel Aviv–Yafo')).toBe('tel aviv yafo');
  });

  it('shows the largest cities before anything is typed', () => {
    const index = indexCities(thailand.map(entryOf));
    expect(searchCities(index, '').map((c) => c.nameEn)).toEqual([
      'Bangkok',
      'Chiang Mai',
      'Phra Pradaeng',
      'Phuket',
    ]);
  });

  it('finds by the start of any word, in Hebrew, English or plain letters', () => {
    const index = indexCities([...thailand, ...iceland].map(entryOf));
    expect(searchCities(index, 'ציאנג').map((c) => c.id)).toEqual([1153671]);
    expect(searchCities(index, 'mai').map((c) => c.id)).toEqual([1153671]);
    expect(searchCities(index, 'kopavogur').map((c) => c.id)).toEqual([3414447]);
    expect(searchCities(index, 'hafnarfjordur').map((c) => c.id)).toEqual([3415667]);
  });

  it('puts names that start with the query first, then by population', () => {
    const index = indexCities(thailand.map(entryOf));
    // "ph": Phra Pradaeng and Phuket both start with it; population decides.
    expect(searchCities(index, 'ph').map((c) => c.nameEn)).toEqual(['Phra Pradaeng', 'Phuket']);
    // "pra": only a later word starts with it.
    expect(searchCities(index, 'pra').map((c) => c.nameEn)).toEqual(['Phra Pradaeng']);
  });

  it('offers "as written" only without an exact match', () => {
    const index = indexCities(thailand.map(entryOf));
    expect(hasExactMatch(searchCities(index, 'bangkok'), 'Bangkok')).toBe(true);
    expect(hasExactMatch(searchCities(index, 'bang'), 'bang')).toBe(false);
    expect(hasExactMatch(searchCities(index, 'קו טאו'), 'קו טאו')).toBe(false);
  });

  it('shows the Hebrew name in Hebrew when there is one', () => {
    const [bangkok, , phra] = thailand.map(entryOf);
    expect(displayName(bangkok!, 'he')).toBe('בנגקוק');
    expect(displayName(phra!, 'he')).toBe('Phra Pradaeng');
    expect(displayName(bangkok!, 'en')).toBe('Bangkok');
  });
});
