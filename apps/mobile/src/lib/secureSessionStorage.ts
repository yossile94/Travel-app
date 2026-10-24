/**
 * Encrypted storage for the Supabase session (sprint 1 AC-19, ADR-004).
 *
 * A Supabase session (access and refresh tokens plus the user) is larger than
 * Android's SecureStore comfortably holds, so it lives in AsyncStorage,
 * encrypted with AES-256-CTR. Each value has its own random key, and only
 * that key is kept in SecureStore (the Android Keystore). Reading AsyncStorage
 * alone reveals nothing.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import aesjs from 'aes-js';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

/** SecureStore keys allow only [A-Za-z0-9._-]; Supabase's storage keys contain other characters. */
function keyName(storageKey: string): string {
  return `sb-key.${storageKey.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

async function encrypt(storageKey: string, value: string): Promise<string> {
  const key = Crypto.getRandomBytes(32);
  const counter = Crypto.getRandomBytes(16);
  const cipher = new aesjs.ModeOfOperation.ctr(key, new aesjs.Counter(counter));
  const encrypted = cipher.encrypt(aesjs.utils.utf8.toBytes(value));
  await SecureStore.setItemAsync(keyName(storageKey), aesjs.utils.hex.fromBytes(key));
  return `${aesjs.utils.hex.fromBytes(counter)}:${aesjs.utils.hex.fromBytes(encrypted)}`;
}

async function decrypt(storageKey: string, stored: string): Promise<string | null> {
  const keyHex = await SecureStore.getItemAsync(keyName(storageKey));
  const [counterHex, dataHex] = stored.split(':');
  if (!keyHex || !counterHex || !dataHex) return null;
  const cipher = new aesjs.ModeOfOperation.ctr(
    aesjs.utils.hex.toBytes(keyHex),
    new aesjs.Counter(aesjs.utils.hex.toBytes(counterHex)),
  );
  return aesjs.utils.utf8.fromBytes(cipher.decrypt(aesjs.utils.hex.toBytes(dataHex)));
}

export const secureSessionStorage = {
  async getItem(storageKey: string): Promise<string | null> {
    const stored = await AsyncStorage.getItem(storageKey);
    if (!stored) return null;
    try {
      return await decrypt(storageKey, stored);
    } catch {
      // A value we can't read (e.g. the key was wiped with app data) is no session.
      return null;
    }
  },
  async setItem(storageKey: string, value: string): Promise<void> {
    const stored = await encrypt(storageKey, value);
    await AsyncStorage.setItem(storageKey, stored);
  },
  async removeItem(storageKey: string): Promise<void> {
    await AsyncStorage.removeItem(storageKey);
    await SecureStore.deleteItemAsync(keyName(storageKey));
  },
};
