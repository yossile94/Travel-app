import { msToNextMidnight } from './useToday';

describe('msToNextMidnight', () => {
  it('runs to one second past the next local midnight', () => {
    const now = new Date(2026, 9, 26, 23, 59, 0);
    expect(msToNextMidnight(now)).toBe(61_000);
  });

  it('from just after midnight, waits almost a full day', () => {
    const now = new Date(2026, 9, 26, 0, 0, 2);
    expect(msToNextMidnight(now)).toBe(24 * 3600_000 - 1000);
  });

  it('crosses a month end', () => {
    const now = new Date(2026, 9, 31, 12, 0, 0);
    expect(msToNextMidnight(now)).toBe(12 * 3600_000 + 1000);
  });
});
