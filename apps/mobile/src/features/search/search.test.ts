import { fold, searchForms } from './fold';
import { MAX_RESULTS, displayName, searchCountries } from './search';

const first = (query: string) => searchCountries(query).results[0]?.adm0;
const all = (query: string) => searchCountries(query).results.map((r) => r.adm0);

describe('fold', () => {
  it('ignores case and Latin diacritics', () => {
    expect(fold('Côte d’Ivoire')).toBe('cote divoire');
    expect(fold('ÅLAND')).toBe('aland');
    expect(fold('São Tomé')).toBe('sao tome');
  });

  it('drops geresh, gershayim and every quote people type for them', () => {
    expect(fold('ארה"ב')).toBe('ארהב');
    expect(fold('ארה״ב')).toBe('ארהב');
    expect(fold('טג׳יקיסטן')).toBe(fold("טג'יקיסטן"));
  });

  it('treats Hebrew final letters as regular ones', () => {
    expect(fold('מלדיבים')).toBe('מלדיבימ');
    expect(fold('יפן')).toBe('יפנ');
  });

  it('removes niqqud and collapses separators', () => {
    expect(fold('יִשְׂרָאֵל')).toBe('ישראל');
    expect(fold('  Guinea-Bissau ')).toBe('guinea bissau');
  });

  it('offers forms without the leading ה and without a leading "איי"/"האיים"', () => {
    expect(searchForms('האיים המלדיביים')).toEqual([
      'האיימ המלדיביימ',
      'איימ מלדיביימ',
      'המלדיביימ',
      'מלדיביימ',
    ]);
    expect(searchForms('איי פוקלנד')).toEqual(['איי פוקלנד', 'פוקלנד']);
    expect(searchForms('ישראל')).toEqual(['ישראל']);
  });

  it('treats maqaf as a space, not as niqqud', () => {
    expect(fold('גינאה־ביסאו')).toBe('גינאה ביסאו');
  });
});

describe('searchCountries (AC-1, AC-2, AC-4)', () => {
  it.each([
    ['תאי', 'THA'],
    ['מלד', 'MDV'],
    ['ארה', 'USA'],
    ['usa', 'USA'],
    ['אמריקה', 'USA'],
    ['אנגליה', 'GBR'],
    ['cote', 'CIV'],
    ['טגיק', 'TJK'],
    ['ותיק', 'VAT'],
    ['USA', 'USA'],
    ['ארה"ב', 'USA'],
    ['קוקוס', 'IOA'],
    ['cocos', 'IOA'],
    ['חג המולד', 'IOA'],
    ['סין', 'CHN'],
    ['china', 'CHN'],
    ['צפון קוריאה', 'PRK'],
    ['דרום קוריאה', 'KOR'],
    ['גרוזיה', 'GEO'],
    ['טייוואן', 'TWN'],
    ['בלרוס', 'BLR'],
    ['uk', 'GBR'],
    ['פוקלנד', 'FLK'],
  ])('"%s" lists %s first', (query, adm0) => {
    expect(first(query)).toBe(adm0);
  });

  it('matches a word inside the name, not only its start', () => {
    expect(all('דרומית')).toEqual(expect.arrayContaining(['KOR', 'SGS']));
  });

  it('puts an exact name above a longer name that starts the same way', () => {
    expect(first('הודו')).toBe('IND');
  });

  it('shows at most 8 results and says when there are more', () => {
    const { results, more } = searchCountries('א');
    expect(results).toHaveLength(MAX_RESULTS);
    expect(more).toBe(true);
  });

  it('lists ties in Hebrew alphabetical order', () => {
    const names = searchCountries('גינ').results.map((r) => r.sortKey);
    expect(names).toEqual([...names].sort());
  });

  it('returns nothing for an empty or meaningless query', () => {
    expect(searchCountries('')).toEqual({ results: [], more: false });
    expect(searchCountries('  "״ ')).toEqual({ results: [], more: false });
    expect(searchCountries('qqqq').results).toEqual([]);
  });

  it('never offers an area that is not a destination (AC-4)', () => {
    expect(all('עזה')).toEqual([]);
    expect(all('gaza')).toEqual([]);
    expect(all('Bir Tawil')).toEqual([]);
  });

  it('finds territories and names their sovereign', () => {
    const gibraltar = searchCountries('גיברלטר').results[0]!;
    expect(displayName(gibraltar)).toBe('גיברלטר (הממלכה המאוחדת)');
    expect(displayName(searchCountries('תאילנד').results[0]!)).toBe('תאילנד');
    expect(displayName(searchCountries('קוקוס').results[0]!)).toBe(
      'טריטוריה של האוקיינוס ההודי (אוסטרליה)',
    );
  });
});
