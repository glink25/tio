package com.glink25.tio

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.AtomicFile
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal class CredentialStore(context: Context) {
    private val storage = AtomicFile(File(context.noBackupFilesDir, "git.credential"))
    private val alias = "tio.git.aes"
    private fun key(create: Boolean): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val key = store.getKey(alias, null) as? SecretKey
        if (key != null) return key
        check(create)
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        return generator.generateKey()
    }
    fun perform(action: String, value: String?): String? {
        when (action) {
            "read" -> {
                val bytes = try { storage.readFully() } catch (_: java.io.FileNotFoundException) { return null }
                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(Cipher.DECRYPT_MODE, key(false), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
                return cipher.doFinal(bytes, 12, bytes.size - 12).toString(Charsets.UTF_8)
            }
            "write" -> {
                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(Cipher.ENCRYPT_MODE, key(true))
                val bytes = cipher.iv + cipher.doFinal(requireNotNull(value).toByteArray())
                val out = storage.startWrite()
                try { out.write(bytes); storage.finishWrite(out) }
                catch (ex: Exception) { storage.failWrite(out); throw ex }
            }
            "clear" -> storage.delete()
            else -> throw IllegalArgumentException()
        }
        return null
    }
}
