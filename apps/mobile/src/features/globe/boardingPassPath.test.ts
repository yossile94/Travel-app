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
});
