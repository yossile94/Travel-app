import {
  describeDifference,
  differenceFromIsrael,
  formatClock,
  millisecondsToNextMinute,
  zonedClock,
} from './localTime';

// Israel daylight time ends on Sunday 2026-10-25; US daylight time on 2026-11-01.
const ISRAEL_SUMMER = new Date(Date.UTC(2026, 9, 22, 17, 53)); // 20:53 in Israel
const DST_GAP_WEEK = new Date(Date.UTC(2026, 9, 28, 12, 0)); // Israel on winter time, US not yet
const ISRAEL_WINTER = new Date(Date.UTC(2026, 11, 15, 10, 0));

describe('zonedClock', () => {
  it('reads the wall clock and UTC offset of a zone', () => {
    expect(zonedClock('Asia/Jerusalem', ISRAEL_SUMMER)).toEqual({
      hours: 20,
      minutes: 53,
      offsetMinutes: 180,
    });
    expect(zonedClock('Asia/Bangkok', ISRAEL_SUMMER)).toEqual({
      hours: 0,
      minutes: 53,
      offsetMinutes: 420,
    });
  });

  it('handles half- and quarter-hour zones', () => {
    expect(zonedClock('Asia/Kolkata', ISRAEL_SUMMER).offsetMinutes).toBe(330);
    expect(zonedClock('Asia/Kathmandu', ISRAEL_SUMMER).offsetMinutes).toBe(345);
  });

  it('handles zones west of UTC and across the date line', () => {
    expect(zonedClock('America/New_York', ISRAEL_SUMMER).offsetMinutes).toBe(-240);
    expect(zonedClock('Pacific/Auckland', ISRAEL_SUMMER).offsetMinutes).toBe(780);
  });

  it('reports midnight as 00, not 24', () => {
    const midnightInIsrael = new Date(Date.UTC(2026, 9, 22, 21, 0));
    expect(zonedClock('Asia/Jerusalem', midnightInIsrael).hours).toBe(0);
  });

  it('ignores seconds when working out the offset', () => {
    const withSeconds = new Date(Date.UTC(2026, 9, 22, 17, 53, 59, 999));
    expect(zonedClock('Asia/Bangkok', withSeconds).offsetMinutes).toBe(420);
  });
});

describe('formatClock', () => {
  it('pads to HH:MM', () => {
    expect(formatClock({ hours: 7, minutes: 5 })).toBe('07:05');
    expect(formatClock({ hours: 0, minutes: 0 })).toBe('00:00');
  });
});

describe('differenceFromIsrael', () => {
  it('follows daylight saving time on both sides', () => {
    expect(differenceFromIsrael('Asia/Bangkok', ISRAEL_SUMMER)).toBe(4 * 60);
    expect(differenceFromIsrael('Asia/Bangkok', ISRAEL_WINTER)).toBe(5 * 60);
    expect(differenceFromIsrael('Asia/Kolkata', ISRAEL_SUMMER)).toBe(2 * 60 + 30);
  });

  it('gets the week between Israel’s and America’s clock changes right', () => {
    expect(differenceFromIsrael('America/New_York', ISRAEL_SUMMER)).toBe(-7 * 60);
    expect(differenceFromIsrael('America/New_York', DST_GAP_WEEK)).toBe(-6 * 60);
    expect(differenceFromIsrael('America/New_York', ISRAEL_WINTER)).toBe(-7 * 60);
  });

  it('is zero for Israel and zones on the same time', () => {
    expect(differenceFromIsrael('Asia/Jerusalem', ISRAEL_SUMMER)).toBe(0);
    expect(differenceFromIsrael('Europe/Athens', ISRAEL_SUMMER)).toBe(0);
  });
});

describe('describeDifference', () => {
  it('splits a difference into direction, hours and minutes', () => {
    expect(describeDifference(0)).toEqual({ kind: 'same' });
    expect(describeDifference(240)).toEqual({ kind: 'ahead', hours: 4, minutes: 0 });
    expect(describeDifference(-150)).toEqual({ kind: 'behind', hours: 2, minutes: 30 });
    expect(describeDifference(345)).toEqual({ kind: 'ahead', hours: 5, minutes: 45 });
  });
});

describe('millisecondsToNextMinute', () => {
  it('waits until the next minute boundary', () => {
    expect(millisecondsToNextMinute(new Date(Date.UTC(2026, 0, 1, 0, 0, 30)))).toBe(30_000);
    expect(millisecondsToNextMinute(new Date(Date.UTC(2026, 0, 1, 0, 0, 0)))).toBe(60_000);
  });
});

describe('zones an old device does not know (v0.14.1, Raz 3)', () => {
  it('a newer name falls back to its older one with the same clock', () => {
    const Real = Intl.DateTimeFormat;
    const old = jest.spyOn(Intl, 'DateTimeFormat').mockImplementation(((
      locales?: string | string[],
      options?: Intl.DateTimeFormatOptions,
    ) => {
      if (options?.timeZone === 'Europe/Kyiv') throw new RangeError('Invalid time zone');
      return new Real(locales, options);
    }) as typeof Intl.DateTimeFormat);
    try {
      expect(zonedClock('Europe/Kyiv', ISRAEL_WINTER).offsetMinutes).toBe(120);
    } finally {
      old.mockRestore();
    }
  });

  it('a zone with no older name still throws, for the caller to handle', () => {
    expect(() => zonedClock('Mars/Olympus_Mons', ISRAEL_WINTER)).toThrow(RangeError);
  });
});
