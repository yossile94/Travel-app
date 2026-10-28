// Sprint 10 F-025, F-026 (D1, D10, design 6.1): the verdict table, the
// traveler matching and the form rules.
import { checkDigit, readMrzExpiry } from './mrz';
import {
  addMonths,
  holderErrors,
  last4Input,
  nameSuggestions,
  normalizeName,
  passportVerdict,
  sortHolders,
  tripPassports,
  tripSeverity,
  validityMonths,
  type Holder,
} from './passportModel';

const holder = (h: Partial<Holder>): Holder => ({
  id: 'x',
  isMe: false,
  name: '',
  expiry: null,
  last4: null,
  hasPhoto: false,
  ...h,
});

describe('passportVerdict (D10, design 6.1)', () => {
  const trip = { start: '2026-12-20', end: '2027-01-03', months: 6, today: '2026-10-28' };
  it.each([
    ['2026-12-01', 'expired_before_departure', 'expires before departure: red'],
    ['2026-12-19', 'expired_before_departure', 'the day before departure: red'],
    ['2026-12-20', 'short_on_return', 'valid on the departure day itself: orange, not red'],
    ['2027-06-01', 'short_on_return', 'under 6 months on return (Dana: Thailand case)'],
    ['2027-07-02', 'short_on_return', 'one day short of 6 months'],
    ['2027-07-03', 'ok', 'exactly 6 months on return'],
    [null, 'no_date', 'no date'],
  ] as const)('%s → %s (%s)', (expiry, verdict, _why) => {
    expect(passportVerdict({ ...trip, expiry })).toBe(verdict);
  });

  it('months 0: valid until the return day is enough (Dana: 4.1.2027)', () => {
    expect(passportVerdict({ ...trip, months: 0, expiry: '2027-01-04' })).toBe('ok');
    expect(passportVerdict({ ...trip, months: 0, expiry: '2027-01-03' })).toBe('ok');
    expect(passportVerdict({ ...trip, months: 0, expiry: '2027-01-02' })).toBe('short_on_return');
  });

  it('a country rule of 3 months', () => {
    expect(passportVerdict({ ...trip, months: 3, expiry: '2027-04-03' })).toBe('ok');
    expect(passportVerdict({ ...trip, months: 3, expiry: '2027-04-02' })).toBe('short_on_return');
  });

  it('a trip that already started has no red (Raz)', () => {
    expect(passportVerdict({ ...trip, today: '2026-12-22', expiry: '2026-12-01' })).toBe(
      'short_on_return',
    );
  });
});

describe('addMonths', () => {
  it('keeps the day, or the month end', () => {
    expect(addMonths('2027-01-03', 6)).toBe('2027-07-03');
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
    expect(addMonths('2027-08-31', 6)).toBe('2028-02-29');
    expect(addMonths('2026-12-15', -9)).toBe('2026-03-15');
  });
});

describe('validityMonths (D10)', () => {
  const months = new Map<string, number | null>([
    ['THA', 3],
    ['NLD', 0],
  ]);
  const parents: Record<string, string> = { ABW: 'NLD' };
  const of = (adm0: string) =>
    validityMonths(
      adm0,
      (a) => months.get(a),
      (a) => parents[a],
    );
  it('own value, then the sovereign, then 6', () => {
    expect(of('THA')).toEqual({ months: 3, fromCountry: true });
    expect(of('ABW')).toEqual({ months: 0, fromCountry: true });
    expect(of('GRC')).toEqual({ months: 6, fromCountry: false });
  });
});

describe('tripPassports (D1, design 6.2–6.4)', () => {
  const trip = {
    start: '2026-12-20',
    end: '2027-01-03',
    travelers: [{ name: 'נועה' }, { name: ' Yoav  Cohen ' }, { name: 'נועה' }],
  };
  const me = holder({ id: 'me', isMe: true, expiry: '2027-06-01' });
  const noa = holder({ id: 'n1', name: 'נוֹעָה', expiry: '2026-12-01' });

  it('me orange, Noa red (matched without points), Yoav missing; one row per name', () => {
    const r = tripPassports(trip, [me, noa], 6, '2026-10-28');
    expect(r.orange.map((h) => h.id)).toEqual(['me']);
    expect(r.red.map((h) => h.id)).toEqual(['n1']);
    expect(r.missing).toEqual([
      { key: 'name:yoav cohen', name: 'Yoav  Cohen', isMe: false, holder: null },
    ]);
    expect(tripSeverity(r)).toBe('red');
  });

  it('no "me" passport: me is missing first', () => {
    const r = tripPassports({ ...trip, travelers: [] }, [], 6, '2026-10-28');
    expect(r.missing).toEqual([{ key: 'me', name: '', isMe: true, holder: null }]);
    expect(tripSeverity(r)).toBeNull();
  });

  it('a trip that is over checks nothing', () => {
    const r = tripPassports(trip, [me, noa], 6, '2027-01-04');
    expect(r).toEqual({ red: [], orange: [], missing: [] });
  });
});

