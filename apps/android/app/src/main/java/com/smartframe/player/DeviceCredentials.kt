package com.smartframe.player

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class DeviceConnection(val server: String, val deviceId: String, val token: String)

/** Credencial nativa, criptografada pelo Android Keystore; nunca entregue ao JavaScript. */
class DeviceCredentials(context: Context) {
    private val preferences = context.getSharedPreferences("smartframe.connection", Context.MODE_PRIVATE)
    private val alias = "smartframe.device.v1"

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }

    fun read(): DeviceConnection? = try {
        val encrypted = preferences.getString("ciphertext", null)
        val iv = preferences.getString("iv", null)
        if (encrypted == null || iv == null) null else {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
            val json = JSONObject(String(cipher.doFinal(Base64.decode(encrypted, Base64.NO_WRAP)), Charsets.UTF_8))
            DeviceConnection(json.getString("server"), json.getString("deviceId"), json.getString("token"))
        }
    } catch (_: Exception) { null }

    fun save(connection: DeviceConnection) {
        val json = JSONObject().put("server", connection.server).put("deviceId", connection.deviceId).put("token", connection.token)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        check(preferences.edit()
            .putString("ciphertext", Base64.encodeToString(cipher.doFinal(json.toString().toByteArray(Charsets.UTF_8)), Base64.NO_WRAP))
            .putString("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP)).commit())
    }

    fun clear() { preferences.edit().clear().apply() }
}
