package com.panzerirun.wear.ui

import android.os.SystemClock
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.CircularProgressIndicator
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import androidx.wear.compose.material.Vignette
import androidx.wear.compose.material.VignettePosition
import kotlinx.coroutines.delay
import com.panzerirun.wear.data.Format
import com.panzerirun.wear.record.RecordingState
import com.panzerirun.wear.record.RecordingSummary
import com.panzerirun.wear.record.WorkoutController

// Telas da corrida (fase 3): gravando (tempo, distancia, frequencia, pace, pausar/encerrar), resumo e erro. Textos grandes e curtos; encerrar pede uma confirmacao para nao acabar sem querer.

object RecordingFormat {
    fun clock(totalSec: Long): String {
        val h = totalSec / 3600
        val m = (totalSec % 3600) / 60
        val s = totalSec % 60
        return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%02d:%02d".format(m, s)
    }
    fun km(meters: Double): String = "%.2f".format(java.util.Locale("pt", "BR"), meters / 1000.0)
}

@Composable
fun RecordingFlow(state: RecordingState) {
    when (state) {
        RecordingState.Preparing -> Box(Modifier.fillMaxSize().padding(16.dp), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                CircularProgressIndicator()
                Text("Preparando a corrida…", textAlign = TextAlign.Center)
            }
        }
        is RecordingState.Recording -> RecordingScreen(state)
        is RecordingState.Finished -> FinishedScreen(state.summary)
        is RecordingState.Failed -> FailedScreen(state.message)
        RecordingState.Idle -> Unit
    }
}

@Composable
private fun RecordingScreen(state: RecordingState.Recording) {
    val context = LocalContext.current
    var confirmStop by remember { mutableStateOf(false) }
    // relogio da tela: recalcula a cada segundo a partir do tempo ativo acumulado
    var now by remember { mutableLongStateOf(SystemClock.elapsedRealtime()) }
    LaunchedEffect(state.paused) { while (true) { now = SystemClock.elapsedRealtime(); delay(500) } }
    val activeMs = state.activeBaseMs + (state.activeSinceElapsed?.let { (now - it).coerceAtLeast(0) } ?: 0L)
    val listState = rememberScalingLazyListState()
    Scaffold(timeText = { TimeText() }, vignette = { Vignette(VignettePosition.TopAndBottom) }) {
        ScalingLazyColumn(Modifier.fillMaxSize(), state = listState, horizontalAlignment = Alignment.CenterHorizontally) {
            item { Text(RecordingFormat.clock(activeMs / 1000), fontSize = 34.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colors.primary) }
            item { Text(if (state.paused) "Pausado" else "${RecordingFormat.km(state.distanceMeters)} km", fontSize = 22.sp, fontWeight = FontWeight.Bold) }
            item { Text("Em movimento ${RecordingFormat.clock(state.movingMs / 1000)}", fontSize = 12.sp, textAlign = TextAlign.Center) }
            item {
                val parts = listOfNotNull(state.heartRate?.let { "$it bpm" }, state.paceSecPerKm?.let { "${Format.pace(it)}/km" })
                Text(if (parts.isEmpty()) "Medindo…" else parts.joinToString("  ·  "), fontSize = 14.sp, textAlign = TextAlign.Center)
            }
            if (!state.gpsReady) item { Text("Procurando o GPS… comece a correr ao ar livre.", fontSize = 11.sp, textAlign = TextAlign.Center) }
            if (!confirmStop) {
                item {
                    Chip(
                        onClick = { if (state.paused) WorkoutController.resume(context) else WorkoutController.pause(context) },
                        label = { Text(if (state.paused) "Retomar" else "Pausar") },
                        colors = ChipDefaults.secondaryChipColors(), modifier = Modifier.fillMaxWidth(),
                    )
                }
                item { Chip(onClick = { confirmStop = true }, label = { Text("Encerrar") }, colors = ChipDefaults.secondaryChipColors(), modifier = Modifier.fillMaxWidth()) }
            } else {
                item { Text("Encerrar o treino?", fontWeight = FontWeight.Bold, textAlign = TextAlign.Center) }
                item { Chip(onClick = { WorkoutController.stop(context) }, label = { Text("Sim, encerrar") }, modifier = Modifier.fillMaxWidth()) }
                item { Chip(onClick = { confirmStop = false }, label = { Text("Continuar") }, colors = ChipDefaults.secondaryChipColors(), modifier = Modifier.fillMaxWidth()) }
            }
        }
    }
}

@Composable
private fun FinishedScreen(summary: RecordingSummary) {
    val listState = rememberScalingLazyListState()
    Scaffold(timeText = { TimeText() }, vignette = { Vignette(VignettePosition.TopAndBottom) }) {
        ScalingLazyColumn(Modifier.fillMaxSize(), state = listState, horizontalAlignment = Alignment.CenterHorizontally) {
            item { Text("Treino concluído", fontWeight = FontWeight.Bold, textAlign = TextAlign.Center) }
            item { Text("${RecordingFormat.km(summary.distanceMeters)} km", fontSize = 22.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center) }
            item { Text("Em movimento ${RecordingFormat.clock(summary.movingSec.toLong())}", fontSize = 14.sp, textAlign = TextAlign.Center) }
            item { Text("Tempo da atividade ${RecordingFormat.clock(summary.elapsedSec.toLong())}", fontSize = 14.sp, textAlign = TextAlign.Center) }
            item { Text(if (summary.movingSec > 0 && summary.distanceMeters >= 50) "Ritmo médio ${Format.pace(Math.round(summary.movingSec / (summary.distanceMeters / 1000.0)).toInt())}/km" else "", fontSize = 12.sp, textAlign = TextAlign.Center) }
            item { Text(listOfNotNull(summary.avgHr?.let { "média $it bpm" }, summary.maxHr?.let { "máx $it bpm" }).joinToString(" · ").ifBlank { "Sem frequência cardíaca" }, fontSize = 12.sp, textAlign = TextAlign.Center) }
            item { Text(if (summary.hasRoute) "Percurso gravado." else "Sem percurso (GPS não encontrado).", fontSize = 12.sp, textAlign = TextAlign.Center) }
            item { Text("Guardado no relógio. O envio ao Panzeri Run é automático quando houver internet e a autorização no celular.", fontSize = 11.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 4.dp)) }
            item { Chip(onClick = { WorkoutController.acknowledge() }, label = { Text("OK") }, modifier = Modifier.fillMaxWidth()) }
        }
    }
}

@Composable
private fun FailedScreen(message: String) {
    Box(Modifier.fillMaxSize().padding(16.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(message, textAlign = TextAlign.Center, fontSize = 13.sp)
            Chip(onClick = { WorkoutController.acknowledge() }, label = { Text("OK") }, colors = ChipDefaults.secondaryChipColors())
        }
    }
}
