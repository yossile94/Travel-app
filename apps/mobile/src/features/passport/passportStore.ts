/**
 * Sprint 10 AC-1, AC-4, AC-6 (ADR-015, D4): the passports' details on this
 * device. Each holder is one SecureStore entry: AES-GCM under an Android
 * Keystore key with no authentication, so the banners and the reminders are
 * worked out quietly, offline, and SecureStore's entries are already out of
 * the backup. The photo has its own key, bound to authentication, in the
 * native vault (vault.ts). Nothing here touches the network (D8).
 */
import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';

import { ME_ID, type Holder } from './passportModel';
import { vault } from './vault';

const INDEX = 'passport.index';
const DISMISSED = 'passport.reminder-dismissed';
const entry = (id: string) => `passport.h.${id}`;
/** Local ids: "me" or a UUID; nothing else ever becomes a key or a path. */
export const safeHolderId = (id: string) => id === ME_ID || /^[0-9a-f-]{36}$/i.test(id);

export interface PassportsState {
  status: 'loading' | 'ready' | 'error';
  holders: Holder[];
}

let state: PassportsState = { status: 'loading', holders: [] };
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const changeListeners = new Set<(holders: Holder[]) => void>();

function set(next: PassportsState) {
  state = next;
  listeners.forEach((l) => l());
}

async function readIndex(): Promise<string[]> {
  const text = await SecureStore.getItemAsync(INDEX);
  const ids = text ? (JSON.parse(text) as unknown) : [];
  return Array.isArray(ids)
    ? ids.filter((x): x is string => typeof x === 'string' && safeHolderId(x))
    : [];
}

function parseHolder(id: string, text: string | null): Holder | null {
  if (!text) return null;
  const h = JSON.parse(text) as Partial<Holder>;
  return {
    id,
    isMe: id === ME_ID,
    name: id === ME_ID ? '' : String(h.name ?? ''),
    expiry: typeof h.expiry === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(h.expiry) ? h.expiry : null,
    last4: typeof h.last4 === 'string' && /^[0-9]{4}$/.test(h.last4) ? h.last4 : null,
    hasPhoto: h.hasPhoto === true,
  };
}

/**
 * Reads every holder. A failure leaves the error state and deletes nothing
 * (design 3.4): a key the system lost is the vault's case, not this one.
 */
export function loadPassports(): Promise<void> {
  loading ??= (async () => {
    try {
      const ids = await readIndex();
      const holders: Holder[] = [];
      for (const id of ids) {
        const h = parseHolder(id, await SecureStore.getItemAsync(entry(id)));
        if (h) holders.push(h);
      }
      set({ status: 'ready', holders });
    } catch (e) {
      console.warn('[passport] read failed', (e as Error).name);
      set({ status: 'error', holders: [] });
    } finally {
      loading = null;
    }
  })();
  return loading;
}

function changed(holders: Holder[]) {
  set({ status: 'ready', holders });
  changeListeners.forEach((l) => l(holders));
}

/** Saves one holder (new or not); the index follows. */
export async function saveHolder(h: Holder): Promise<void> {
  if (!safeHolderId(h.id)) throw new Error('bad id');
  // A save before the first read would publish a partial list (Raz review).
  if (state.status !== 'ready') await loadPassports();
  const stored = {
    name: h.isMe ? '' : h.name.trim(),
    expiry: h.expiry,
    last4: h.last4,
    hasPhoto: h.hasPhoto,
  };
  await SecureStore.setItemAsync(entry(h.id), JSON.stringify(stored));
  const ids = await readIndex();
  if (!ids.includes(h.id)) await SecureStore.setItemAsync(INDEX, JSON.stringify([...ids, h.id]));
  const rest = state.holders.filter((x) => x.id !== h.id);
  changed([...rest, { ...h, isMe: h.id === ME_ID, name: stored.name }]);
}

/**
 * Deletes a holder's details, photo and photo key (AC-6). "Me" leaves the
 * list too; the screen shows it again with no date.
 */
export async function deleteHolder(id: string): Promise<void> {
  if (!safeHolderId(id)) return;
  await vault.deletePhoto(id).catch(() => {});
  await SecureStore.deleteItemAsync(entry(id));
  const ids = await readIndex();
  await SecureStore.setItemAsync(INDEX, JSON.stringify(ids.filter((x) => x !== id)));
  changed(state.holders.filter((x) => x.id !== id));
}

/**
 * Design 5, 11 (D5; Raz review, important 1-2): when the wallet opens. With no
 * screen lock the photos, their key and the 4 digits go; with a key the system
 * invalidated, the photos go. Every holder's record follows. "dropped" asks
 * the screen for its one-time explanation.
 */
export async function reconcileVault(
  /** The vault already dropped the photos (opening one found the key gone). */
  alreadyDropped = false,
): Promise<'none' | 'noLock' | 'invalidated'> {
  if (state.status !== 'ready') await loadPassports();
  if (state.status !== 'ready') return 'none';
  const { secure, reset: dropped } = await vault
    .reconcile()
    .catch(() => ({ secure: true, reset: false }));
  const reset = dropped || alreadyDropped;
  // Lock in place and the key usable: nothing changed.
  if (secure && !reset) return 'none';
  const stale = state.holders.filter((h) => h.hasPhoto || (!secure && h.last4));
  if (!stale.length && !reset) return 'none';
  for (const h of stale) {
    await saveHolder({ ...h, hasPhoto: false, last4: secure ? h.last4 : null });
  }
  return secure ? 'invalidated' : 'noLock';
}

/** Sign-out and account deletion (AC-6, design 2.1): everything, then the keys. */
export async function wipePassports(): Promise<void> {
  const ids = await readIndex().catch(() => [] as string[]);
  await vault.wipe().catch(() => {});
  for (const id of ids) await SecureStore.deleteItemAsync(entry(id)).catch(() => {});
  await SecureStore.deleteItemAsync(INDEX).catch(() => {});
  await SecureStore.deleteItemAsync(DISMISSED).catch(() => {});
  changed([]);
}

export async function hasPassports(): Promise<boolean> {
  return (await readIndex().catch(() => [])).length > 0;
}

/** Design 6.4: "not now" hides the reminder card for that trip, for good. Trip ids only. */
export async function dismissedReminders(): Promise<Set<string>> {
  try {
    const text = await SecureStore.getItemAsync(DISMISSED);
    const ids = text ? (JSON.parse(text) as unknown) : [];
    return new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export async function dismissReminder(tripId: string): Promise<void> {
  const ids = await dismissedReminders();
  ids.add(tripId);
  // A long list keeps the newest 200: an old trip's dismissal no longer matters.
  await SecureStore.setItemAsync(DISMISSED, JSON.stringify([...ids].slice(-200)));
}

/** Every change of the holders (saved, deleted, wiped): the alerts re-plan from here. */
export function onPassportsChanged(listener: (holders: Holder[]) => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (state.status !== 'ready' && !loading) void loadPassports();
  return () => listeners.delete(listener);
}

export function usePassports(): PassportsState {
  return useSyncExternalStore(subscribe, () => state);
}

export function passportsSnapshot(): PassportsState {
  return state;
}

/** Tests only. */
export function resetPassportsForTests() {
  state = { status: 'loading', holders: [] };
  loading = null;
}
