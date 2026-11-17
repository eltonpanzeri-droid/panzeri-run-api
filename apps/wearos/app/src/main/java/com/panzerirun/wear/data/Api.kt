package com.panzerirun.wear.data

import android.util.Log
import com.panzerirun.wear.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

// Chamadas ao servidor do Panzeri Run. Rede por HttpURLConnection (sem biblioteca extra). So' as tres rotas do relogio:
//   POST /wear/pairing/start   POST /wear/pairing/poll   GET /wear/week (com a credencial do relogio)

class ApiException(val status: Int, val code: String?) : Exception("HTTP $status${code?.let { " ($it)" } ?: ""}")

data class PairingStart(val pairingId: String, val code: String, val pollSecret: String, val expiresAtMillis: Long)

sealed interface PollResult {
    object Pending : PollResult
    object Expired : PollResult
    object Revoked : PollResult
    object AlreadyIssued : PollResult
    data class Paired(val token: String) : PollResult
}

object Api {
    private const val CONNECT_TIMEOUT_MS = 10_000
    private const val READ_TIMEOUT_MS = 20_000

    private suspend fun request(method: String, path: String, body: JSONObject? = null, token: String? = null): String = withContext(Dispatchers.IO) {
        val connection = URL(BuildConfig.API_URL.trimEnd('/') + path).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = CONNECT_TIMEOUT_MS
            connection.readTimeout = READ_TIMEOUT_MS
            connection.setRequestProperty("Accept", "application/json")
            if (token != null) connection.setRequestProperty("Authorization", "Bearer $token")
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            if (status !in 200..299) {
                val code = runCatching { JSONObject(text).optString("code").takeIf { it.isNotBlank() } }.getOrNull()
                throw ApiException(status, code)
            }
            text
        } catch (e: ApiException) {
            throw e
        } catch (e: IOException) {
            Log.w("PanzeriWear", "falha de rede $path: $e")
            throw e
        } finally {
            connection.disconnect()
        }
    }

    suspend fun startPairing(deviceName: String, nowMillis: Long = System.currentTimeMillis()): PairingStart {
        val json = JSONObject(request("POST", "/wear/pairing/start", JSONObject().put("deviceName", deviceName)))
        return PairingStart(
            pairingId = json.getString("pairingId"),
            code = json.getString("code"),
            pollSecret = json.getString("pollSecret"),
            expiresAtMillis = parseIso(json.optString("expiresAt")) ?: (nowMillis + 10 * 60_000),
        )
    }

    suspend fun poll(pairingId: String, pollSecret: String): PollResult {
        val json = JSONObject(request("POST", "/wear/pairing/poll", JSONObject().put("pairingId", pairingId).put("pollSecret", pollSecret)))
        return when (json.optString("status")) {
            "paired" -> PollResult.Paired(json.getString("token"))
            "expired" -> PollResult.Expired
            "revoked" -> PollResult.Revoked
            "already_issued" -> PollResult.AlreadyIssued
            else -> PollResult.Pending
        }
    }

    // JSON bruto da semana (guardado como esta no relogio para funcionar sem internet).
    suspend fun weekJson(token: String): String = request("GET", "/wear/week", token = token)

    private fun parseIso(value: String): Long? = runCatching { java.time.Instant.parse(value).toEpochMilli() }.getOrNull()
}
