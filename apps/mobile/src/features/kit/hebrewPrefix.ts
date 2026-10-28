/**
 * "ב" or "ל" before a Hebrew country name (sprint 8 design 21.7): the
 * definite article merges into it, so "הרפובליקה הדומיניקנית" becomes
 * "ברפובליקה הדומיניקנית", never "בהרפובליקה". English names pass through.
 */
export function prefixed(prefix: 'ב' | 'ל', name: string, language: string): string {
  if (language !== 'he') return name;
  return name.startsWith('ה') ? `${prefix}${name.slice(1)}` : `${prefix}${name}`;
}

/** The country for strings that say {{country}}, {{inCountry}} or {{toCountry}}. */
export const countryWords = (name: string, language: string) => ({
  country: name,
  inCountry: prefixed('ב', name, language),
  toCountry: prefixed('ל', name, language),
});
