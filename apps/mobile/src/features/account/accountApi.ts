/**
 * The account area's server calls (sprint 2 F-004, F-005): the display name
 * (AC-12) and the optional consents (AC-13). Like the trips calls, errors are
 * logged with their code only, never the error object.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';
import { limits } from '@/theme/tokens';

import { codePointLength, toPgDate } from '../trips/tripDates';

export type SaveResult = 'ok' | 'offline' | 'error';

function logFailure(step: string, error: unknown): void {
  const code = (error as { code?: unknown } | null)?.code;
  console.error(`[account] ${step} failed`, typeof code === 'string' ? code : 'no code');
}

async function online(): Promise<boolean> {
  const net = await NetInfo.fetch();
  return net.isConnected !== false;
}

/** A name as the database accepts it (profiles_display_name_check), or null. */
export function cleanDisplayName(name: string | null | undefined): string | null {
  const trimmed = (name ?? '').replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  return [...trimmed].slice(0, limits.profileNameMax).join('').trim() || null;
}

/** The rule of the name editor (design 8.2): an error key, or null. */
export function displayNameError(name: string): string | null {
  const length = codePointLength(name.trim());
  if (length === 0) return 'nameEdit.required';
  if (length > limits.profileNameMax) return 'nameEdit.tooLong';
  return null;
}

/**
 * Creates a missing profile with the name from Google (AC-12). DO NOTHING on
 * conflict, so a name changed on another device is never overwritten (ADR-006 5).
 */
export async function ensureProfile(
  userId: string,
  googleName: string | null,
  email: string | null,
) {
  if (!supabase) return;
  const name = cleanDisplayName(googleName) ?? cleanDisplayName(email?.split('@')[0]);
  if (!name) return;
  const { error } = await supabase
    .from('profiles')
    .upsert({ id: userId, display_name: name }, { onConflict: 'id', ignoreDuplicates: true });
  if (error) logFailure('ensure profile', error);
}

/** The display name, or null when there is no profile or it can't be read. */
export async function loadDisplayName(userId: string): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    logFailure('load profile', error);
    return null;
  }
  return (data?.display_name as string | undefined) ?? null;
}

/** Renames: an upsert that merges, so it also creates a missing profile (design 8.1). */
export async function saveDisplayName(userId: string, name: string): Promise<SaveResult> {
  if (!supabase) return 'error';
  if (!(await online())) return 'offline';
  const { error } = await supabase
    .from('profiles')
    .upsert({ id: userId, display_name: name.trim() }, { onConflict: 'id' });
  if (error) {
    logFailure('rename', error);
    return 'error';
  }
  return 'ok';
}

export type OptionalChoice = 'marketing' | 'analytics';
export type OptionalChoices = Record<OptionalChoice, boolean>;

/** The device's copy of the optional choices (design 9.1: shown offline too). */
const choicesKey = (userId: string) => `consent.optional.v1.${userId}`;

export async function readLocalChoices(userId: string): Promise<OptionalChoices | null> {
  try {
    const stored = await AsyncStorage.getItem(choicesKey(userId));
    const parsed = stored ? (JSON.parse(stored) as Partial<OptionalChoices>) : null;
    return typeof parsed?.marketing === 'boolean' && typeof parsed.analytics === 'boolean'
      ? { marketing: parsed.marketing, analytics: parsed.analytics }
      : null;
  } catch {
    return null;
  }
}

export async function writeLocalChoices(userId: string, choices: OptionalChoices): Promise<void> {
  await AsyncStorage.setItem(choicesKey(userId), JSON.stringify(choices)).catch(() => {});
}

export async function removeLocalChoices(userId: string): Promise<void> {
  await AsyncStorage.removeItem(choicesKey(userId)).catch(() => {});
}

/** The latest decision per optional choice, from the server's log; never asked: false. */
export async function fetchChoices(): Promise<OptionalChoices | null> {
  if (!supabase) return null;
  // One exact read per choice (index consents_user_type_time): a long run of
  // changes to one choice can't push the other out of a shared page (review).
  const latest = async (type: OptionalChoice) => {
    const { data, error } = await supabase!
      .from('consents')
      .select('action')
      .eq('doc_type', type)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1);
    if (error || !data) {
      if (error) logFailure('load choices', error);
      return null;
    }
    return (data as { action: string }[])[0]?.action === 'granted';
  };
  const [marketing, analytics] = await Promise.all([latest('marketing'), latest('analytics')]);
  if (marketing === null || analytics === null) return null;
  return { marketing, analytics };
}

/**
 * When each document version was agreed (AC-13): the latest "granted" row of
 * that version, as a local date. Null when it can't be read (offline).
 */
export async function fetchAgreedDates(
  agreed: Record<'terms' | 'privacy', number>,
): Promise<Partial<Record<'terms' | 'privacy', string>> | null> {
  if (!supabase) return null;
  const read = async (type: 'terms' | 'privacy') => {
    const { data, error } = await supabase!
      .from('consents')
      .select('created_at')
      .eq('doc_type', type)
      .eq('doc_version', agreed[type])
      .eq('action', 'granted')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1);
    if (error || !data) {
      if (error) logFailure('load agreement date', error);
      return undefined;
    }
    const at = (data as { created_at: string }[])[0]?.created_at;
    return at ? toPgDate(new Date(at)) : undefined;
  };
  const [terms, privacy] = await Promise.all([read('terms'), read('privacy')]);
  return { terms, privacy };
}

/** One tap = one new row in the log (AC-13); the local copy changes only after it. */
export async function recordChoice(
  userId: string,
  type: OptionalChoice,
  granted: boolean,
  current: OptionalChoices,
): Promise<SaveResult> {
  if (!supabase) return 'error';
  if (!(await online())) return 'offline';
  const { error } = await supabase.from('consents').insert({
    doc_type: type,
    doc_version: null,
    action: granted ? 'granted' : 'withdrawn',
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    app_version: Constants.expoConfig?.version ?? 'unknown',
  });
  if (error) {
    logFailure('record choice', error);
    return 'error';
  }
  // Merged into what is stored now, so two choices saving at once both land.
  const stored = (await readLocalChoices(userId)) ?? current;
  await writeLocalChoices(userId, { ...stored, [type]: granted });
  return 'ok';
}
