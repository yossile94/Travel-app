import AsyncStorage from '@react-native-async-storage/async-storage';

import { secureSessionStorage } from './secureSessionStorage';

const mockSecure = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => mockSecure.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSecure.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockSecure.delete(key);
  }),
}));

let mockRandom = 1;
jest.mock('expo-crypto', () => ({
  getRandomBytes: (length: number) =>
    Uint8Array.from({ length }, (_, i) => (i * 31 + mockRandom++ * 7) % 256),
}));

const KEY = 'sb-xjnflplzqmcsodqyiyyj-auth-token';
const SESSION = JSON.stringify({
  access_token: 'access',
  refresh_token: 'refresh',
  user: { id: 'u1' },
});

beforeEach(async () => {
  mockSecure.clear();
  await AsyncStorage.clear();
});

describe('secureSessionStorage (ADR-004)', () => {
  it('reads back what it wrote', async () => {
    await secureSessionStorage.setItem(KEY, SESSION);
    expect(await secureSessionStorage.getItem(KEY)).toBe(SESSION);
  });

  it('keeps nothing readable in AsyncStorage', async () => {
    await secureSessionStorage.setItem(KEY, SESSION);
    const stored = (await AsyncStorage.getItem(KEY))!;
    expect(stored).not.toContain('refresh');
    expect(stored).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
  });

  it('keeps one key across writes, so a read during a write still decrypts', async () => {
    await secureSessionStorage.setItem(KEY, SESSION);
    const key = [...mockSecure.values()][0];
    await secureSessionStorage.setItem(KEY, `${SESSION} `);
    expect([...mockSecure.values()]).toEqual([key]);
    expect(await secureSessionStorage.getItem(KEY)).toBe(`${SESSION} `);
  });

  it('uses a fresh counter for every write', async () => {
    await secureSessionStorage.setItem(KEY, SESSION);
    const first = await AsyncStorage.getItem(KEY);
    await secureSessionStorage.setItem(KEY, SESSION);
    expect(await AsyncStorage.getItem(KEY)).not.toBe(first);
  });

  it('answers "no session" when the key is gone (app data cleared, backup restored)', async () => {
    await secureSessionStorage.setItem(KEY, SESSION);
    mockSecure.clear();
    expect(await secureSessionStorage.getItem(KEY)).toBeNull();
  });

  it('answers "no session" for a corrupted value instead of throwing', async () => {
    await secureSessionStorage.setItem(KEY, SESSION);
    await AsyncStorage.setItem(KEY, 'not-a-ciphertext');
    expect(await secureSessionStorage.getItem(KEY)).toBeNull();
  });

  it('removes both the value and its key', async () => {
    await secureSessionStorage.setItem(KEY, SESSION);
    await secureSessionStorage.removeItem(KEY);
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
    expect(mockSecure.size).toBe(0);
  });
});
