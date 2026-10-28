// Sprint 8 AC-9 (Dana 2): the policy file is encrypted at rest, refused when
// too big or not a PDF or image, the picker's plain copy never stays, and
// removal and wipe leave nothing.

// jest.mock calls are hoisted above these imports.
import * as IntentLauncher from 'expo-intent-launcher';
import { Platform } from 'react-native';

import {
  MAX_BYTES,
  openPolicy,
  policyMeta,
  removePolicy,
  savePolicy,
  wipePolicies,
} from './policyFile';

// A small in-memory stand-in for expo-file-system's File, Directory and Paths.
const mockFiles = new Map<string, Uint8Array>();
const mockDirs = new Set<string>();
jest.mock('expo-file-system', () => {
  const join = (parts: unknown[]) =>
    parts.map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri)).join('/');
  class Handle {
    offset = 0;
    path: string;
    constructor(path: string) {
      this.path = path;
    }
    private get data() {
      return mockFiles.get(this.path) ?? new Uint8Array();
    }
    readBytesSync(n: number) {
      const out = this.data.slice(this.offset, this.offset + n);
      this.offset += out.length;
      return out;
    }
    async readBytes(n: number) {
      return this.readBytesSync(n);
    }
    writeBytesSync(bytes: Uint8Array) {
      const next = new Uint8Array(this.data.length + bytes.length);
      next.set(this.data);
      next.set(bytes, this.data.length);
      mockFiles.set(this.path, next);
    }
    close() {}
  }
  class File {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }
    get exists() {
      return mockFiles.has(this.uri);
    }
    get size() {
      return mockFiles.get(this.uri)?.length ?? 0;
    }
    get name() {
      return this.uri.split('/').pop()!;
    }
    get contentUri() {
      return `content://${this.uri}`;
    }
    create() {
      mockFiles.set(this.uri, new Uint8Array());
    }
    delete() {
      mockFiles.delete(this.uri);
    }
    open() {
      return new Handle(this.uri);
    }
    moveSync(to: File) {
      mockFiles.set(to.uri, mockFiles.get(this.uri)!);
      mockFiles.delete(this.uri);
      this.uri = to.uri;
    }
    writeSync(text: string) {
      mockFiles.set(this.uri, new TextEncoder().encode(text));
    }
    textSync() {
      return new TextDecoder().decode(mockFiles.get(this.uri));
    }
  }
  class Directory {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }
    get exists() {
      return mockDirs.has(this.uri);
    }
    create() {
      mockDirs.add(this.uri);
    }
    delete() {
      mockDirs.delete(this.uri);
      for (const k of [...mockFiles.keys()]) if (k.startsWith(`${this.uri}/`)) mockFiles.delete(k);
    }
  }
  return {
    File,
    Directory,
    FileMode: { ReadOnly: 'r', WriteOnly: 'w' },
    Paths: { document: new Directory('doc'), cache: new Directory('cache') },
  };
});
const mockSecure = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => mockSecure.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => void mockSecure.set(k, v)),
  deleteItemAsync: jest.fn(async (k: string) => void mockSecure.delete(k)),
}));
jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) % 256),
}));
jest.mock('expo-intent-launcher', () => ({ startActivityAsync: jest.fn(async () => ({})) }));

const trip = '10000000-0000-4000-8000-000000000001';
const pdf = new TextEncoder().encode('%PDF-1.4 the policy text');

function picked(bytes: Uint8Array, mimeType = 'application/pdf') {
  mockFiles.set('cache/DocumentPicker/policy.pdf', bytes);
  return { uri: 'cache/DocumentPicker/policy.pdf', mimeType, size: bytes.length };
}

beforeEach(() => {
  mockFiles.clear();
  mockDirs.clear();
  mockSecure.clear();
  Platform.OS = 'android';
});

it('encrypts the file: no %PDF at rest, the meta says what it is', async () => {
  expect(await savePolicy(trip, picked(pdf), '2026-10-28')).toBe('ok');
  const stored = mockFiles.get(`doc/policy/${trip}.bin`)!;
  expect(stored.length).toBe(16 + pdf.length);
  expect(new TextDecoder().decode(stored.slice(16, 20))).not.toBe('%PDF');
  expect(policyMeta(trip)).toEqual({
    kind: 'pdf',
    mime: 'application/pdf',
    size: pdf.length,
    addedAt: '2026-10-28',
  });
  expect(mockSecure.size).toBe(1);
});

it('opening decrypts to a cache copy and hands Android a content URI', async () => {
  await savePolicy(trip, picked(pdf), '2026-10-28');
  expect(await openPolicy(trip)).toBe('ok');
  expect(mockFiles.get('cache/policy-view/policy.pdf')).toEqual(pdf);
  expect(IntentLauncher.startActivityAsync).toHaveBeenCalledWith(
    'android.intent.action.VIEW',
    expect.objectContaining({ data: 'content://cache/policy-view/policy.pdf', flags: 1 }),
  );
});

it('refuses a file over 10MB, and another type; the plain copy goes either way', async () => {
  const big = {
    uri: 'cache/DocumentPicker/policy.pdf',
    mimeType: 'application/pdf',
    size: MAX_BYTES + 1,
  };
  mockFiles.set(big.uri, new Uint8Array(4));
  expect(await savePolicy(trip, big, '2026-10-28')).toBe('tooBig');
  expect(mockFiles.has(big.uri)).toBe(false);
  expect(await savePolicy(trip, picked(pdf, 'text/plain'), '2026-10-28')).toBe('type');
  expect(mockFiles.has('cache/DocumentPicker/policy.pdf')).toBe(false);
  expect(policyMeta(trip)).toBeNull();
});

it('the picker copy is deleted after a save too', async () => {
  await savePolicy(trip, picked(pdf), '2026-10-28');
  expect(mockFiles.has('cache/DocumentPicker/policy.pdf')).toBe(false);
});

it('removal deletes the file and its meta', async () => {
  await savePolicy(trip, picked(pdf), '2026-10-28');
  removePolicy(trip);
  expect(policyMeta(trip)).toBeNull();
  expect([...mockFiles.keys()].filter((k) => k.startsWith('doc/'))).toEqual([]);
});

it('wipe (sign-out, deletion) removes every file and the key', async () => {
  await savePolicy(trip, picked(pdf), '2026-10-28');
  await openPolicy(trip);
  await wipePolicies();
  expect([...mockFiles.keys()]).toEqual([]);
  expect(mockSecure.size).toBe(0);
});

it('outside Android nothing is decrypted', async () => {
  await savePolicy(trip, picked(pdf), '2026-10-28');
  Platform.OS = 'ios';
  expect(await openPolicy(trip)).toBe('error');
  expect(mockFiles.has('cache/policy-view/policy.pdf')).toBe(false);
});
