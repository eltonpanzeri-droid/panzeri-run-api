package com.panzerirun.wear.ui

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.flow.StateFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
import androidx.wear.compose.material.PositionIndicator
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import androidx.wear.compose.material.Vignette
import androidx.wear.compose.material.VignettePosition
import androidx.wear.compose.navigation.SwipeDismissableNavHost
import androidx.wear.compose.navigation.composable
import androidx.wear.compose.navigation.rememberSwipeDismissableNavController
import com.panzerirun.wear.Screen
import com.panzerirun.wear.UiState
import com.panzerirun.wear.data.Format
import com.panzerirun.wear.data.Item
import com.panzerirun.wear.data.Session
import com.panzerirun.wear.record.RecordingState
import com.panzerirun.wear.record.WorkoutController
import java.time.LocalDate

// Telas do relogio (fase 2, somente leitura): pareamento por codigo, lista da semana e detalhe do treino. Textos curtos, toque grande, funciona sem internet com o que ja' foi baixado.

// O estado chega como StateFlow (mesma instancia sempre) e cada destino da navegacao o coleta DENTRO de si: destinos do NavHost ficam presos ao grafo criado na primeira vez, entao capturar o
// UiState na lista de rotas deixava a tela congelada no primeiro estado (achado no emulador: "Atualizando..." para sempre).
@Composable
fun PanzeriWearApp(stateFlow: StateFlow<UiState>, onRefresh: () -> Unit, onNewCode: () -> Unit, onForget: () -> Unit) {
    val state by stateFlow.collectAsState()
    val recording by WorkoutController.state.collectAsState()
    MaterialTheme {
        // corrida em andamento (ou resumo/erro dela): a tela da corrida tem prioridade sobre a navegacao normal
        if (recording !is RecordingState.Idle) { RecordingFlow(recording); return@MaterialTheme }
        when (val screen = state.screen) {
            Screen.Loading -> CenteredMessage("Abrindo…", progress = true)
            is Screen.Pairing -> PairingScreen(screen, onNewCode)
            Screen.Week -> {
                val nav = rememberSwipeDismissableNavController()
                SwipeDismissableNavHost(navController = nav, startDestination = "week") {
                    composable("week") { val current by stateFlow.collectAsState(); WeekScreen(current, onOpen = { id -> nav.navigate("detail/$id") }, onRefresh = onRefresh, onForget = onForget) }
                    composable("detail/{id}") { entry ->
                        val current by stateFlow.collectAsState()
                        val session = current.week?.sessions?.firstOrNull { it.id == entry.arguments?.getString("id") }
                        if (session == null) CenteredMessage("Treino não encontrado.") else DetailScreen(session)
                    }
                }
            }
        }
    }
}

@Composable
private fun CenteredMessage(text: String, progress: Boolean = false) {
    Box(Modifier.fillMaxSize().padding(16.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (progress) CircularProgressIndicator(Modifier.padding(bottom = 4.dp))
            Text(text, textAlign = TextAlign.Center)
        }
    }
}

@Composable
private fun PairingScreen(screen: Screen.Pairing, onNewCode: () -> Unit) {
    val listState = rememberScalingLazyListState()
    Scaffold(timeText = { TimeText() }, vignette = { Vignette(VignettePosition.TopAndBottom) }) {
        ScalingLazyColumn(Modifier.fillMaxSize(), state = listState, horizontalAlignment = Alignment.CenterHorizontally) {
            item { Text("Conectar ao Panzeri Run", fontWeight = FontWeight.Bold, textAlign = TextAlign.Center) }
            item {
                if (screen.code == null) CircularProgressIndicator()
                else Text(screen.code, fontSize = 28.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colors.primary, textAlign = TextAlign.Center)
            }
            item {
                Text(
                    screen.message ?: "No Panzeri Run do celular, vá em Dispositivos e integrações > Samsung e digite este código.",
                    fontSize = 12.sp, textAlign = TextAlign.Center,
                )
            }
            if (screen.code != null) item { Chip(onClick = onNewCode, label = { Text("Novo código") }, colors = ChipDefaults.secondaryChipColors()) }
        }
    }
}

