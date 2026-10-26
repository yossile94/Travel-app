/**
 * The bundled climate normals (scripts/build-climate.mjs; sprint 3 AC-10 to
 * AC-12). Loaded the first time a card asks for a temperature, never before
 * the first frame, then kept for the session. The card never loads the city
 * list: a trip's city is found here by its GeoNames id (design 5.7).
 */
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import { useEffect, useState } from 'react';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const CLIMATE = require('../../../assets/data/climate.dat') as number;

interface ClimateFile {
  format: string;
  scale: number;
  cells: string;
  cities: number[];
  areas: Record<string, [number, number, string, string]>;
}

/** Twelve monthly normals, in hundredths of a degree, January first. */
export type Normals = number[];

export interface AreaClimate {
  normals: Normals;
  /** The climate point's city (AC-10 levels 1 and 2); null at the label point. */
  city: { id: number; nameHe: string; nameEn: string } | null;
}

export interface Climate {
  area(adm0: string): AreaClimate | null;
  city(geonameId: number): Normals | null;
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** base64 to bytes, without atob's binary string (Hermes): small and exact. */
export function decodeBase64(text: string): Uint8Array {
  const clean = text.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let o = 0;
  for (let i = 0; i < clean.length; i++) {
    const v = BASE64.indexOf(clean[i]!);
    if (v < 0) throw new Error('climate: bad base64');
    value = (value << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (value >> bits) & 0xff;
    }
  }
  return out;
}

/** The parsed file; exported for tests. */
export function parseClimate(text: string): Climate {
  const data = JSON.parse(text) as ClimateFile;
  if (data.format !== 'travel-app-climate' || data.scale !== 100) {
    throw new Error('climate: unknown format');
  }
  const bytes = decodeBase64(data.cells);
  const view = new DataView(bytes.buffer);
  const normals = (slot: number): Normals =>
    Array.from({ length: 12 }, (_, m) => view.getInt16((slot * 12 + m) * 2, true));
  const citySlot = new Map<number, number>();
  let id = 0;
  for (let i = 0; i < data.cities.length; i += 2) {
    id += data.cities[i]!;
    citySlot.set(id, data.cities[i + 1]!);
  }
  return {
    area(adm0) {
      const entry = data.areas[adm0];
      if (!entry) return null;
      const [slot, cityId, nameHe, nameEn] = entry;
      return { normals: normals(slot), city: cityId ? { id: cityId, nameHe, nameEn } : null };
    },
    city(geonameId) {
      const slot = citySlot.get(geonameId);
      return slot === undefined ? null : normals(slot);
    },
  };
}

let loading: Promise<Climate> | null = null;

export function loadClimate(): Promise<Climate> {
  loading ??= (async () => {
    const asset = await Asset.fromModule(CLIMATE).downloadAsync();
    return parseClimate(await new File(asset.localUri ?? asset.uri).text());
  })().catch((error: unknown) => {
    // A later card tries again.
    loading = null;
    throw error;
  });
  return loading;
}

export type ClimateState =
  | { status: 'loading'; showSkeleton: boolean }
  | { status: 'ready'; climate: Climate }
  | { status: 'failed' };

/** Design 1.2: nothing for 150 ms, then a skeleton, then the value; hidden on failure. */
export function useClimate(): ClimateState {
  const [state, setState] = useState<ClimateState>({ status: 'loading', showSkeleton: false });
  useEffect(() => {
    let live = true;
    const skeleton = setTimeout(() => {
      if (live) setState((s) => (s.status === 'loading' ? { ...s, showSkeleton: true } : s));
    }, 150);
    loadClimate().then(
      (climate) => live && setState({ status: 'ready', climate }),
      (error: unknown) => {
        // A code only, no message to the user: the field is secondary (design 1.2).
        console.warn('[climate] climate_load_failed', (error as Error)?.name);
        if (live) setState({ status: 'failed' });
      },
    );
    return () => {
      live = false;
      clearTimeout(skeleton);
    };
  }, []);
  return state;
}
