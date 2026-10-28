/**
 * The insurance policy document (sprint 8 AC-9; Raz design note 2): kept only
 * on this device, never uploaded, and encrypted at rest so an Android backup
 * of the app's files reveals nothing.
 *
 * Same key scheme as ADR-009: a random AES-256 key in SecureStore (the
 * Android Keystore). The file is AES-CTR in 256 KB chunks, written as binary
 * to the document directory: [16-byte counter][ciphertext]. The JS thread
 * yields between chunks, and progress is reported for the busy state.
 *
 * Viewing decrypts to a cache file and hands Android a content URI; that
 * copy is removed on the next open, on removal and on every wipe.
 */
import aesjs from 'aes-js';
import * as Crypto from 'expo-crypto';
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export const MAX_BYTES = 10 * 1024 * 1024;
const CHUNK = 256 * 1024;
const KEY_NAME = 'kit.policy-key';

export type PolicyKind = 'pdf' | 'image';

export interface PolicyMeta {
  kind: PolicyKind;
  mime: string;
  size: number;
  /** YYYY-MM-DD. */
  addedAt: string;
}

const dir = () => new Directory(Paths.document, 'policy');
const viewDir = () => new Directory(Paths.cache, 'policy-view');
const dataFile = (tripId: string) => new File(dir(), `${tripId}.bin`);
const metaFile = (tripId: string) => new File(dir(), `${tripId}.json`);

/** Trip ids are UUIDs; anything else never becomes a path. */
const safeId = (tripId: string) => /^[0-9a-f-]{36}$/i.test(tripId);

export function kindOf(mime: string | undefined): PolicyKind | null {
  if (mime === 'application/pdf') return 'pdf';
  if (mime?.startsWith('image/')) return 'image';
  return null;
}

async function key(): Promise<Uint8Array> {
  const hex = await SecureStore.getItemAsync(KEY_NAME);
  if (hex) return aesjs.utils.hex.toBytes(hex);
  const fresh = Crypto.getRandomBytes(32);
  await SecureStore.setItemAsync(KEY_NAME, aesjs.utils.hex.fromBytes(fresh));
  return fresh;
}

const yieldNow = () => new Promise<void>((r) => setTimeout(r, 0));

/** The meta of this trip's file, or null when there is none. */
export function policyMeta(tripId: string): PolicyMeta | null {
  if (!safeId(tripId)) return null;
  try {
    const m = metaFile(tripId);
    if (!m.exists || !dataFile(tripId).exists) return null;
    return JSON.parse(m.textSync()) as PolicyMeta;
  } catch {
    return null;
  }
}

export type SaveResult = 'ok' | 'tooBig' | 'type' | 'error';

/**
 * Encrypts the picked file into place. A failure leaves the previous file,
 * if any, untouched: the new one is written aside and moved in at the end.
 */
async function encryptPolicy(
  tripId: string,
  source: { uri: string; mimeType?: string; size?: number },
  today: string,
  onProgress?: (fraction: number) => void,
): Promise<SaveResult> {
  const kind = kindOf(source.mimeType);
  if (!kind) return 'type';
  if (!safeId(tripId)) return 'error';
  const input = new File(source.uri);
  const size = source.size ?? input.size;
  if (!size || size > MAX_BYTES) return size > MAX_BYTES ? 'tooBig' : 'error';
  const tmp = new File(dir(), `${tripId}.tmp`);
  let reader: ReturnType<File['open']> | null = null;
  let writer: ReturnType<File['open']> | null = null;
  try {
    if (!dir().exists) dir().create({ intermediates: true });
    if (tmp.exists) tmp.delete();
    tmp.create();
    const counter = Crypto.getRandomBytes(16);
    const ctr = new aesjs.ModeOfOperation.ctr(await key(), new aesjs.Counter(counter));
    reader = input.open(FileMode.ReadOnly);
    writer = tmp.open(FileMode.WriteOnly);
    writer.writeBytesSync(counter);
    let done = 0;
    for (;;) {
      const chunk = await reader.readBytes(CHUNK);
      if (chunk.length === 0) break;
      if (done + chunk.length > MAX_BYTES) return 'tooBig';
      writer.writeBytesSync(ctr.encrypt(chunk));
      done += chunk.length;
      onProgress?.(done / size);
      await yieldNow();
    }
    reader.close();
    writer.close();
    reader = writer = null;
    const target = dataFile(tripId);
    if (target.exists) target.delete();
    tmp.move(target);
    const meta: PolicyMeta = { kind, mime: source.mimeType!, size: done, addedAt: today };
    metaFile(tripId).write(JSON.stringify(meta));
    return 'ok';
  } catch (error) {
    console.warn('[kit] policy save failed', (error as Error)?.name);
    return 'error';
  } finally {
    try {
      reader?.close();
      writer?.close();
      if (tmp.exists) tmp.delete();
    } catch {
      // Best effort.
    }
  }
}

