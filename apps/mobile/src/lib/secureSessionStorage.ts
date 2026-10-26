/**
 * Encrypted storage for the Supabase session (sprint 1 AC-19, ADR-004).
 *
 * A Supabase session (access and refresh tokens plus the user) is larger than
 * Android's SecureStore comfortably holds, so it lives in AsyncStorage,
 * encrypted with AES-256-CTR. The key is created once per storage key and
 * kept in SecureStore (the Android Keystore); every write uses a fresh random
 * counter. Reading AsyncStorage alone reveals nothing, and because the key
 * doesn't change between writes, a read that overlaps a write still decrypts.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import aesjs from 'aes-js';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

/** SecureStore keys allow only [A-Za-z0-9._-]; Supabase's storage keys contain other characters. */
function keyName(storageKey: string): string {
  return `sb-key.${storageKey.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

async function existingKey(storageKey: string): Promise<Uint8Array | null> {
  const keyHex = await SecureStore.getItemAsync(keyName(storageKey));
  return keyHex ? aesjs.utils.hex.toBytes(keyHex) : null;
}

/** Keys being read or created, so two first writes at once can't each create one (review R2-3). */
const pendingKeys = new Map<string, Promise<Uint8Array>>();

/** Writes in flight, so removeItem never runs under one and leaves its value behind. */
const pendingWrites = new Map<string, Promise<void>>();

/** The key for this storage key, created on first use and kept until removeItem. */
function keyFor(storageKey: string): Promise<Uint8Array> {
  let pending = pendingKeys.get(storageKey);
  if (!pending) {
    pending = (async () => {
      const existing = await existingKey(storageKey);
      if (existing) return existing;
      const key = Crypto.getRandomBytes(32);
      await SecureStore.setItemAsync(keyName(storageKey), aesjs.utils.hex.fromBytes(key));
      return key;
    })();
    pendingKeys.set(storageKey, pending);
    // Only the lookup in flight is shared; later calls read SecureStore again.
    const settled = pending;
    void settled
      .catch(() => {})
      .finally(() => {
        if (pendingKeys.get(storageKey) === settled) pendingKeys.delete(storageKey);
      });
  }
  return pending;
}

/**
 * Removes every stored Supabase session entry (sb-*) and its key. Used after
 * a local sign-out: supabase-js returns early without removing the session
 * when it can't read it (offline with an expired token, sprint 2 QA D-1),
 * and a session left behind would sign the user back in once online.
 */
export async function clearStoredSessions(): Promise<void> {
  const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith('sb-'));
  await Promise.all(keys.map((key) => secureSessionStorage.removeItem(key).catch(() => {})));
}

export const secureSessionStorage = {
  async getItem(storageKey: string): Promise<string | null> {
    const stored = await AsyncStorage.getItem(storageKey);
    if (!stored) return null;
    try {
      const key = await existingKey(storageKey);
      const [counterHex, dataHex] = stored.split(':');
      if (!key || !counterHex || !dataHex) return null;
      const cipher = new aesjs.ModeOfOperation.ctr(
        key,
        new aesjs.Counter(aesjs.utils.hex.toBytes(counterHex)),
      );
      return aesjs.utils.utf8.fromBytes(cipher.decrypt(aesjs.utils.hex.toBytes(dataHex)));
    } catch {
      // A value we can't read (e.g. the key was wiped with app data) is no session.
      return null;
    }
  },
  setItem(storageKey: string, value: string): Promise<void> {
    const write = (async () => {
      const key = await keyFor(storageKey);
      const counter = Crypto.getRandomBytes(16);
      const cipher = new aesjs.ModeOfOperation.ctr(key, new aesjs.Counter(counter));
      const encrypted = cipher.encrypt(aesjs.utils.utf8.toBytes(value));
      await AsyncStorage.setItem(
        storageKey,
        `${aesjs.utils.hex.fromBytes(counter)}:${aesjs.utils.hex.fromBytes(encrypted)}`,
      );
    })();
    pendingWrites.set(storageKey, write);
    void write
      .catch(() => {})
      .finally(() => {
        if (pendingWrites.get(storageKey) === write) pendingWrites.delete(storageKey);
      });
    return write;
  },
  async removeItem(storageKey: string): Promise<void> {
    // A write in flight (and the key it may be creating) would otherwise land after the delete.
    await pendingWrites.get(storageKey)?.catch(() => {});
    await pendingKeys.get(storageKey)?.catch(() => {});
    pendingKeys.delete(storageKey);
    // The key first (AC-12, Raz S4-m14): if the second delete fails, what is
    // left can't be read.
    await SecureStore.deleteItemAsync(keyName(storageKey));
    await AsyncStorage.removeItem(storageKey);
  },
};
