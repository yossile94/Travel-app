import { prefixed } from './hebrewPrefix';

it('merges the definite article', () => {
  expect(prefixed('ב', 'תאילנד', 'he')).toBe('בתאילנד');
  expect(prefixed('ל', 'הרפובליקה הדומיניקנית', 'he')).toBe('לרפובליקה הדומיניקנית');
  expect(prefixed('ב', 'Thailand', 'en')).toBe('Thailand');
});
