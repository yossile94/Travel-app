/**
 * Small text helpers for the passport screens, kept inside the module so it
 * imports nothing that reaches the network, not even transitively (D8).
 */
const LRI = String.fromCharCode(0x2066);
const FSI = String.fromCharCode(0x2068);
const PDI = String.fromCharCode(0x2069);

/** Digits and dates read left to right inside Hebrew text. */
export const isolateLtr = (text: string) => `${LRI}${text}${PDI}`;
/** A typed name keeps its own direction (an English name in a Hebrew line). */
export const isolateOwn = (text: string) => `${FSI}${text}${PDI}`;
/** "2027-03-14" as "14.3.2027" (design 3.2). */
export const numDate = (d: string) => d.split('-').reverse().map(Number).join('.');
/** "1234" read digit by digit (design 14.1). */
export const spaced = (digits: string) => digits.split('').join(' ');
