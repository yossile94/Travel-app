/**
 * Exchange rates and travel advisories for the country card (sprint 4
 * F-012, F-013; ADR-008). Public reference data, not personal: read without
 * signing in, and kept on the device without encryption, so the card shows
 * the last values offline and they survive a sign-out (Raz, sprint 4 B-6).
 *
 * Both are small (about 160 rates; about 200 advisories with their text),
 * read whole at most once per app session, and refreshed from the device copy
 * first so the card never waits on the network for what it already has.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';

import type { Rate } from './rateFormat';

export type EntryStatus = 'allowed' | 'restricted' | 'banned';

export interface Advisory {
  adm0: string;
  entryStatus: EntryStatus | null;
  entryNote: string | null;
  entrySourceUrl: string | null;
  entryVerifiedAt: string | null;
  nscLevel: 1 | 2 | 3 | 4 | null;
  nscText: string | null;
  nscUrl: string | null;
  mfaText: string | null;
  mfaUrl: string | null;
  /** When the daily job last saw this area; null: not checked yet. */
  fetchedAt: string | null;
}

export interface Destination {
  rates: Map<string, Rate>;
  advisories: Map<string, Advisory>;
  /** Where the data came from: this session's read, or the device copy. */
  from: 'server' | 'device';
}

const KEY = 'destination-data-v1';

interface Stored {
  rates: Rate[];
  advisories: Advisory[];
}

const fromStored = (s: Stored, from: Destination['from']): Destination => ({
  rates: new Map(s.rates.map((r) => [r.currency, r])),
  advisories: new Map(s.advisories.map((a) => [a.adm0, a])),
  from,
});

async function readServer(): Promise<Stored | null> {
  if (!supabase) return null;
  const [rates, advisories] = await Promise.all([
    supabase
      .from('exchange_rates')
      .select('currency, rate_to_ils, rate_to_usd, source, rate_date, fetched_at'),
    supabase
      .from('country_advisories')
      .select(
        'adm0, entry_status, entry_note, entry_source_url, entry_verified_at, nsc_level, nsc_text, nsc_url, mfa_text, mfa_url, fetched_at',
      ),
  ]);
  if (rates.error || advisories.error) {
    console.warn('[destination] read failed', rates.error?.code ?? advisories.error?.code);
    return null;
  }
  return {
    rates: rates.data.map((r) => ({
      currency: r.currency as string,
      rateToIls: Number(r.rate_to_ils),
      rateToUsd: Number(r.rate_to_usd),
      source: r.source as Rate['source'],
      rateDate: r.rate_date as string,
      fetchedAt: r.fetched_at as string,
    })),
    advisories: advisories.data.map((a) => ({
      adm0: a.adm0 as string,
      entryStatus: (a.entry_status as EntryStatus | null) ?? null,
      entryNote: a.entry_note as string | null,
      entrySourceUrl: a.entry_source_url as string | null,
      entryVerifiedAt: a.entry_verified_at as string | null,
      nscLevel: (a.nsc_level as Advisory['nscLevel']) ?? null,
      nscText: a.nsc_text as string | null,
      nscUrl: a.nsc_url as string | null,
      mfaText: a.mfa_text as string | null,
      mfaUrl: a.mfa_url as string | null,
      fetchedAt: a.fetched_at as string | null,
    })),
  };
}

async function readDevice(): Promise<Stored | null> {
  try {
    const text = await AsyncStorage.getItem(KEY);
    return text ? (JSON.parse(text) as Stored) : null;
  } catch {
    return null;
  }
}

let current: Destination | null = null;
let loading: Promise<Destination | null> | null = null;
const listeners = new Set<(d: Destination) => void>();

function publish(d: Destination) {
  current = d;
  listeners.forEach((l) => l(d));
}

/** The device copy at once, then this session's server read (once). */
export function loadDestination(): Promise<Destination | null> {
  loading ??= (async () => {
    const device = await readDevice();
    if (device && !current) publish(fromStored(device, 'device'));
    const server = await readServer();
    if (server) {
      publish(fromStored(server, 'server'));
      void AsyncStorage.setItem(KEY, JSON.stringify(server)).catch(() => {});
    } else {
      // Offline or failed: a later card tries the server again.
      loading = null;
    }
    return current;
  })();
  return loading;
}

/** For tests. */
export function resetDestination() {
  current = null;
  loading = null;
}

/** The data for a card or a list; null until anything is known. */
export function useDestination(): Destination | null {
  const [data, setData] = useState<Destination | null>(current);
  useEffect(() => {
    listeners.add(setData);
    void loadDestination();
    return () => {
      listeners.delete(setData);
    };
  }, []);
  return data;
}
