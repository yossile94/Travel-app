'use server';

/**
 * Sprint 11 D8, D18 (design 23.3): a country's bundled cities with their
 * points, for "belongs to city" — the app's own file (cities.dat), read once
 * on the server. Nothing is sent anywhere.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import { requireAccess } from './access';

type Areas = Map<string, { name: string; point: [number, number] }[]>;
let areas: Promise<Areas> | null = null;

async function load(): Promise<Areas> {
  const file = path.join(process.cwd(), '../mobile/assets/data/cities.dat');
  const data = JSON.parse(await fs.readFile(file, 'utf8')) as {
    areas: Record<string, [number, string, string, string, number][]>;
    points: Record<string, string>;
  };
  const out: Areas = new Map();
  for (const [adm0, rows] of Object.entries(data.areas)) {
    const bytes = Buffer.from(data.points[adm0] ?? '', 'base64');
    out.set(
      adm0,
      rows
        .map((r, i) =>
          (i + 1) * 4 <= bytes.length
            ? {
                name: r[1] || r[2],
                point: [bytes.readInt16LE(i * 4) / 100, bytes.readInt16LE(i * 4 + 2) / 100] as [
                  number,
                  number,
                ],
              }
            : null,
        )
        .filter((c): c is { name: string; point: [number, number] } => c !== null),
    );
  }
  return out;
}

/** Every bundled city of a country; empty when none or the file can't be read. */
export async function citiesOf(adm0: string): Promise<{ name: string; point: [number, number] }[]> {
  await requireAccess();
  if (!/^[A-Z0-9]{3}$/.test(adm0)) return [];
  areas ??= load().catch(() => {
    areas = null;
    return new Map();
  });
  return (await areas).get(adm0) ?? [];
}
