import { TAP_MAX_MS, TAP_SLOP, isTap, type TouchDown } from './tapGesture';

const down: TouchDown = { x: 100, y: 200, at: 1_000, multiTouch: false };

describe('isTap (sprint 1 AC-10)', () => {
  it('accepts a short touch that barely moves', () => {
    expect(isTap(down, { x: 103, y: 204, at: 1_120 })).toBe(true);
    expect(isTap(down, { x: 100, y: 200 + TAP_SLOP, at: 1_000 + TAP_MAX_MS })).toBe(true);
  });

  it('rejects a drag', () => {
    expect(isTap(down, { x: 100 + TAP_SLOP + 1, y: 200, at: 1_100 })).toBe(false);
  });

  it('rejects a long press', () => {
    expect(isTap(down, { x: 100, y: 200, at: 1_000 + TAP_MAX_MS + 1 })).toBe(false);
  });

  it('rejects a pinch even if the first finger lifts where it landed', () => {
    expect(isTap({ ...down, multiTouch: true }, { x: 100, y: 200, at: 1_050 })).toBe(false);
  });
});
