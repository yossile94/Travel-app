import {
  IDLE_RESUME_MS,
  RAMP_MS,
  ROTATION_DEG_PER_SECOND,
  advanceLongitude,
  rotationFactor,
  type RotationInputs,
} from './idleRotation';

const base: RotationInputs = {
  now: 100_000,
  lastInteractionAt: 0,
  cardOpen: false,
  reduceMotion: false,
};

describe('rotationFactor', () => {
  it('spins at full speed when idle for a long time', () => {
    expect(rotationFactor(base)).toBe(1);
  });

  it('stays still for 5 seconds after a touch', () => {
    expect(rotationFactor({ ...base, lastInteractionAt: base.now - 100 })).toBe(0);
    expect(rotationFactor({ ...base, lastInteractionAt: base.now - IDLE_RESUME_MS })).toBe(0);
  });

  it('eases back in over one second, never jumping', () => {
    const at = (msIntoRamp: number) =>
      rotationFactor({ ...base, lastInteractionAt: base.now - IDLE_RESUME_MS - msIntoRamp });

    expect(at(RAMP_MS / 2)).toBeCloseTo(0.5, 5);
    expect(at(RAMP_MS)).toBe(1);

    let previous = 0;
    for (let ms = 0; ms <= RAMP_MS; ms += 50) {
      const factor = at(ms);
      expect(factor).toBeGreaterThanOrEqual(previous);
      expect(factor - previous).toBeLessThan(0.1);
      previous = factor;
    }
  });

  it('stays still while a country card is open', () => {
    expect(rotationFactor({ ...base, cardOpen: true })).toBe(0);
  });

  it('never spins when the device asks for reduced motion', () => {
    expect(rotationFactor({ ...base, reduceMotion: true })).toBe(0);
  });
});

describe('advanceLongitude', () => {
  it('moves west at the full rotation speed', () => {
    expect(advanceLongitude(0, 1000, 1)).toBeCloseTo(-ROTATION_DEG_PER_SECOND);
  });

  it('does not move when the factor is zero', () => {
    expect(advanceLongitude(35, 1000, 0)).toBe(35);
  });

  it('wraps around the antimeridian', () => {
    expect(advanceLongitude(-179, 1000, 1)).toBeCloseTo(180 - (ROTATION_DEG_PER_SECOND - 1));
  });
});