/** The decrypted viewing copy (Raz review 2b: on every return to the app, and at launch). */
export function clearViews(): void {
  try {
    const v = viewDir();
    if (v.exists) v.delete();
  } catch {
    // Best effort: the system clears the cache too.
  }
}

/**
 * Encrypts the picked file into place; the picker's plain copy in the cache
 * is deleted on every outcome, refusals included (AC-9, Raz review 2a).
 */
export async function savePolicy(
  tripId: string,
  source: { uri: string; mimeType?: string; size?: number },
  today: string,
  onProgress?: (fraction: number) => void,
): Promise<SaveResult> {
  try {
    return await encryptPolicy(tripId, source, today, onProgress);
  } finally {
    try {
      const picked = new File(source.uri);
      if (source.uri.startsWith(Paths.cache.uri) && picked.exists) picked.delete();
    } catch {
      // Best effort.
    }
  }
}

export type OpenResult = 'ok' | 'missing' | 'noViewer' | 'error';

/** Decrypts to a cache copy and opens it in the system viewer (Android). */
export async function openPolicy(tripId: string): Promise<OpenResult> {
  const meta = policyMeta(tripId);
  if (!meta) return 'missing';
  clearViews();
  let reader: ReturnType<File['open']> | null = null;
  let writer: ReturnType<File['open']> | null = null;
  try {
    viewDir().create({ intermediates: true });
    const ext = meta.kind === 'pdf' ? 'pdf' : (meta.mime.split('/')[1] ?? 'jpg');
    const out = new File(viewDir(), `policy.${ext}`);
    out.create();
    reader = dataFile(tripId).open(FileMode.ReadOnly);
    writer = out.open(FileMode.WriteOnly);
    const ctr = new aesjs.ModeOfOperation.ctr(
      await key(),
      new aesjs.Counter(reader.readBytesSync(16)),
    );
    for (;;) {
      const chunk = await reader.readBytes(CHUNK);
      if (chunk.length === 0) break;
      writer.writeBytesSync(ctr.decrypt(chunk));
      await yieldNow();
    }
    reader.close();
    writer.close();
    reader = writer = null;
    if (Platform.OS !== 'android') return 'error';
    const IntentLauncher = await import('expo-intent-launcher');
    try {
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: out.contentUri,
        type: meta.mime,
        // FLAG_GRANT_READ_URI_PERMISSION
        flags: 1,
      });
      return 'ok';
    } catch {
      return 'noViewer';
    }
  } catch (error) {
    console.warn('[kit] policy open failed', (error as Error)?.name);
    return 'error';
  } finally {
    try {
      reader?.close();
      writer?.close();
    } catch {
      // Best effort.
    }
  }
}

/** Removes this trip's file (removal, insurance or trip deleted). */
export function removePolicy(tripId: string): void {
  if (!safeId(tripId)) return;
  for (const f of [dataFile(tripId), metaFile(tripId)]) {
    try {
      if (f.exists) f.delete();
    } catch {
      // Best effort.
    }
  }
  clearViews();
}

/** Every file and the key (sign-out, account deletion, wipeDevice). */
export async function wipePolicies(): Promise<void> {
  try {
    if (dir().exists) dir().delete();
  } catch {
    // Best effort.
  }
  clearViews();
  await SecureStore.deleteItemAsync(KEY_NAME).catch(() => {});
}
