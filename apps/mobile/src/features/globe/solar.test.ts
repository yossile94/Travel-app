import { nightPolygon, subsolarPoint, type LngLat } from './solar';

const JUNE_SOLSTICE = new Date(Date.UTC(2026, 5, 21, 8, 24));
const DECEMBER_SOLSTICE = new Date(Date.UTC(2026, 11, 21, 20, 50));
const MARCH_EQUINOX = new Date(Date.UTC(2026, 2, 20, 14, 46));
const AN_EVENING_IN_OCTOBER = new Date(Date.UTC(2026, 9, 21, 17, 40));

function ringOf(date: Date, steps?: number): LngLat[] {
  const [ring] = nightPolygon(date, steps).geometry.coordinates;
  if (!ring) throw new Error('night polygon has no ring');
  return ring;
}

// Ray casting in plain lng/lat. Good enough to check which side of the
// terminator a point is on, as long as it is away from the poles.
function isInside([x, y]: LngLat, ring: LngLat[]): boolean {
  let inside = false;
  ring.forEach(([xi, yi], i) => {
    const [xj, yj] = ring.at(i - 1) ?? [xi, yi];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  });
  return inside;
}

describe('subsolarPoint', () => {
  it('puts the sun over the Tropic of Cancer at the June solstice', () => {
    expect(subsolarPoint(JUNE_SOLSTICE).lat).toBeCloseTo(23.44, 1);
  });

  it('puts the sun over the Tropic of Capricorn at the December solstice', () => {
    expect(subsolarPoint(DECEMBER_SOLSTICE).lat).toBeCloseTo(-23.44, 1);
  });

  it('puts the sun over the equator at the March equinox', () => {
    expect(Math.abs(subsolarPoint(MARCH_EQUINOX).lat)).toBeLessThan(0.05);
  });

  it('puts the sun near the prime meridian at noon UTC, corrected by the equation of time', () => {
    // Early November the equation of time is about +16.4 minutes, so the sun
    // crosses the prime meridian ~16 minutes before 12:00 UTC. By 12:00 it has
    // already moved on ~4.1° west.
    const { lng } = subsolarPoint(new Date(Date.UTC(2026, 10, 3, 12, 0)));
    expect(lng).toBeCloseTo(-4.1, 0);
  });

  it('moves the sun 15° west every hour', () => {
    const at = (hour: number) => subsolarPoint(new Date(Date.UTC(2026, 9, 21, hour, 0))).lng;
    expect(at(13) - at(14)).toBeCloseTo(15, 1);
  });

  it('keeps the longitude within -180..180', () => {
    for (let hour = 0; hour < 24; hour++) {
      const { lng } = subsolarPoint(new Date(Date.UTC(2026, 0, 1, hour, 30)));
      expect(lng).toBeGreaterThan(-180);
      expect(lng).toBeLessThanOrEqual(180);
    }
  });
});

describe('nightPolygon', () => {
  it.each([JUNE_SOLSTICE, DECEMBER_SOLSTICE, MARCH_EQUINOX, AN_EVENING_IN_OCTOBER])(
    'leaves the subsolar point in daylight and its antipode in darkness (%s)',
    (date) => {
      const ring = ringOf(date);
      const sun = subsolarPoint(date);
      const antipodeLng = sun.lng > 0 ? sun.lng - 180 : sun.lng + 180;

      expect(isInside([sun.lng, sun.lat], ring)).toBe(false);
      expect(isInside([antipodeLng, -sun.lat], ring)).toBe(true);
    },
  );

  it('is a closed ring that wraps the whole globe', () => {
    const ring = ringOf(JUNE_SOLSTICE, 90);
    expect(ring.at(0)).toEqual(ring.at(-1));
    expect(ring.at(0)?.[0]).toBe(-180);
    expect(ring.at(90)?.[0]).toBe(180);
  });

  it('closes over the south pole in northern summer and the north pole in northern winter', () => {
    expect(ringOf(JUNE_SOLSTICE)).toContainEqual([180, -90]);
    expect(ringOf(DECEMBER_SOLSTICE)).toContainEqual([180, 90]);
  });

  it('stays finite at the exact equinox', () => {
    for (const [lng, lat] of ringOf(MARCH_EQUINOX)) {
      expect(Number.isFinite(lng)).toBe(true);
      expect(Number.isFinite(lat)).toBe(true);
    }
  });
});
