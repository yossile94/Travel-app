package com.travelapp.passportvault

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.nio.ByteBuffer
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.PublicKey
import java.security.SecureRandom
import java.security.spec.MGF1ParameterSpec
import java.security.spec.X509EncodedKeySpec
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource
import javax.crypto.spec.SecretKeySpec

/**
 * Sprint 10 (ADR-015, Raz blocker 2): envelope encryption of a passport photo.
 *
 * - Each photo gets a fresh AES-256-GCM key, made in software.
 * - That key is wrapped with RSA-OAEP under the public half of one key pair in
 *   the AndroidKeyStore. The private half needs the user's authentication on
 *   every use (biometric or device credential), so saving asks nothing and
 *   opening goes through BiometricPrompt with a CryptoObject.
 * - File: [version 1][wrapped key length, 2 bytes][wrapped key][12-byte IV][ciphertext + tag].
 */
object PhotoCrypto {
  const val ALIAS = "passport_photo_wrap_v1"
  private const val KEYSTORE = "AndroidKeyStore"
  private const val VERSION: Byte = 1
  private const val RSA = "RSA/ECB/OAEPWithSHA-256AndMGF1Padding"
  private const val GCM = "AES/GCM/NoPadding"

  // Keystore RSA keys take MGF1 with SHA-1 only; the digest itself is SHA-256.
  private val oaep = OAEPParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA1, PSource.PSpecified.DEFAULT)

  private fun keyStore(): KeyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }

  /** The wrapping pair, made once; needs a secure lock screen to exist. */
  private fun ensureKeyPair() {
    if (keyStore().containsAlias(ALIAS)) return
    val spec = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_DECRYPT or KeyProperties.PURPOSE_ENCRYPT)
      .setKeySize(2048)
      .setDigests(KeyProperties.DIGEST_SHA256, KeyProperties.DIGEST_SHA1)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_OAEP)
      .setUserAuthenticationRequired(true)
      .setInvalidatedByBiometricEnrollment(false)
      .apply {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
          // Every use needs its own authentication (timeout 0), fingerprint or PIN.
          setUserAuthenticationParameters(
            0,
            KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL,
          )
        }
      }
      .build()
    KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA, KEYSTORE).apply {
      initialize(spec)
      generateKeyPair()
    }
  }

  /** The public key as a plain RSA key: encrypting with it needs no authentication. */
  private fun publicKey(): PublicKey {
    ensureKeyPair()
    val pub = keyStore().getCertificate(ALIAS).publicKey
    return KeyFactory.getInstance(pub.algorithm).generatePublic(X509EncodedKeySpec(pub.encoded))
  }

  fun encrypt(plain: ByteArray): ByteArray {
    val aes: SecretKey = KeyGenerator.getInstance("AES").apply { init(256, SecureRandom()) }.generateKey()
    val wrap = Cipher.getInstance(RSA).apply { init(Cipher.ENCRYPT_MODE, publicKey(), oaep) }
    val wrapped = wrap.doFinal(aes.encoded)
    val gcm = Cipher.getInstance(GCM).apply { init(Cipher.ENCRYPT_MODE, aes) }
    val iv = gcm.iv
    val sealed = gcm.doFinal(plain)
    return ByteBuffer.allocate(1 + 2 + wrapped.size + iv.size + sealed.size)
      .put(VERSION)
      .putShort(wrapped.size.toShort())
      .put(wrapped)
      .put(iv)
      .put(sealed)
      .array()
  }

  /**
   * The cipher BiometricPrompt unlocks. Throws KeyPermanentlyInvalidatedException
   * when the lock screen changed and the key went (design 11).
   */
  fun unwrapCipher(): Cipher {
    val key = keyStore().getKey(ALIAS, null) as? PrivateKey
      ?: throw java.security.KeyStoreException("no key")
    return Cipher.getInstance(RSA).apply { init(Cipher.DECRYPT_MODE, key, oaep) }
  }

  /** With the unlocked cipher: the photo's bytes. */
  fun decrypt(file: ByteArray, unlocked: Cipher): ByteArray {
    val buf = ByteBuffer.wrap(file)
    require(buf.get() == VERSION) { "unknown version" }
    val wrapped = ByteArray(buf.short.toInt()).also { buf.get(it) }
    val iv = ByteArray(12).also { buf.get(it) }
    val sealed = ByteArray(buf.remaining()).also { buf.get(it) }
    val aes = SecretKeySpec(unlocked.doFinal(wrapped), "AES")
    return Cipher.getInstance(GCM).apply { init(Cipher.DECRYPT_MODE, aes, GCMParameterSpec(128, iv)) }.doFinal(sealed)
  }

  fun hasKey(): Boolean = keyStore().containsAlias(ALIAS)

  fun deleteKey() {
    keyStore().run { if (containsAlias(ALIAS)) deleteEntry(ALIAS) }
  }
}
