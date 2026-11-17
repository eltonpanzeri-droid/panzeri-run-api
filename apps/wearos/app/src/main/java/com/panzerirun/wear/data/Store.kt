package com.panzerirun.wear.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

// Guarda no relogio: a credencial e o pareamento em andamento (criptografados pelo Android Keystore) e a ultima semana baixada (para funcionar sem internet).
// Se o armazenamento seguro falhar, a credencial NAO cai para arquivo comum: fica so' na memoria e o relogio pede novo pareamento na proxima abertura.

data class PendingPairing(val pairingId: String, val pollSecret: String, val code: String, val expiresAtMillis: Long)
data class CachedWeek(val json: String, val savedAtMillis: Long)

class Store(context: Context) {
    private val memory = mutableMapOf<String, String>()
    private val secure: SharedPreferences? = runCatching {
        val key = MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        EncryptedSharedPreferences.create(context, "wear_secure", key, EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV, EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM)
    }.getOrNull()
    private val plain: SharedPreferences = context.getSharedPreferences("wear_cache", Context.MODE_PRIVATE)

    private fun getSecure(key: String): String? = secure?.getString(key, null) ?: memory[key]
    private fun putSecure(key: String, value: String?) {
        if (secure != null) secure.edit().apply { if (value == null) remove(key) else putString(key, value) }.apply()
        else if (value == null) memory.remove(key) else memory[key] = value
    }

    var token: String?
        get() = getSecure("token")
        set(value) = putSecure("token", value)

    fun pendingPairing(): PendingPairing? {
        val id = getSecure("pairingId") ?: return null
        val secret = getSecure("pollSecret") ?: return null
        val code = getSecure("pairingCode") ?: return null
        val expires = getSecure("pairingExpires")?.toLongOrNull() ?: return null
        return PendingPairing(id, secret, code, expires)
    }

    fun savePairing(pairing: PendingPairing?) {
        putSecure("pairingId", pairing?.pairingId)
        putSecure("pollSecret", pairing?.pollSecret)
        putSecure("pairingCode", pairing?.code)
        putSecure("pairingExpires", pairing?.expiresAtMillis?.toString())
    }

    fun cachedWeek(): CachedWeek? {
        val json = plain.getString("week", null) ?: return null
        return CachedWeek(json, plain.getLong("weekSavedAt", 0L))
    }

    fun saveWeek(json: String, savedAtMillis: Long) {
        plain.edit().putString("week", json).putLong("weekSavedAt", savedAtMillis).apply()
    }

    fun clearWeek() {
        plain.edit().remove("week").remove("weekSavedAt").apply()
    }
}
