package com.panzerirun.wear

import com.panzerirun.wear.record.Recorder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// Testes sem relogio: o que o gravador faz com as amostras do treino.
class RecorderTest {
    private val t0 = 1_700_000_000_000L

    private fun recorder() = Recorder(sessionId = "s1", startedAtMillis = t0, utcOffsetMinutes = -180, clientId = "c-1")

    @Test fun `frequencia cardiaca com media e maxima e leituras impossiveis descartadas`() {
        val r = recorder()
        r.onHeartRate(t0 + 1_000, 120.0)
        r.onHeartRate(t0 + 2_000, 140.0)
        r.onHeartRate(t0 + 3_000, 0.0) // sensor sem leitura
        r.onHeartRate(t0 + 4_000, 400.0) // impossivel
        r.onHeartRate(t0 + 5_000, Double.NaN)
        val s = r.summary(t0 + 10_000)
        assertEquals(130, s.avgHr)
        assertEquals(140, s.maxHr)
        assertEquals(140, r.lastHeartRate())
    }

    @Test fun `distancia acumulada nunca diminui`() {
        val r = recorder()
        r.onDistanceTotal(t0 + 1_000, 100.0)
        r.onDistanceTotal(t0 + 2_000, 250.5)
        r.onDistanceTotal(t0 + 3_000, 200.0) // regressao: ignorada
        assertEquals(250.5, r.distanceMeters(), 0.001)
    }

    @Test fun `percurso so aceita coordenadas validas e altitude plausivel`() {
        val r = recorder()
        r.onLocation(t0 + 1_000, -23.55, -46.63, 760.0)
        r.onLocation(t0 + 2_000, 91.0, 10.0, null) // latitude impossivel
        r.onLocation(t0 + 3_000, Double.NaN, 10.0, null)
        r.onLocation(t0 + 4_000, -23.551, -46.631, Double.NaN) // sem altitude valida
        val s = r.summary(t0 + 10_000)
        assertTrue(s.hasRoute)
        assertEquals(2, s.points)
        val points = r.toJson(t0 + 10_000).getJSONArray("points")
        assertEquals(760.0, points.getJSONObject(0).getDouble("alt"), 0.001)
        assertFalse(points.getJSONObject(1).has("alt"))
    }

    @Test fun `sem localizacao nao ha percurso`() {
        val r = recorder()
        r.onHeartRate(t0 + 1_000, 130.0)
        assertFalse(r.summary(t0 + 5_000).hasRoute)
    }

    @Test fun `amostras do mesmo segundo viram um ponto so`() {
        val r = recorder()
        r.onHeartRate(t0 + 1_100, 130.0)
        r.onLocation(t0 + 1_400, -23.55, -46.63, null)
        r.onDistanceTotal(t0 + 1_900, 10.0)
        val points = r.toJson(t0 + 5_000).getJSONArray("points")
        assertEquals(1, points.length())
        val p = points.getJSONObject(0)
        assertEquals(1, p.getInt("t"))
        assertEquals(130, p.getInt("hr"))
        assertEquals(10.0, p.getDouble("dist"), 0.001)
    }

    @Test fun `o tempo parado nao conta no tempo ativo`() {
        val r = recorder()
        r.onPaused(t0 + 60_000) // correu 60 s
        r.onResumed(t0 + 120_000) // 60 s parado
        assertEquals(60, r.summary(t0 + 120_000).activeSec)
        assertEquals(120, r.summary(t0 + 180_000).activeSec) // mais 60 s correndo
    }

    @Test fun `json guardado no relogio tem o formato esperado e nao leva nada alem do treino`() {
        val r = recorder()
        r.onHeartRate(t0 + 1_000, 128.0)
        r.onLocation(t0 + 1_000, -23.55, -46.63, 760.0)
        r.onDistanceTotal(t0 + 1_000, 3.0)
        val json = r.toJson(t0 + 61_000, interrupted = true)
        assertEquals("c-1", json.getString("clientId"))
        assertEquals("s1", json.getString("sessionId"))
        assertEquals(-180, json.getInt("utcOffsetMinutes"))
        assertEquals(61, json.getInt("durationSec"))
        assertTrue(json.getBoolean("interrupted"))
        assertEquals(setOf("clientId", "sessionId", "startedAt", "endedAt", "utcOffsetMinutes", "durationSec", "elapsedSec", "movingSec", "distanceMeters", "avgHr", "maxHr", "interrupted", "points"), json.keys().asSequence().toSet())
        assertEquals("2023-11-14T22:13:20Z", json.getString("startedAt"))
    }

    @Test fun `treino sem sessao prescrita e sem frequencia`() {
        val r = Recorder(sessionId = null, startedAtMillis = t0, utcOffsetMinutes = 0, clientId = "c-2")
        val json = r.toJson(t0 + 30_000)
        assertTrue(json.isNull("sessionId"))
        assertTrue(json.isNull("avgHr"))
        assertNull(r.summary(t0 + 30_000).avgHr)
    }

    @Test fun `tempo em movimento nao conta a parada e tempo da atividade conta tudo`() {
        val r = recorder()
        // 30 s correndo (2,5 m/s), 20 s parado no semaforo (0 m/s), 30 s correndo de novo
        for (s in 0..30) r.onSpeed(t0 + s * 1000L, 2.5)
        for (s in 31..50) r.onSpeed(t0 + s * 1000L, 0.0)
        for (s in 51..80) r.onSpeed(t0 + s * 1000L, 2.5)
        val summary = r.summary(t0 + 80_000)
        assertEquals(80, summary.elapsedSec)
        assertEquals(80, summary.activeSec) // sem pausa manual o cronometro anda junto
        assertEquals(60, summary.movingSec) // 30 + 30; os 20 s parado ficam de fora
    }

    @Test fun `pausa manual nao conta em movimento nem no cronometro mas conta no tempo da atividade`() {
        val r = recorder()
        for (s in 0..20) r.onSpeed(t0 + s * 1000L, 3.0)
        r.onPaused(t0 + 20_000)
        r.onResumed(t0 + 60_000) // 40 s pausado
        for (s in 60..80) r.onSpeed(t0 + s * 1000L, 3.0)
        val summary = r.summary(t0 + 80_000)
        assertEquals(80, summary.elapsedSec)
        assertEquals(40, summary.activeSec)
        assertEquals(40, summary.movingSec) // 20 s antes e 20 s depois; a lacuna da pausa nao e interpolada
    }

    @Test fun `lacuna longa sem leitura de velocidade nao vira movimento`() {
        val r = recorder()
        r.onSpeed(t0, 3.0)
        r.onSpeed(t0 + 30_000, 3.0) // sensor ficou 30 s sem ler
        assertEquals(0, r.summary(t0 + 30_000).movingSec)
    }

    @Test fun `json leva os tres tempos`() {
        val r = recorder()
        for (s in 0..10) r.onSpeed(t0 + s * 1000L, 3.0)
        val json = r.toJson(t0 + 20_000)
        assertEquals(20, json.getInt("elapsedSec"))
        assertEquals(20, json.getInt("durationSec"))
        assertEquals(10, json.getInt("movingSec"))
    }
}
