/**
 * What the emergency card and the SOS screen show (sprint 8 F-022, AC-11 to
 * AC-17). Bundled with the app, so it works offline and signed out; read
 * from the server once a session and kept on the device like ADR-008
 * (public reference data, not encrypted, kept after sign-out).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';

import rawMeta from '@/features/globe/countryMeta.json';
import { supabase } from '@/lib/supabase';

import bundled from './emergencyData.json';

export interface Mission {
  id: number;
  adm0: string;
  kind: 'embassy' | 'consulate' | 'office';
  nameHe: string;
  nameEn: string;
  cityHe: string | null;
  cityEn: string | null;
  addressHe: string | null;
  addressEn: string | null;
  hoursHe: string | null;
  hoursEn: string | null;
  phone: string | null;
  emergencyPhone?: string | null;
  covers: string[];
  sourceUrl: string;
}

export interface CountryEmergency {
  adm0: string;
  police: string | null;
  ambulance: string | null;
  fire: string | null;
  touristPolice: string | null;
  shared: string | null;
  numbersStatus: 'verified' | 'pending';
  missionStatus: 'covered' | 'none' | 'pending';
  sourceUrl: string | null;
  verifiedAt: string | null;
}

export interface EmergencyData {
  missions: Mission[];
  countries: CountryEmergency[];
  /** When the missions were read (their "אומת ב-"). */
  missionsReadOn: string;
}

/**
 * Israel's Foreign Ministry emergency center, the fixed backup (AC-12): a
 * constant with its source and the day it was checked, locked by a test.
 */
export const MFA = {
  phone: '+97225303155',
  sourceUrl:
    'https://embassies.gov.il/united-arab-emirates/he/announcements/contact-situation-center-ministry-foreign-affairs-06-march-2026',
  verifiedAt: '2026-10-28',
} as const;

const KEY = 'emergency.v1';

const fromBundle = (): EmergencyData => ({
  missions: bundled.missions as Mission[],
  countries: bundled.countries as CountryEmergency[],
  missionsReadOn: bundled.source.readOn,
});

let current: EmergencyData = fromBundle();
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const publish = (d: EmergencyData) => {
  current = d;
  listeners.forEach((l) => l());
};

async function readServer(): Promise<EmergencyData | null> {
  if (!supabase) return null;
  const [numbers, missions] = await Promise.all([
    supabase
      .from('emergency_numbers')
      .select(
        'adm0, police, ambulance, fire, tourist_police, shared, numbers_status, mission_status, source_url, verified_at',
      )
      .limit(400),
    supabase
      .from('missions')
      .select(
        'id, adm0, kind, name_he, name_en, city_he, city_en, address_he, address_en, hours_he, hours_en, phone, emergency_phone, covers, source_url, verified_at',
      )
      .limit(400),
  ]);
  if (numbers.error || missions.error || !numbers.data?.length) return null;
  const m = missions.data as Record<string, unknown>[];
  return {
    countries: (numbers.data as Record<string, unknown>[]).map((r) => ({
      adm0: r.adm0 as string,
      police: r.police as string | null,
      ambulance: r.ambulance as string | null,
      fire: r.fire as string | null,
      touristPolice: r.tourist_police as string | null,
      shared: r.shared as string | null,
      numbersStatus: r.numbers_status as CountryEmergency['numbersStatus'],
      missionStatus: r.mission_status as CountryEmergency['missionStatus'],
      sourceUrl: r.source_url as string | null,
      verifiedAt: r.verified_at as string | null,
    })),
    missions: m.map((r) => ({
      id: r.id as number,
      adm0: r.adm0 as string,
      kind: r.kind as Mission['kind'],
      nameHe: r.name_he as string,
      nameEn: r.name_en as string,
      cityHe: r.city_he as string | null,
      cityEn: r.city_en as string | null,
      addressHe: r.address_he as string | null,
      addressEn: r.address_en as string | null,
      hoursHe: r.hours_he as string | null,
      hoursEn: r.hours_en as string | null,
      phone: r.phone as string | null,
      emergencyPhone: r.emergency_phone as string | null,
      covers: r.covers as string[],
      sourceUrl: r.source_url as string,
    })),
    missionsReadOn: (m[0]?.verified_at as string | undefined) ?? current.missionsReadOn,
  };
}

