import { decodeBase64, parseClimate } from './climateData';

// The real file, read by Jest (the app reads it through expo-asset).
declare const __dirname: string;
const { readFileSync } = jest.requireActual<{
  readFileSync(path: string, encoding: 'utf8'): string;
}>('fs');
const text = readFileSync(`${__dirname}/../../../assets/data/climate.dat`, 'utf8');

describe('the climate file in the app (sprint 3 AC-10, AC-11)', () => {
  const climate = parseClimate(text);

  it('decodes base64 the same way Node does', () => {
    expect([...decodeBase64('AAH+/3+ACQ==')]).toEqual([0, 1, 254, 255, 127, 128, 9]);
  });

  it("gives an area's climate point with its city", () => {
    const thailand = climate.area('THA')!;
    expect(thailand.city).toEqual({ id: 1609350, nameHe: 'בנגקוק', nameEn: 'Bangkok' });
    expect(thailand.normals).toHaveLength(12);
    expect(thailand.normals[0]! / 100).toBeCloseTo(27.3, 0);
  });

  it('has nothing for an area without a value (the field is hidden)', () => {
    expect(climate.area('ATA')).toBeNull();
  });

  it("finds a trip's city by its GeoNames id, without the city list", () => {
    expect(climate.city(2643743)![6]! / 100).toBeCloseTo(17.8, 0);
    expect(climate.city(1)).toBeNull();
  });

  it('refuses a file in another format', () => {
    expect(() => parseClimate('{"format":"x","scale":100}')).toThrow();
  });
});
