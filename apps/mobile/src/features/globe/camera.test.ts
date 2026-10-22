import {
  MAX_COUNTRY_ZOOM,
  MIN_COUNTRY_ZOOM,
  flightDuration,
  greatCircleDegrees,
  rotationPlan,
  westOf,
  zoomForSpan,
} from './camera';

describe('zoomForSpan', () => {
  it('zooms in further for smaller countries', () => {
    expect(zoomForSpan(4)).toBeGreaterThan(zoomForSpan(15));
    expect(zoomForSpan(15)).toBeGreaterThan(zoomForSpan(80));
  });

  it('stays within the allowed range', () => {
    expect(zoomForSpan(0)).toBe(MAX_COUNTRY_ZOOM);
    expect(zoomForSpan(170)).toBe(MIN_COUNTRY_ZOOM);
  });

  it('shows Israel at a city-region zoom', () => {
    expect(zoomForSpan(3.92)).toBeCloseTo(4.97, 1);
  });
});

describe('greatCircleDegrees', () => {
  it('measures along the sphere', () => {
    expect(greatCircleDegrees([0, 0], [90, 0])).toBeCloseTo(90);
    expect(greatCircleDegrees([0, 0], [180, 0])).toBeCloseTo(180);
    expect(greatCircleDegrees([170, 0], [-170, 0])).toBeCloseTo(20);
  });
});

describe('flightDuration', () => {
  it('is 1.2 s for a neighbour and 1.8 s for the antipode (AC-4)', () => {
    expect(flightDuration([34.8, 31], [34.8, 31])).toBe(1200);
    expect(flightDuration([0, 0], [180, 0])).toBe(1800);
  });

  it('grows with distance', () => {
    const israel: [number, number] = [34.8, 31];
    expect(flightDuration(israel, [100, 15])).toBeGreaterThan(flightDuration(israel, [23, 39]));
  });
});

describe('rotationPlan', () => {
  const plan = rotationPlan();

  it('ramps up over one second, then rotates steadily (AC-2)', () => {
    const ramp = plan.slice(0, -1);
    expect(ramp.reduce((t, s) => t + s.durationMs, 0)).toBeCloseTo(1000);
    const speeds = plan.map((s) => s.degrees / s.durationMs);
    for (let i = 1; i < speeds.length; i++) expect(speeds[i]).toBeGreaterThan(speeds[i - 1]!);
  });

  it('turns at 3°/s once at full speed', () => {
    const last = plan.at(-1)!;
    expect((last.degrees / last.durationMs) * 1000).toBeCloseTo(3);
  });
});

describe('westOf', () => {
  it('moves west and wraps at the antimeridian', () => {
    expect(westOf(10, 3)).toBe(7);
    expect(westOf(-179, 3)).toBe(178);
  });
});
