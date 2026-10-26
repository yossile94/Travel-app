import { PULSE_CYCLE, PULSE_STEPS } from './NextTripPin';

jest.mock('@rnmapbox/maps', () => ({}));

describe('the pin pulse (Raz, R1)', () => {
  it('is three style updates per cycle, all inside it', () => {
    expect(PULSE_STEPS).toHaveLength(3);
    for (const step of PULSE_STEPS) expect(step.at).toBeLessThan(PULSE_CYCLE);
  });

  it('only jumps the ring back once it is invisible', () => {
    const fade = PULSE_STEPS.find((s) => s.change.opacity === 0)!;
    const reset = PULSE_STEPS.find((s) => s.change.radiusDuration === 0 && s.at > 0)!;
    expect(fade.at + (fade.change.opacityDuration ?? 0)).toBeLessThanOrEqual(reset.at);
  });
});
