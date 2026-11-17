package com.panzerirun.wear.record

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.util.TreeMap
import java.util.UUID

// Acumula o que o relogio mede durante UM treino (frequencia cardiaca, localizacao, distancia) e gera o resumo e o JSON guardado no relogio. Logica pura, sem Android: testada na maquina.
// Privacidade: so' recebe amostras enquanto o treino esta em andamento (o servico de gravacao so' existe durante o treino); nada aqui le sensor por conta propria.

data class LivePoint(
    var lat: Double? = null,
    var lon: Double? = null,
    var alt: Double? = null,
    var hr: Int? = null,
    var distanceMeters: Double? = null,
    var speedMps: Double? = null,
)

data class RecordingSummary(
    val clientId: String,
    val sessionId: String?,
    val startedAtMillis: Long,
    val endedAtMillis: Long,
    // tres tempos, como no Strava: da atividade (do inicio ao fim, incluindo paradas), do cronometro (sem as pausas manuais) e em movimento (so' quando esta se deslocando)
    val elapsedSec: Int,
    val activeSec: Int,
    val movingSec: Int,
    val distanceMeters: Double,
    val avgHr: Int?,
    val maxHr: Int?,
    val points: Int,
    val hasRoute: Boolean,
    val interrupted: Boolean,
)

private const val MOVING_MIN_SPEED_MPS = 0.5
private const val MAX_SPEED_GAP_MS = 5_000L

