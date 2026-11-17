package com.panzerirun.wear

import com.panzerirun.wear.data.Format
import com.panzerirun.wear.data.WeekParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

// Testes sem relogio nem emulador: leitura do JSON do servidor e textos da tela.
class WearLogicTest {
    private val json = """
    {"generatedAt":"2026-11-17T15:00:00.000Z","sessions":[
      {"id":"a","date":"2026-11-18","weekday":3,"kind":"corrida","title":"Corrida","durationMin":40,"distanceKm":6,"done":false,
       "steps":[{"kind":"step","label":null,"role":"main","goal":{"type":"distance","meters":6000},"pace":{"fastSecPerKm":370,"slowSecPerKm":410}}]},
      {"id":"b","date":"2026-11-19","weekday":4,"kind":"corrida","title":"Intervalado","durationMin":70,"distanceKm":10.8,"done":false,
       "steps":[{"kind":"step","label":"Aquecimento","role":"main","goal":{"type":"distance","meters":2000},"pace":null},
                {"kind":"repeat","repeatCount":5,"steps":[{"kind":"step","label":"Forte","role":"work","goal":{"type":"distance","meters":1000},"pace":{"fastSecPerKm":310,"slowSecPerKm":310}},
                                                       {"kind":"step","label":null,"role":"recovery","goal":{"type":"time","seconds":120},"pace":null}]}]},
      {"id":"c","date":"2026-11-20","weekday":5,"kind":"forca","title":"Musculação","durationMin":60,"distanceKm":null,"done":true,"steps":[]},
      {"id":"quebrado"}
    ]}
    """.trimIndent()

    @Test fun `le a semana e ignora treino ilegivel sem derrubar a lista`() {
        val week = WeekParser.parse(json)
        assertEquals(listOf("a", "b", "c"), week.sessions.map { it.id })
        assertEquals(true, week.sessions[2].done)
        assertNull(week.sessions[2].distanceKm)
    }

    @Test fun `corrida simples vira um passo com meta e faixa de pace`() {
        val step = WeekParser.parse(json).sessions[0].items.single().steps.single()
        assertEquals("distance", step.goalType)
        assertEquals(6000, step.goalMeters)
        assertEquals(370, step.paceFast)
        assertEquals(410, step.paceSlow)
        assertEquals("Principal · 6 km · 6:10–6:50/km", Format.stepLine(step))
    }

    @Test fun `intervalado traz o bloco repetido e a recuperacao por tempo sem pace`() {
        val items = WeekParser.parse(json).sessions[1].items
        assertEquals(2, items.size)
        assertEquals(5, items[1].repeatCount)
        assertEquals("Forte · 1 km · 5:10/km", Format.stepLine(items[1].steps[0]))
        assertEquals("Recuperação · 2 min", Format.stepLine(items[1].steps[1]))
        assertEquals("Aquecimento · 2 km", Format.stepLine(items[0].steps[0]))
    }

    @Test fun `textos curtos`() {
        val sessions = WeekParser.parse(json).sessions
        assertEquals("6 km · 40 min", Format.summary(sessions[0]))
        assertEquals("10,8 km · 70 min", Format.summary(sessions[1]))
        assertEquals("60 min", Format.summary(sessions[2]))
        assertEquals("800 m", Format.km(800))
        assertEquals("Corrida", Format.kindLabel("corrida"))
    }

    @Test fun `rotulos de dia`() {
        val today = LocalDate.of(2026, 11, 17)
        assertEquals("Hoje", Format.dayLabel("2026-11-17", today))
        assertEquals("Amanhã", Format.dayLabel("2026-11-18", today))
        assertEquals("Ontem", Format.dayLabel("2026-11-16", today))
        assertTrue(Format.dayLabel("2026-11-21", today).endsWith("21/11"))
    }

    @Test fun `pace igual nos dois lados mostra um valor so`() {
        assertEquals("5:10/km", Format.paceRange(310, 310))
        assertNull(Format.paceRange(null, null))
    }
}