describe('the form (design 4.3)', () => {
  const list = [holder({ id: 'a', name: 'Noa' }), holder({ id: 'me', isMe: true })];
  it('name required, at most 60, unique after normalizing', () => {
    expect(holderErrors({ id: null, isMe: false, name: '  ', last4: '' }, list)).toEqual({
      name: 'nameRequired',
    });
    expect(
      holderErrors({ id: null, isMe: false, name: 'א'.repeat(61), last4: '' }, list).name,
    ).toBe('nameMax');
    expect(holderErrors({ id: null, isMe: false, name: ' noa ', last4: '' }, list).name).toBe(
      'nameTaken',
    );
    expect(holderErrors({ id: 'a', isMe: false, name: 'NOA', last4: '' }, list)).toEqual({});
  });
  it('"me" has no name; the digits are exactly 4', () => {
    expect(holderErrors({ id: 'me', isMe: true, name: '', last4: '12' }, list)).toEqual({
      last4: 'last4',
    });
    expect(holderErrors({ id: 'me', isMe: true, name: '', last4: '1234' }, list)).toEqual({});
  });
  it('a pasted number keeps its last 4 digits (Raz)', () => {
    expect(last4Input('12 34')).toEqual({ value: '1234', trimmed: false });
    expect(last4Input('A12345678')).toEqual({ value: '5678', trimmed: true });
    expect(last4Input('12a')).toEqual({ value: '12', trimmed: false });
  });
});

describe('the list (design 3.1, 3.3)', () => {
  it('"me" first, then by name', () => {
    const sorted = sortHolders(
      [
        holder({ id: 'y', name: 'יואב' }),
        holder({ id: 'me', isMe: true }),
        holder({ id: 'n', name: 'נועה' }),
      ],
      'he',
    );
    expect(sorted.map((h) => h.id)).toEqual(['me', 'y', 'n']);
  });
  it('suggestions skip names already on the list, and repeats', () => {
    expect(
      nameSuggestions(
        ['נועה', 'Dana', ' dana', 'Uri'],
        [holder({ name: 'נוּעה' }), holder({ name: 'X' })],
      ),
    ).toEqual(['Dana', 'Uri']);
  });
  it('normalizeName drops points, marks and case', () => {
    expect(normalizeName('‏נוֹעָה  ')).toBe('נועה');
    expect(normalizeName('Maya   COHEN')).toBe('maya cohen');
  });
});

describe('MRZ (AC-9, D7)', () => {
  // ICAO 9303 part 4 specimen (Anna Maria Eriksson), public test data.
  const line1 = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<';
  const line2 = 'L898902C36UTO7408122F1204159ZE184226B<<<<<10';

  it('check digits are 7-3-1', () => {
    expect(checkDigit('L898902C3')).toBe(6);
    expect(checkDigit('740812')).toBe(2);
    expect(checkDigit('120415')).toBe(9);
  });

  it('reads the expiry as 20YY', () => {
    expect(readMrzExpiry(`Some text\n${line1}\n${line2}\n`)).toEqual({
      kind: 'expiry',
      date: '2012-04-15',
    });
  });

  it('fixes O for 0 and spaces in numeric fields only', () => {
    const noisy = 'L898902C36UTO74O8122F12O4159 ZE184226B<<<<<10';
    expect(readMrzExpiry(noisy)).toEqual({ kind: 'expiry', date: '2012-04-15' });
  });

  it('a wrong check digit is a mismatch, not a date (AC-10)', () => {
    expect(readMrzExpiry(line2.replace('1204159', '1204158'))).toEqual({ kind: 'mismatch' });
  });

  it('no MRZ at all', () => {
    expect(readMrzExpiry('PASSPORT\nISRAEL\n12.04.2030')).toEqual({ kind: 'none' });
  });

  it('an impossible date is not read', () => {
    const bad = 'L898902C36UTO7408122F1213315ZE184226B<<<<<10';
    expect(checkDigit('121331')).toBe(5);
    expect(readMrzExpiry(bad).kind).toBe('mismatch');
  });
});
