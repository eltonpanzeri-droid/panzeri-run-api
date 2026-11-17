package com.panzerirun.wear.data

// Treino da semana como o servidor entrega (GET /wear/week). So' o que foi prescrito: nenhum dado de saude nem texto livre da aluna.

data class Step(
    val label: String?,
    val role: String, // main | work | recovery
    val goalType: String, // distance | time | open
    val goalMeters: Int?,
    val goalSeconds: Int?,
    val paceFast: Int?, // s/km (mais rapido)
    val paceSlow: Int?, // s/km (mais lento)
)

// Um item do treino: um passo unico (repeatCount == null) ou um bloco repetido (repeatCount x steps).
data class Item(val repeatCount: Int?, val steps: List<Step>)

data class Session(
    val id: String,
    val date: String, // YYYY-MM-DD
    val weekday: Int,
    val kind: String, // corrida | forca | fortalecimento | outra
    val title: String,
    val durationMin: Int?,
    val distanceKm: Double?,
    val done: Boolean,
    val items: List<Item>,
)

data class Week(val generatedAt: String, val sessions: List<Session>)
