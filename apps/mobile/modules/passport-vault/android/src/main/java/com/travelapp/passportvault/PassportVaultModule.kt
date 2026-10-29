package com.travelapp.passportvault

import android.app.KeyguardManager
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import android.os.Build
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.util.Base64
import androidx.biometric.BiometricManager.Authenticators
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.exifinterface.media.ExifInterface
import androidx.fragment.app.FragmentActivity
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import kotlin.coroutines.resume
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext

/**
 * Sprint 10 (ADR-015): the passport photo's vault. The JS side is
 * src/features/passport/vault.ts; nothing here touches the network.
 *
 * Files: files/passport/<holderId>.bin (encrypted, excluded from backup by
 * plugins/withPassportBackupRules.js). Only files inside the app's cache are
 * ever deleted as a "source" (the camera's and the picker's copies).
 */
class PassportVaultModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("no context")

  private fun dir(): File = File(context.filesDir, "passport").apply { mkdirs() }

  private fun safeId(id: String) = id == "me" || Regex("^[0-9a-fA-F-]{36}$").matches(id)

  private fun photoFile(id: String): File {
    require(safeId(id)) { "bad id" }
    return File(dir(), "$id.bin")
  }

  private fun isDeviceSecure(): Boolean =
    (context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager).isDeviceSecure

  /** A file:// URI inside this app's cache, or null: nothing else is ever read as a source or deleted. */
  private fun cacheFile(uri: String): File? {
    val path = Uri.parse(uri).path ?: return null
    val file = File(path).canonicalFile
    val cache = context.cacheDir.canonicalFile
    return if (file.path.startsWith(cache.path + File.separator) && file.isFile) file else null
  }

  /** D2: the long side at about 2000px, upright, as JPEG 0.8. */
  private fun shrink(file: File): ByteArray {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.path, bounds)
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= 2000) sample *= 2
    val decoded = BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample })
      ?: throw IllegalArgumentException("not an image")
    val rotation = when (ExifInterface(file.path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
      ExifInterface.ORIENTATION_ROTATE_90 -> 90f
      ExifInterface.ORIENTATION_ROTATE_180 -> 180f
      ExifInterface.ORIENTATION_ROTATE_270 -> 270f
      else -> 0f
    }
    val scale = minOf(1f, 2000f / maxOf(decoded.width, decoded.height))
    val matrix = Matrix().apply {
      postScale(scale, scale)
      postRotate(rotation)
    }
    val upright = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
    val out = ByteArrayOutputStream()
    upright.compress(Bitmap.CompressFormat.JPEG, 80, out)
    if (upright !== decoded) upright.recycle()
    decoded.recycle()
    return out.toByteArray()
  }

  private suspend fun authenticate(cipher: Cipher, prompt: Map<String, String>): Result<Cipher> {
    val activity = appContext.currentActivity as? FragmentActivity
      ?: return Result.failure(IllegalStateException("failed"))
    return withContext(Dispatchers.Main) {
      suspendCancellableCoroutine { cont ->
        val callback = object : BiometricPrompt.AuthenticationCallback() {
          override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
            val unlocked = result.cryptoObject?.cipher
            if (cont.isActive) cont.resume(if (unlocked != null) Result.success(unlocked) else Result.failure(IllegalStateException("failed")))
          }

          override fun onAuthenticationError(code: Int, message: CharSequence) {
            val cancelled = code == BiometricPrompt.ERROR_USER_CANCELED ||
              code == BiometricPrompt.ERROR_NEGATIVE_BUTTON ||
              code == BiometricPrompt.ERROR_CANCELED
            if (cont.isActive) cont.resume(Result.failure(IllegalStateException(if (cancelled) "cancelled" else "failed")))
          }
        }
        val info = BiometricPrompt.PromptInfo.Builder()
          .setTitle(prompt["title"] ?: "")
          .setSubtitle(prompt["subtitle"] ?: "")
          .apply {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
              // Fingerprint or the device PIN; the system shows its own "cancel".
              setAllowedAuthenticators(Authenticators.BIOMETRIC_STRONG or Authenticators.DEVICE_CREDENTIAL)
            } else {
              setAllowedAuthenticators(Authenticators.BIOMETRIC_STRONG)
              setNegativeButtonText(prompt["cancel"] ?: "Cancel")
            }
          }
          .build()
        BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), callback)
          .authenticate(info, BiometricPrompt.CryptoObject(cipher))
      }
    }
  }

  /** Every photo and the key: what can no longer be opened goes, nothing else. */
  private fun dropAllPhotos(): Boolean {
    val had = dir().listFiles()?.isNotEmpty() == true
    dir().listFiles()?.forEach { it.delete() }
    PhotoCrypto.deleteKey()
    return had
  }

  /** The camera's and the picker's copies in the cache (AC-2): never kept past a session. */
  private fun clearCaptures() {
    for (name in listOf("Camera", "ImagePicker")) {
      File(context.cacheDir, name).listFiles()?.forEach { it.deleteRecursively() }
    }
  }

  override fun definition() = ModuleDefinition {
    Name("PassportVault")

    /**
     * Raz review, important 1-2: run when the wallet opens. No lock: the photos
     * and key go. A key the system invalidated: the photos it wrapped go and a
     * fresh pair is made on the next save. "reset" tells JS to update its records.
     */
    AsyncFunction("reconcile") {
      val secure = isDeviceSecure()
      val reset = when {
        !secure -> dropAllPhotos()
        !PhotoCrypto.keyUsable() -> dropAllPhotos()
        else -> false
      }
      mapOf("secure" to secure, "reset" to reset)
    }

    AsyncFunction("clearCaptures") {
      clearCaptures()
      Unit
    }

    AsyncFunction("isDeviceSecure") { isDeviceSecure() }

    AsyncFunction("recognize") Coroutine { uri: String ->
      withContext(Dispatchers.IO) {
        val file = cacheFile(uri) ?: throw IllegalArgumentException("not a cache file")
        val bytes = shrink(file)
        val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        try {
          val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
          try {
            // The text stays in memory and goes back to JS only; never logged (design 8.3).
            Tasks.await(recognizer.process(InputImage.fromBitmap(bitmap, 0)), 5, TimeUnit.SECONDS).text
          } finally {
            recognizer.close()
          }
        } finally {
          bitmap.recycle()
        }
      }
    }

    AsyncFunction("savePhoto") Coroutine { holderId: String, uri: String ->
      withContext(Dispatchers.IO) {
        val source = cacheFile(uri) ?: throw IllegalArgumentException("not a cache file")
        try {
          if (!isDeviceSecure()) throw IllegalStateException("noLock")
          // A pair the system invalidated would wrap photos no one can open.
          if (!PhotoCrypto.keyUsable()) dropAllPhotos()
          val sealed = PhotoCrypto.encrypt(shrink(source))
          val target = photoFile(holderId)
          val tmp = File(target.parentFile, "${target.name}.tmp")
          tmp.writeBytes(sealed)
          if (!tmp.renameTo(target)) {
            tmp.delete()
            throw IllegalStateException("write failed")
          }
        } finally {
          // AC-2: the camera's or the picker's copy never outlives this call.
          source.delete()
        }
      }
    }

    AsyncFunction("discard") { uri: String ->
      cacheFile(uri)?.delete()
      Unit
    }

    AsyncFunction("hasPhoto") { holderId: String -> photoFile(holderId).isFile }

    AsyncFunction("openPhoto") Coroutine { holderId: String, prompt: Map<String, String> ->
      val file = photoFile(holderId)
      if (!file.isFile) return@Coroutine mapOf("ok" to false, "error" to "missing")
      if (!isDeviceSecure()) {
        // Design 11: the lock is gone, so the key is too; nothing to keep.
        PhotoCrypto.deleteKey()
        dir().listFiles()?.forEach { it.delete() }
        return@Coroutine mapOf("ok" to false, "error" to "noLock")
      }
      val cipher = try {
        PhotoCrypto.unwrapCipher()
      } catch (e: KeyPermanentlyInvalidatedException) {
        PhotoCrypto.deleteKey()
        dir().listFiles()?.forEach { it.delete() }
        return@Coroutine mapOf("ok" to false, "error" to "invalidated")
      } catch (e: Exception) {
        return@Coroutine mapOf("ok" to false, "error" to "failed")
      }
      val unlocked = authenticate(cipher, prompt).getOrElse {
        return@Coroutine mapOf("ok" to false, "error" to (it.message ?: "failed"))
      }
      // A damaged file or a tag that doesn't match is a failure the screen can say (Raz, important 6).
      val jpeg = try {
        withContext(Dispatchers.IO) { PhotoCrypto.decrypt(file.readBytes(), unlocked) }
      } catch (e: Exception) {
        return@Coroutine mapOf("ok" to false, "error" to "failed")
      }
      mapOf("ok" to true, "base64" to Base64.encodeToString(jpeg, Base64.NO_WRAP))
    }

    AsyncFunction("deletePhoto") { holderId: String ->
      photoFile(holderId).delete()
      Unit
    }

    AsyncFunction("wipe") {
      dir().listFiles()?.forEach { it.delete() }
      PhotoCrypto.deleteKey()
      Unit
    }

    View(SecureWindowView::class) {}
  }
}
