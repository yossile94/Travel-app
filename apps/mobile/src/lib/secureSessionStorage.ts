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

/** The key for this storage key, created on first use and kept until removeItem. */
async function keyFor(storageKey: string): Promise<Uint8Array> {
  const existing = await existingKey(storageKey);
  if (existing) return existing;
  const key = Crypto.getRandomBytes(32);
  await SecureStore.setItemAsync(keyName(storageKey), aesjs.utils.hex.fromBytes(key));
  return key;
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
  async setItem(storageKey: string, value: string): Promise<void> {
    const key = await keyFor(storageKey);
    const counter = Crypto.getRandomBytes(16);
    const cipher = new aesjs.ModeOfOperation.ctr(key, new aesjs.Counter(counter));
    const encrypted = cipher.encrypt(aesjs.utils.utf8.toBytes(value));
    await AsyncStorage.setItem(
      storageKey,
      `${aesjs.utils.hex.fromBytes(counter)}:${aesjs.utils.hex.fromBytes(encrypted)}`,
    );
  },
  async removeItem(storageKey: string): Promise<void> {
    await AsyncStorage.removeItem(storageKey);
    await SecureStore.deleteItemAsync(keyName(storageKey));
  },
};