@Composable
private fun WeekScreen(state: UiState, onOpen: (String) -> Unit, onRefresh: () -> Unit, onForget: () -> Unit) {
    val listState = rememberScalingLazyListState()
    val sessions = (state.week?.sessions ?: emptyList()).filter { !it.done }
    val today = LocalDate.now()
    Scaffold(timeText = { TimeText() }, vignette = { Vignette(VignettePosition.TopAndBottom) }, positionIndicator = { PositionIndicator(scalingLazyListState = listState) }) {
        ScalingLazyColumn(Modifier.fillMaxSize(), state = listState, horizontalAlignment = Alignment.CenterHorizontally) {
            item { Text("Seus treinos", fontWeight = FontWeight.Bold) }
            if (state.noAccess) item(key = "no-access") { Text("Sem acesso ativo ao Panzeri Run. Abra o Panzeri Run no celular.", fontSize = 12.sp, textAlign = TextAlign.Center) }
            if (sessions.isEmpty() && !state.noAccess) {
                item { Text(if (state.week == null) "Baixando os treinos…" else "Nenhum treino pendente nos próximos dias.", fontSize = 12.sp, textAlign = TextAlign.Center) }
            }
            var lastDate: String? = null
            for (session in sessions) {
                if (session.date != lastDate) {
                    lastDate = session.date
                    val label = Format.dayLabel(session.date, today)
                    item(key = "day-${session.date}") { Text(label, fontSize = 12.sp, color = MaterialTheme.colors.secondary, modifier = Modifier.padding(top = 6.dp)) }
                }
                item(key = session.id) {
                    Chip(
                        onClick = { onOpen(session.id) },
                        label = { Text(session.title, maxLines = 2) },
                        secondaryLabel = { Text(Format.summary(session).ifBlank { Format.kindLabel(session.kind) }, maxLines = 1) },
                        colors = ChipDefaults.secondaryChipColors(),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
            // chave inclui o estado: sem ela a lista do relogio nao redesenhava este rodape quando o download terminava (visto no emulador)
            if (state.pendingWorkouts > 0) item(key = "pending-${state.pendingWorkouts}-${state.needsConsent}") {
                val count = if (state.pendingWorkouts == 1) "1 treino aguardando envio" else "${state.pendingWorkouts} treinos aguardando envio"
                Text(if (state.needsConsent) "$count. Autorize o relógio no Panzeri Run do celular para enviar." else count, fontSize = 11.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 6.dp))
            }
            item(key = "status-${state.refreshing}-${state.offline}") {
                val status = when {
                    state.refreshing -> "Atualizando…"
                    state.offline -> "Sem internet: mostrando o último download."
                    else -> null
                }
                if (status != null) Text(status, fontSize = 11.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 6.dp))
            }
            item(key = "refresh-${state.refreshing}") { Chip(onClick = onRefresh, label = { Text("Atualizar") }, colors = ChipDefaults.secondaryChipColors(), enabled = !state.refreshing) }
            item { Chip(onClick = onForget, label = { Text("Desconectar relógio") }, colors = ChipDefaults.secondaryChipColors()) }
        }
    }
}

@Composable
private fun DetailScreen(session: Session) {
    val listState = rememberScalingLazyListState()
    val context = LocalContext.current
    var denied by remember { mutableStateOf(false) }
    // As permissoes (GPS, sensores, reconhecimento de atividade) so' sao pedidas aqui, quando a aluna toca em "Iniciar corrida".
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        val granted = listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.BODY_SENSORS, Manifest.permission.ACTIVITY_RECOGNITION).all { result[it] == true }
        if (granted) WorkoutController.start(context, session.id) else denied = true
    }
    Scaffold(timeText = { TimeText() }, vignette = { Vignette(VignettePosition.TopAndBottom) }, positionIndicator = { PositionIndicator(scalingLazyListState = listState) }) {
        ScalingLazyColumn(Modifier.fillMaxSize(), state = listState, horizontalAlignment = Alignment.CenterHorizontally) {
            item { Text(session.title, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center) }
            item { Text(Format.dayLabel(session.date) + (Format.summary(session).takeIf { it.isNotBlank() }?.let { " · $it" } ?: ""), fontSize = 12.sp, textAlign = TextAlign.Center) }
            if (session.kind == "corrida" && !session.done) {
                item {
                    Chip(
                        onClick = { denied = false; launcher.launch(WorkoutController.requiredPermissions()) },
                        label = { Text("Iniciar corrida") },
                        secondaryLabel = { Text("GPS só durante o treino", maxLines = 1) },
                        modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
                    )
                }
                if (denied) item { Text("Sem a permissão do GPS e dos sensores não dá para gravar a corrida.", fontSize = 11.sp, textAlign = TextAlign.Center) }
            }
            if (session.items.isEmpty()) {
                item { Text("Veja os detalhes deste treino no Panzeri Run do celular.", fontSize = 12.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 8.dp)) }
            }
            for ((index, item) in session.items.withIndex()) {
                item(key = "item-$index") { ItemView(item) }
            }
        }
    }
}

@Composable
private fun ItemView(item: Item) {
    Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        if (item.repeatCount != null) Text("${item.repeatCount} ×", fontWeight = FontWeight.Bold, color = MaterialTheme.colors.primary)
        for (step in item.steps) Text(Format.stepLine(step), fontSize = 13.sp)
    }
}