class Recorder(
    val sessionId: String?,
    val startedAtMillis: Long,
    private val utcOffsetMinutes: Int,
    val clientId: String = UUID.randomUUID().toString(),
) {
    // um ponto por segundo (a ultima amostra do segundo vale), ordenado pelo tempo
    private val points = TreeMap<Int, LivePoint>()
    private var activeMs = 0L
    private var activeSince: Long? = startedAtMillis
    // tempo em movimento: soma dos intervalos entre amostras de velocidade em que a velocidade era de corrida/caminhada (>= 0,5 m/s) e o cronometro estava ativo
    private var movingMs = 0L
    private var lastSpeedTime: Long? = null
    private var lastSpeedMoving = false
    private var latestDistance = 0.0
    private var hrSum = 0L
    private var hrCount = 0
    private var hrMax: Int? = null

    private fun slot(timeMillis: Long): LivePoint {
        val second = ((timeMillis - startedAtMillis).coerceAtLeast(0) / 1000).toInt()
        return points.getOrPut(second) { LivePoint() }
    }

    fun onHeartRate(timeMillis: Long, bpm: Double) {
        if (bpm.isNaN() || bpm < 20 || bpm > 250) return // leitura impossivel: descarta
        val value = Math.round(bpm).toInt()
        slot(timeMillis).hr = value
        hrSum += value; hrCount += 1
        hrMax = if (hrMax == null || value > hrMax!!) value else hrMax
    }

    fun onLocation(timeMillis: Long, latitude: Double, longitude: Double, altitude: Double?) {
        if (latitude.isNaN() || longitude.isNaN() || latitude !in -90.0..90.0 || longitude !in -180.0..180.0) return
        val point = slot(timeMillis)
        point.lat = latitude
        point.lon = longitude
        point.alt = altitude?.takeIf { !it.isNaN() && it > -500 && it < 9000 }
    }

    fun onDistanceTotal(timeMillis: Long, totalMeters: Double) {
        if (totalMeters.isNaN() || totalMeters < latestDistance) return // distancia acumulada nunca diminui
        latestDistance = totalMeters
        slot(timeMillis).distanceMeters = totalMeters
    }

    fun onSpeed(timeMillis: Long, metersPerSecond: Double) {
        if (metersPerSecond.isNaN() || metersPerSecond < 0 || metersPerSecond > 15) return
        slot(timeMillis).speedMps = metersPerSecond
        val last = lastSpeedTime
        // o intervalo desde a amostra anterior conta como movimento se ela estava em movimento; lacunas longas (sensor sem leitura) nao contam
        if (last != null && lastSpeedMoving && activeSince != null) {
            val gap = timeMillis - last
            if (gap in 1..MAX_SPEED_GAP_MS) movingMs += gap
        }
        lastSpeedTime = timeMillis
        lastSpeedMoving = metersPerSecond >= MOVING_MIN_SPEED_MPS
    }

    // pausa e retomada: o tempo parado nao conta no tempo ativo
    fun onPaused(atMillis: Long) {
        val since = activeSince ?: return
        activeMs += (atMillis - since).coerceAtLeast(0)
        activeSince = null
        lastSpeedTime = null // a pausa nao conta como movimento
    }

    fun onResumed(atMillis: Long) {
        if (activeSince == null) activeSince = atMillis
    }

    fun movingMillis(): Long = movingMs
    fun activeMillis(nowMillis: Long): Long = activeMs + (activeSince?.let { (nowMillis - it).coerceAtLeast(0) } ?: 0L)
    fun distanceMeters(): Double = latestDistance
    fun lastHeartRate(): Int? = points.descendingMap().values.firstOrNull { it.hr != null }?.hr

    fun summary(endedAtMillis: Long, interrupted: Boolean = false): RecordingSummary = RecordingSummary(
        clientId = clientId, sessionId = sessionId, startedAtMillis = startedAtMillis, endedAtMillis = endedAtMillis,
        elapsedSec = ((endedAtMillis - startedAtMillis).coerceAtLeast(0) / 1000).toInt(), activeSec = (activeMillis(endedAtMillis) / 1000).toInt(),
        movingSec = (minOf(movingMs, activeMillis(endedAtMillis)) / 1000).toInt(), distanceMeters = latestDistance,
        avgHr = if (hrCount > 0) Math.round(hrSum.toDouble() / hrCount).toInt() else null, maxHr = hrMax,
        points = points.size, hasRoute = points.values.any { it.lat != null && it.lon != null }, interrupted = interrupted,
    )

    fun currentSecond(nowMillis: Long): Int = ((nowMillis - startedAtMillis).coerceAtLeast(0) / 1000).toInt()

    private fun pointJson(second: Int, p: LivePoint): JSONObject {
        val o = JSONObject().put("t", second)
        p.lat?.let { o.put("lat", it) }
        p.lon?.let { o.put("lon", it) }
        p.alt?.let { o.put("alt", it) }
        p.hr?.let { o.put("hr", it) }
        p.distanceMeters?.let { o.put("dist", Math.round(it * 10) / 10.0) }
        p.speedMps?.let { o.put("speed", Math.round(it * 100) / 100.0) }
        return o
    }

    // Pontos COMPLETOS (segundos depois de afterSecond e antes de beforeSecond; o segundo em curso ainda pode receber amostras) para o diario de seguranca.
    fun pointsJson(afterSecond: Int, beforeSecond: Int): List<JSONObject> =
        points.subMap(afterSecond, false, beforeSecond, false).map { (second, p) -> pointJson(second, p) }

    // Tudo do treino menos a lista de pontos (pequeno: reescrito a cada gravacao do diario).
    fun metaJson(endedAtMillis: Long, interrupted: Boolean = false): JSONObject = toJson(endedAtMillis, interrupted, includePoints = false)

    // JSON guardado no relogio (e enviado ao Panzeri Run com a autorizacao da aluna).
    fun toJson(endedAtMillis: Long, interrupted: Boolean = false, includePoints: Boolean = true): JSONObject {
        val s = summary(endedAtMillis, interrupted)
        val array = JSONArray()
        if (includePoints) for ((second, p) in points) array.put(pointJson(second, p))
        return JSONObject()
            .put("clientId", s.clientId)
            .put("sessionId", s.sessionId ?: JSONObject.NULL)
            .put("startedAt", Instant.ofEpochMilli(s.startedAtMillis).toString())
            .put("endedAt", Instant.ofEpochMilli(s.endedAtMillis).toString())
            .put("utcOffsetMinutes", utcOffsetMinutes)
            // durationSec = cronometro (sem pausas), como o resumo das outras integracoes; elapsedSec e movingSec sao os outros dois tempos
            .put("durationSec", s.activeSec)
            .put("elapsedSec", s.elapsedSec)
            .put("movingSec", s.movingSec)
            .put("distanceMeters", Math.round(s.distanceMeters * 10) / 10.0)
            .put("avgHr", s.avgHr ?: JSONObject.NULL)
            .put("maxHr", s.maxHr ?: JSONObject.NULL)
            .put("interrupted", s.interrupted)
            .put("points", array)
    }
}

// Diario de seguranca do treino em andamento: a cada poucos segundos o relogio grava o resumo (meta) e SO' os pontos novos, em linhas. Se o app for fechado no meio, o treino e' remontado daqui.
object Journal {
    // Remonta o treino a partir do resumo e das linhas de pontos; linha ilegivel ou repetida e' ignorada (a ultima gravacao pode ter ficado pela metade).
    fun assemble(meta: JSONObject, lines: List<String>): JSONObject {
        val byTime = java.util.TreeMap<Int, JSONObject>()
        for (line in lines) {
            val point = runCatching { JSONObject(line) }.getOrNull() ?: continue
            if (!point.has("t")) continue
            byTime[point.getInt("t")] = point
        }
        val array = JSONArray()
        byTime.values.forEach { array.put(it) }
        return JSONObject(meta.toString()).put("points", array)
    }
}
