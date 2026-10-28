/**
 * Phone numbers of the travel kit (sprint 8 AC-1, AC-7; Raz design 5): one
 * rule for the app and the server. Typed with spaces, hyphens or brackets,
 * starting with "+" or "00", 8 to 15 digits after the country code's "+":
 * stored as E.164. The server's CHECK is the same regex.
 */

const E164 = /^\+[1-9][0-9]{7,14}$/;

/** "+66 2 653-9000" or "0066 (2) 6539000" → "+6626539000"; null when it isn't one. */
export function normalizePhone(input: string): string | null {
  const compact = input.trim().replace(/[\s\-(). ]/g, '');
  const plus = compact.startsWith('00') ? `+${compact.slice(2)}` : compact;
  return E164.test(plus) ? plus : null;
}

/**
 * Country calling codes, for display only: the longest prefix wins. Codes
 * not listed fall back to the first 1–3 digits (design 19.3: "+code rest").
 */
const CODES = new Set([
  '1',
  '7',
  '20',
  '27',
  '30',
  '31',
  '32',
  '33',
  '34',
  '36',
  '39',
  '40',
  '41',
  '43',
  '44',
  '45',
  '46',
  '47',
  '48',
  '49',
  '51',
  '52',
  '53',
  '54',
  '55',
  '56',
  '57',
  '58',
  '60',
  '61',
  '62',
  '63',
  '64',
  '65',
  '66',
  '81',
  '82',
  '84',
  '86',
  '90',
  '91',
  '92',
  '93',
  '94',
  '95',
  '98',
  '212',
  '213',
  '216',
  '218',
  '220',
  '221',
  '225',
  '233',
  '234',
  '237',
  '251',
  '254',
  '255',
  '256',
  '260',
  '263',
  '351',
  '352',
  '353',
  '354',
  '355',
  '356',
  '357',
  '358',
  '359',
  '370',
  '371',
  '372',
  '373',
  '374',
  '375',
  '376',
  '377',
  '378',
  '380',
  '381',
  '382',
  '383',
  '385',
  '386',
  '387',
  '389',
  '420',
  '421',
  '423',
  '502',
  '503',
  '506',
  '507',
  '509',
  '591',
  '593',
  '595',
  '598',
  '673',
  '675',
  '679',
  '852',
  '853',
  '855',
  '856',
  '880',
  '886',
  '960',
  '961',
  '962',
  '963',
  '964',
  '965',
  '966',
  '967',
  '968',
  '971',
  '972',
  '973',
  '974',
  '975',
  '976',
  '977',
  '992',
  '993',
  '994',
  '995',
  '996',
  '998',
]);

/** "+6626539000" → "+66 26539000"; short local numbers ("191") stay as they are. */
export function formatPhone(e164OrShort: string): string {
  if (!e164OrShort.startsWith('+')) return e164OrShort;
  const digits = e164OrShort.slice(1);
  for (const n of [3, 2, 1]) {
    const code = digits.slice(0, n);
    if (CODES.has(code)) return `+${code} ${digits.slice(n)}`;
  }
  return `+${digits.slice(0, 3)} ${digits.slice(3)}`;
}

/** What a tel: link dials; the dialer, never a direct call (design 12.4). */
export const telUrl = (number: string) => `tel:${number}`;
