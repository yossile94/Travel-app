import { boardingPassPath } from './boardingPassPath';

describe('boardingPassPath', () => {
  const path = boardingPassPath(360, 170, { cornerRadius: 18, notchX: 108, notchRadius: 11 });

  it('cuts both holes at the stub line, bending into the card', () => {
    expect(path).toContain('L 97 0 A 11 11 0 0 0 119 0');
    expect(path).toContain('L 119 170 A 11 11 0 0 0 97 170');
  });

  it('is a closed outline that starts and ends at the first corner', () => {
    expect(path.startsWith('M 18 0')).toBe(true);
    expect(path.endsWith('A 18 18 0 0 1 18 0 Z')).toBe(true);
  });

  it('no tear lines: the same outline as before (fix-country-card, Raz Q1)', () => {
    expect(
      boardingPassPath(360, 170, { cornerRadius: 18, notchX: 108, notchRadius: 11, tearYs: [] }),
    ).toBe(path);
  });

  it('with a coupon: a notch on each side at the coupon line, none at the stub bottom', () => {
    const coupon = boardingPassPath(360, 300, {
      cornerRadius: 18,
      notchX: 108,
      notchRadius: 11,
      tearYs: [170],
    });
    expect(coupon).toContain('L 97 0 A 11 11 0 0 0 119 0');
    expect(coupon).toContain('L 360 159 A 11 11 0 0 0 360 181');
    expect(coupon).toContain('L 0 181 A 11 11 0 0 0 0 159');
    expect(coupon).toContain('A 18 18 0 0 1 342 300 L 18 300');
  });

  it('two lines (the tiles, then the coupon): a pair of notches at each', () => {
    const two = boardingPassPath(360, 400, {
      cornerRadius: 18,
      notchX: 108,
      notchRadius: 11,
      tearYs: [250, 120],
    });
    expect(two).toContain('L 360 109 A 11 11 0 0 0 360 131 L 360 239 A 11 11 0 0 0 360 261');
    expect(two).toContain('L 0 261 A 11 11 0 0 0 0 239 L 0 131 A 11 11 0 0 0 0 109');
    expect(two).not.toContain('A 11 11 0 0 0 97 400');
    expect(two.endsWith('A 18 18 0 0 1 18 0 Z')).toBe(true);
  });
});
