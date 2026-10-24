/**
 * Folds a country name or a typed query to the form search compares (sprint 1
 * AC-2). Used at build time (scripts/build-search-index.mjs) and at runtime,
 * so both sides fold identically.
 *
 * Explicit character maps only: Hermes on Android can't be trusted with
 * String.prototype.normalize, Intl.Collator or localeCompare, and Jest (full
 * ICU) wouldn't notice. Keep this file free of imports and of syntax Node's
 * type stripping can't erase, so the build script can import it directly.
 */

// prettier-ignore
const LATIN: Record<string, string> = {
  à: 'a', á: 'a', â: 'a', ã: 'a', ä: 'a', å: 'a', ā: 'a', ă: 'a', ą: 'a',
  æ: 'ae',
  ç: 'c', ć: 'c', č: 'c',
  ď: 'd', đ: 'd', ð: 'd',
  è: 'e', é: 'e', ê: 'e', ë: 'e', ē: 'e', ė: 'e', ę: 'e', ě: 'e',
  ğ: 'g',
  ì: 'i', í: 'i', î: 'i', ï: 'i', ī: 'i', į: 'i', ı: 'i',
  ł: 'l',
  ñ: 'n', ń: 'n', ň: 'n',
  ò: 'o', ó: 'o', ô: 'o', õ: 'o', ö: 'o', ø: 'o', ō: 'o', ő: 'o',
  œ: 'oe',
  ř: 'r',
  ś: 's', š: 's', ş: 's', ș: 's', ß: 'ss',
  ť: 't', ţ: 't', ț: 't', þ: 'th',
  ù: 'u', ú: 'u', û: 'u', ü: 'u', ū: 'u', ů: 'u', ű: 'u',
  ý: 'y', ÿ: 'y',
  ź: 'z', ż: 'z', ž: 'z',
};

/** Hebrew final letters fold to their regular form, so "מלדיבים" and a half-typed "מלדיבימ" agree. */
const HEBREW_FINALS: Record<string, string> = { ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' };

/** Geresh, gershayim and every quote mark people type for them are removed, not replaced. */
const DROPPED = /['׳`’‘"״“”„]/g;

/**
 * Maqaf (U+05BE), the Hebrew hyphen: "גינאה־ביסאו" is two words. It lies
 * inside the niqqud range, so it is turned into a space first.
 */
const MAQAF = /־/g;

/** Hebrew points and cantillation marks (U+0591–U+05C7). */
const NIQQUD = /[֑-ׇ]/g;

/** Anything that separates words: whitespace, hyphens, dots, commas, brackets, slashes. */
const SEPARATORS = /[\s\-‐-―.,()[\]/&+:;]+/g;

/** Leading words a search may leave out (AC-2): "קוקוס" is a name prefix of "איי קוקוס". */
const OPTIONAL_LEADING = ['איי', 'איימ', 'האיימ', 'אי', 'האי'];

/** Lowercases, removes quotes and niqqud, folds Latin diacritics and Hebrew finals, and collapses separators to one space. */
export function fold(text: string): string {
  let out = '';
  const cleaned = text.toLowerCase().replace(DROPPED, '').replace(MAQAF, ' ').replace(NIQQUD, '');
  for (const ch of cleaned) {
    out += LATIN[ch] ?? HEBREW_FINALS[ch] ?? ch;
  }
  return out.replace(SEPARATORS, ' ').trim();
}

/**
 * The searchable forms of a name: the folded name, a form with the leading ה
 * dropped from each Hebrew word ("מלד" finds "האיים המלדיביים"), and forms
 * without a leading "איי"/"האיים", so the rest of the name ranks as a prefix.
 */
export function searchForms(name: string): string[] {
  const folded = fold(name);
  const withoutArticle = folded
    .split(' ')
    .map((word) => (word.length > 2 && word.startsWith('ה') ? word.slice(1) : word))
    .join(' ');
  const forms = [folded, withoutArticle];
  for (const form of [folded, withoutArticle]) {
    const [first, ...rest] = form.split(' ');
    if (rest.length && first && OPTIONAL_LEADING.includes(first)) forms.push(rest.join(' '));
  }
  return [...new Set(forms)];
}
