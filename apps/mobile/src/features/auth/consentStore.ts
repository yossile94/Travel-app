/**
 * Where consent lives: the server's append-only log (the record that counts)
 * and a copy on this device of the versions agreed to, so the app can tell
 * at launch, even offline, whether the consent screen must block (AC-18a).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

import {
  agreedFromLog,
  type AgreedVersions,
  type LegalDocType,
  type LegalDocument,
} from './consentStatus';

const localKey = (userId: string) => `consent.v1.${userId}`;

export async function readLocalAgreement(userId: string): Promise<AgreedVersions | null> {
  try {
    const stored = await AsyncStorage.getItem(localKey(userId));
    const parsed = stored ? (JSON.parse(stored) as Partial<AgreedVersions>) : null;
    return typeof parsed?.terms === 'number' && typeof parsed.privacy === 'number'
      ? { terms: parsed.terms, privacy: parsed.privacy }
      : null;
  } catch {
    return null;
  }
}

export async function writeLocalAgreement(userId: string, agreed: AgreedVersions): Promise<void> {
  await AsyncStorage.setItem(localKey(userId), JSON.stringify(agreed));
}

/** The versions in force, or null if the server can't be reached. */
export async function fetchCurrentDocuments(): Promise<LegalDocument[] | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('current_legal_documents')
    .select('doc_type, version, url, published_at');
  if (error || !data) return null;
  return data.map((row) => ({
    docType: row.doc_type as LegalDocType,
    version: row.version as number,
    url: (row.url as string | null) ?? null,
    publishedAt: row.published_at as string,
  }));
}

/** What the server's log says this user agreed to (a returning user on a new device). */
export async function fetchAgreementFromLog(): Promise<AgreedVersions | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('consents')
    .select('doc_type, doc_version, action')
    .in('doc_type', ['terms', 'privacy'])
    .order('created_at', { ascending: false })
    .limit(20);
  if (error || !data) return null;
  return agreedFromLog(
    data.map((row) => ({
      docType: row.doc_type as string,
      docVersion: (row.doc_version as number | null) ?? null,
      action: row.action as string,
    })),
  );
}

export interface ConsentChoices {
  /** Both documents, at the versions shown. */
  documents: LegalDocument[];
  /** Optional choices; omitted ones aren't asked again (re-consent for a document only). */
  marketing?: boolean;
  analytics?: boolean;
}

/**
 * Records the decision in the server's log. The server sets the user and the
 * time, and refuses a version that is no longer current (AC-17).
 */
export async function recordConsent(
  choices: ConsentChoices,
): Promise<{ ok: true } | { ok: false; error: unknown }> {
  if (!supabase) return { ok: false, error: new Error('Supabase is not configured') };
  const base = {
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    app_version: Constants.expoConfig?.version ?? 'unknown',
  };
  const rows = [
    ...choices.documents.map((doc) => ({
      ...base,
      doc_type: doc.docType,
      doc_version: doc.version,
      action: 'granted',
    })),
    ...(['marketing', 'analytics'] as const)
      .filter((type) => choices[type] !== undefined)
      .map((type) => ({
        ...base,
        doc_type: type,
        doc_version: null,
        action: choices[type] ? 'granted' : 'withdrawn',
      })),
  ];
  const { error } = await supabase.from('consents').insert(rows);
  return error ? { ok: false, error } : { ok: true };
}
