/**
 * Sprint 10 AC-9 (D7, ICAO 9303 part 4): the expiry date from the machine
 * readable zone of a passport (TD3: two lines of 44). The OCR runs on the
 * device; this only reads its text. Nothing but the expiry is taken: the
 * number, name and birth date stay in the photo.
 */

const WEIGHTS = [7, 3, 1] as const;

function charValue(c: string): number {
  if (c === '<') return 0;
  const code = c.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 65 && code <= 90) return code - 55;
  return -1;
}

/** ICAO 9303 7-3-1 check digit; -1 for a character outside the MRZ set. */
export function checkDigit(field: string): number {
  let sum = 0;
  for (let i = 0; i < field.length; i++) {
    const v = charValue(field[i]!);
    if (v < 0) return -1;
    sum += v * WEIGHTS[i % 3]!;
  }
  return sum % 10;
}

/** OCR confusions, fixed only where the field is numeric (D7). */
const DIGIT_FOR: Record<string, string> = {
  O: '0',
  Q: '0',
  D: '0',
  U: '0',
  I: '1',
  L: '1',
  Z: '2',
  S: '5',
  G: '6',
  T: '7',
  B: '8',
};
const digits = (s: string) => s.replace(/[A-Z]/g, (c) => DIGIT_FOR[c] ?? c);

/** A raw OCR line as MRZ characters: upper case, no spaces, « and similar as <. */
function clean(line: string): string {
  return line.toUpperCase().replace(/[\s]/g, '').replace(/[«‹]/g, '<');
}

export type MrzResult = { kind: 'expiry'; date: string } | { kind: 'none' } | { kind: 'mismatch' };

/**
 * Reads the expiry from OCR text. `none`: no TD3 second line was found;
 * `mismatch`: found, but its check digit doesn't hold (design 9.4: "take
 * another or type it"). The year is always 20YY: a passport valid in the
 * 1900s is long gone (D7).
 */
export function readMrzExpiry(text: string): MrzResult {
  const lines = text
    .split(/\r?\n/)
    .map(clean)
    .filter((l) => l.length >= 40);
  let found = false;
  for (const raw of lines) {
    // The second line: number (9), check, nationality (3), birth (6), check, sex, expiry (6), check.
    const line = raw.slice(0, 44);
    if (line.length < 28) continue;
    const nationality = line.slice(10, 13);
    const sex = line[20];
    if (!/^[A-Z<]{3}$/.test(nationality) || !/[MFX<]/.test(sex ?? '')) continue;
    const birth = digits(line.slice(13, 19));
    const expiry = digits(line.slice(21, 27));
    const check = digits(line[27] ?? '');
    if (!/^[0-9]{6}$/.test(birth) || !/^[0-9]{6}$/.test(expiry) || !/^[0-9]$/.test(check)) continue;
    found = true;
    if (checkDigit(expiry) !== Number(check)) continue;
    const [yy, mm, dd] = [expiry.slice(0, 2), expiry.slice(2, 4), expiry.slice(4, 6)];
    const date = `20${yy}-${mm}-${dd}`;
    const parsed = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) continue;
    return { kind: 'expiry', date };
  }
  return found ? { kind: 'mismatch' } : { kind: 'none' };
}
