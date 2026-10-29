/**
 * Sprint 10 (ADR-015): the passport photo's native vault, a local Expo module
 * in Kotlin (modules/passport-vault). Envelope encryption: a fresh AES-256-GCM
 * key per photo, wrapped with the public half of a Keystore key pair bound to
 * authentication. Saving needs no fingerprint; opening asks for it through
 * BiometricPrompt with a CryptoObject. The shrink and the OCR (bundled ML
 * Kit, no download) run in the module too, so the image never passes JS until
 * it is opened.
 */
import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';
import type { ComponentType, ReactNode } from 'react';
import { View, type ViewProps } from 'react-native';

export type OpenError = 'cancelled' | 'failed' | 'invalidated' | 'missing' | 'noLock';

interface NativeVault {
  isDeviceSecure(): Promise<boolean>;
  /**
   * Raz review (important 1-2): no lock, or a key the system invalidated,
   * drops every photo and the key; reset says some were dropped.
   */
  reconcile(): Promise<{ secure: boolean; reset: boolean }>;
  /** AC-2: the camera's and the picker's cache copies, left by a crash or a kill. */
  clearCaptures(): Promise<void>;
  /** On-device text recognition of a picked or captured image (D7). */
  recognize(uri: string): Promise<string>;
  /** Shrinks, encrypts and stores the photo, then deletes the source file (AC-2). */
  savePhoto(holderId: string, uri: string): Promise<void>;
  /** Deletes a temporary capture that was not kept (design 13.4). */
  discard(uri: string): Promise<void>;
  /** Authenticates, then returns the JPEG as base64; nothing is written to disk. */
  openPhoto(
    holderId: string,
    prompt: { title: string; subtitle: string; cancel: string },
  ): Promise<{ ok: true; base64: string } | { ok: false; error: OpenError }>;
  hasPhoto(holderId: string): Promise<boolean>;
  deletePhoto(holderId: string): Promise<void>;
  wipe(): Promise<void>;
}

const native = requireOptionalNativeModule<NativeVault>('PassportVault');

const missing = () => Promise.reject(new Error('PassportVault is not in this build'));

/** The vault, or a stand-in that refuses everything when the module isn't built in. */
export const vault: NativeVault = native ?? {
  isDeviceSecure: () => Promise.resolve(false),
  reconcile: () => Promise.resolve({ secure: false, reset: false }),
  clearCaptures: () => Promise.resolve(),
  recognize: missing,
  savePhoto: missing,
  discard: () => Promise.resolve(),
  openPhoto: () => Promise.resolve({ ok: false, error: 'failed' }),
  hasPhoto: () => Promise.resolve(false),
  deletePhoto: () => Promise.resolve(),
  wipe: () => Promise.resolve(),
};

export const vaultAvailable = native !== null;

/**
 * Raz (design approval, blocker 1): FLAG_SECURE on the window that holds this
 * view, a Modal's own window included (expo-screen-capture marks only the
 * activity). Set while mounted, cleared when unmounted.
 */
export const SecureWindow: ComponentType<ViewProps & { children?: ReactNode }> = vaultAvailable
  ? requireNativeViewManager<ViewProps & { children?: ReactNode }>('PassportVault')
  : View;
