package com.panzerirun.wear.data

import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

// Textos curtos para a tela pequena do relogio.
object Format {
    fun pace(seconds: Int): String = "${seconds / 60}:${(seconds % 60).toString().padStart(2, '0')}"

    fun paceRange(fast: Int?, slow: Int?): String? = when {
        fast == null && slow == null -> null
        fast != null && slow != null && fast != slow -> "${pace(fast)}–${pace(slow)}/km"
        else -> "${pace((fast ?: slow)!!)}/km"
    }

    fun km(meters: Int): String {
        val km = meters / 1000.0
        val text = if (km == Math.floor(km)) km.toInt().toString() else String.format(Locale("pt", "BR"), "%.1f", km)
        return if (meters < 1000) "$meters m" else "$text km"
    }

    fun goal(step: Step): String = when (step.goalType) {
        "distance" -> step.goalMeters?.let(::km) ?: "meta aberta"
        "time" -> step.goalSeconds?.let { if (it >= 60) "${it / 60} min" else "$it s" } ?: "meta aberta"
        else -> "meta aberta"
    }

    fun roleLabel(role: String): String = when (role) {
        "work" -> "Forte"
        "recovery" -> "Recuperação"
        else -> "Principal"
    }

    fun stepLine(step: Step): String {
        val name = step.label ?: roleLabel(step.role)
        val pace = paceRange(step.paceFast, step.paceSlow)
        return listOfNotNull(name, goal(step), pace).joinToString(" · ")
    }

    fun summary(session: Session): String {
        val km = session.distanceKm?.let { if (it == Math.floor(it)) "${it.toInt()} km" else String.format(Locale("pt", "BR"), "%.1f km", it) }
        val min = session.durationMin?.let { "$it min" }
        return listOfNotNull(km, min).joinToString(" · ")
    }

    fun kindLabel(kind: String): String = when (kind) {
        "corrida" -> "Corrida"
        "forca" -> "Musculação"
        "fortalecimento" -> "Fortalecimento"
        else -> "Treino"
    }

    // Hoje / Amanhã / Ontem ou "ter 18/11". `today` e' parametro para o teste nao depender do relogio do computador.
    fun dayLabel(date: String, today: LocalDate = LocalDate.now()): String {
        val day = LocalDate.parse(date)
        return when (day) {
            today -> "Hoje"
            today.plusDays(1) -> "Amanhã"
            today.minusDays(1) -> "Ontem"
            else -> day.format(DateTimeFormatter.ofPattern("EEE dd/MM", Locale("pt", "BR"))).replace(".", "")
        }
    }
}