/** The device copy, then the server once a session; the bundle until then. */
export function loadEmergency(): Promise<void> {
  loading ??= (async () => {
    try {
      const text = await AsyncStorage.getItem(KEY);
      if (text) publish(JSON.parse(text) as EmergencyData);
    } catch {
      // A broken copy: the bundle stays.
    }
    const server = await readServer().catch(() => null);
    if (server) {
      publish(server);
      void AsyncStorage.setItem(KEY, JSON.stringify(server)).catch(() => {});
    } else loading = null;
  })();
  return loading;
}

export function useEmergency(): EmergencyData {
  const data = useSyncExternalStore(subscribe, () => current);
  useEffect(() => {
    void loadEmergency();
  }, []);
  return data;
}

const parents = rawMeta as unknown as Record<string, { parent?: string }>;

/** A territory with no row of its own uses its sovereign's (spec 8). */
export function countryEmergency(data: EmergencyData, adm0: string): CountryEmergency | null {
  const own = data.countries.find((c) => c.adm0 === adm0);
  if (own) return own;
  const parent = parents[adm0]?.parent;
  return parent ? (data.countries.find((c) => c.adm0 === parent) ?? null) : null;
}

/** The missions serving a country (or its sovereign), the host's own first. */
export function missionsFor(data: EmergencyData, adm0: string): Mission[] {
  const parent = parents[adm0]?.parent;
  const serving = data.missions.filter((m) => m.covers.includes(adm0));
  const list =
    serving.length || !parent ? serving : data.missions.filter((m) => m.covers.includes(parent));
  return [...list].sort((a, b) => Number(b.adm0 === adm0) - Number(a.adm0 === adm0) || a.id - b.id);
}

export type RowKey = 'police' | 'ambulance' | 'fire';

/**
 * Design 12.2: the local numbers as rows. One shared number and no others:
 * one row "police, ambulance and fire". Equal numbers merge into one row.
 */
export function emergencyRows(
  c: Pick<CountryEmergency, RowKey | 'shared'>,
): { keys: (RowKey | 'general')[]; number: string }[] {
  const rows: { keys: (RowKey | 'general')[]; number: string }[] = [];
  const own = (['police', 'ambulance', 'fire'] as const).filter((k) => c[k]);
  if (c.shared && own.length === 0)
    return [{ keys: ['police', 'ambulance', 'fire'], number: c.shared }];
  if (c.shared) rows.push({ keys: ['general'], number: c.shared });
  for (const k of own) {
    const n = c[k]!;
    const row = rows.find((r) => r.number === n && !r.keys.includes('general'));
    if (row) row.keys.push(k);
    else rows.push({ keys: [k], number: n });
  }
  return rows;
}

/** "משטרה, אמבולנס וכבאות" / "Police, ambulance and fire" (design 12.2). */
export function joinLabels(labels: string[], language: string): string {
  const words = language === 'he' ? labels : labels.map((l, i) => (i === 0 ? l : l.toLowerCase()));
  if (words.length <= 1) return words[0] ?? '';
  const head = words.slice(0, -1).join(', ');
  const last = words[words.length - 1];
  return language === 'he' ? `${head} ו${last}` : `${head} and ${last}`;
}

/** Design 13.5: "FCDO" for gov.uk, "gov.il" for gov.il, else the bare host. */
export function sourceName(url: string): string {
  const host = url
    .replace(/^https?:\/\//, '')
    .split('/')[0]!
    .replace(/^www\./, '');
  if (host === 'gov.uk' || host.endsWith('.gov.uk')) return 'FCDO';
  if (host === 'gov.il' || host.endsWith('.gov.il')) return 'gov.il';
  return host;
}
