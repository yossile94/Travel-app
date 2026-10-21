/**
 * Day/night terminator for the home globe (spec 12.3, sprint 0 AC-3).
 *
 * Uses the NOAA low-precision solar position formulas, which are accurate to
 * well under a degree — more than enough for a visual terminator. Everything
 * here is pure and takes the time as an argument so it can be tested with a
 * fixed clock.
 */

export type LngLat = [longitude: number, latitude: number];

export interface NightPolygon {
  type: 'Feature';
  properties: Record<string, never>;
  geometry: { type: 'Polygon'; coordinates: LngLat[][] };
}

const DEG = Math.PI / 180;
const MS_PER_DAY = 86_400_000;
// Julian day of the Unix epoch.
const JD_UNIX_EPOCH = 2_440_587.5;
// Julian day of J2000.0 (2000-01-01 12:00 TT).
const JD_J2000 = 2_451_545;

/** The point on Earth where the sun is directly overhead, in degrees. */
export function subsolarPoint(date: Date): { lat: number; lng: number } {
  const julianDay = date.getTime() / MS_PER_DAY + JD_UNIX_EPOCH;
  const centuries = (julianDay - JD_J2000) / 36_525;

  const meanLongitude = normalizeDegrees(
    280.46646 + centuries * (36_000.76983 + centuries * 0.0003032),
  );
  const meanAnomaly = 357.52911 + centuries * (35_999.05029 - 0.0001537 * centuries);
  const eccentricity = 0.016708634 - centuries * (0.000042037 + 0.0000001267 * centuries);

  const equationOfCenter =
    Math.sin(meanAnomaly * DEG) * (1.914602 - centuries * (0.004817 + 0.000014 * centuries)) +
    Math.sin(2 * meanAnomaly * DEG) * (0.019993 - 0.000101 * centuries) +
    Math.sin(3 * meanAnomaly * DEG) * 0.000289;

  const trueLongitude = meanLongitude + equationOfCenter;
  const omega = 125.04 - 1934.136 * centuries;
  const apparentLongitude = trueLongitude - 0.00569 - 0.00478 * Math.sin(omega * DEG);

  const meanObliquity =
    23 +
    (26 + (21.448 - centuries * (46.815 + centuries * (0.00059 - centuries * 0.001813))) / 60) / 60;
  const obliquity = meanObliquity + 0.00256 * Math.cos(omega * DEG);

  const declination =
    Math.asin(Math.sin(obliquity * DEG) * Math.sin(apparentLongitude * DEG)) / DEG;

  // Equation of time, in minutes: how far true solar time runs ahead of mean time.
  const y = Math.tan((obliquity / 2) * DEG) ** 2;
  const equationOfTime =
    (4 / DEG) *
    (y * Math.sin(2 * meanLongitude * DEG) -
      2 * eccentricity * Math.sin(meanAnomaly * DEG) +
      4 * eccentricity * y * Math.sin(meanAnomaly * DEG) * Math.cos(2 * meanLongitude * DEG) -
      0.5 * y * y * Math.sin(4 * meanLongitude * DEG) -
      1.25 * eccentricity * eccentricity * Math.sin(2 * meanAnomaly * DEG));

  const utcMinutes =
    date.getUTCHours() * 60 +
    date.getUTCMinutes() +
    date.getUTCSeconds() / 60 +
    date.getUTCMilliseconds() / 60_000;
  // At 12:00 true solar time the sun is over the prime meridian.
  const lng = normalizeLongitude(-((utcMinutes + equationOfTime - 720) / 4));

  return { lat: declination, lng };
}

/**
 * The night side of the Earth as a GeoJSON polygon, closed over the pole that
 * is currently in darkness.
 *
 * @param steps number of points along the terminator; 180 gives a smooth line
 *   on a phone-sized globe without a heavy shape.
 */
export function nightPolygon(date: Date, steps = 180): NightPolygon {
  const sun = subsolarPoint(date);
  // Near the equinoxes the declination approaches zero and the terminator
  // becomes a meridian circle; clamp to keep the formula finite.
  const declination = Math.abs(sun.lat) < 0.01 ? Math.sign(sun.lat || 1) * 0.01 : sun.lat;
  const tanDeclination = Math.tan(declination * DEG);

  const terminatorAt = (lng: number): LngLat => {
    const hourAngle = (lng - sun.lng) * DEG;
    return [lng, Math.atan(-Math.cos(hourAngle) / tanDeclination) / DEG];
  };

  const start = terminatorAt(-180);
  const ring: LngLat[] = [start];
  for (let i = 1; i <= steps; i++) ring.push(terminatorAt(-180 + (360 * i) / steps));

  // When the sun is north of the equator the south pole is in darkness.
  const darkPole = declination > 0 ? -90 : 90;
  ring.push([180, darkPole], [-180, darkPole], start);

  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } };
}

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function normalizeLongitude(value: number): number {
  const lng = normalizeDegrees(value + 180) - 180;
  return lng === -180 ? 180 : lng;
}
