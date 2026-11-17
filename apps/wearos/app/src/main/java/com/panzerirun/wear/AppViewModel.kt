package com.panzerirun.wear

import android.app.Application
import android.os.Build
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.panzerirun.wear.data.Api
import com.panzerirun.wear.data.ApiException
import com.panzerirun.wear.data.PendingPairing
import com.panzerirun.wear.data.PollResult
import com.panzerirun.wear.data.Store
import com.panzerirun.wear.data.Week
import com.panzerirun.wear.record.RecordingState
import com.panzerirun.wear.record.WorkoutController
import com.panzerirun.wear.record.WorkoutStore
import com.panzerirun.wear.data.WeekParser
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

sealed interface Screen {
    object Loading : Screen
    data class Pairing(val code: String?, val message: String?) : Screen
    object Week : Screen
}

data class UiState(
    val screen: Screen = Screen.Loading,
    val week: Week? = null,
    val refreshing: Boolean = false,
    // true = a ultima tentativa de baixar falhou: a tela mostra o que ja' estava no relogio
    val offline: Boolean = false,
    val noAccess: Boolean = false,
    val updatedAtMillis: Long? = null,
    // treinos gravados no relogio e ainda nao enviados ao Panzeri Run (o envio entra na proxima etapa)
    val pendingWorkouts: Int = 0,
)

// Fase 2 (somente leitura): parear por codigo e mostrar os treinos da semana, guardados no relogio.
class AppViewModel(application: Application) : AndroidViewModel(application) {
    private val store = Store(application)
    private val workouts = WorkoutStore(application)
    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()
    private var pairingJob: Job? = null

    init {
        // treino que o sistema encerrou no meio (se a copia periodica existir) entra na fila como interrompido
        if (WorkoutController.state.value is RecordingState.Idle) workouts.recoverInterrupted()
        _state.update { it.copy(pendingWorkouts = workouts.pendingCount()) }
        viewModelScope.launch { WorkoutController.state.collect { if (it is RecordingState.Finished) _state.update { s -> s.copy(pendingWorkouts = workouts.pendingCount()) } } }
        loadCachedWeek()
        if (store.token != null) {
            _state.update { it.copy(screen = Screen.Week) }
            refresh()
        } else {
            startPairing()
        }
    }

    private fun loadCachedWeek() {
        val cached = store.cachedWeek() ?: return
        runCatching { WeekParser.parse(cached.json) }.onSuccess { week -> _state.update { it.copy(week = week, updatedAtMillis = cached.savedAtMillis) } }
    }

    fun refresh() {
        val token = store.token ?: return startPairing()
        if (_state.value.refreshing) return
        _state.update { it.copy(refreshing = true) }
        viewModelScope.launch {
            try {
                val json = Api.weekJson(token)
                val week = WeekParser.parse(json)
                val now = System.currentTimeMillis()
                store.saveWeek(json, now)
                _state.update { it.copy(week = week, offline = false, noAccess = false, updatedAtMillis = now) }
            } catch (e: ApiException) {
                when {
                    e.status == 401 -> { forgetPairing() } // relogio retirado no Panzeri Run: pede novo pareamento
                    e.status == 403 -> _state.update { it.copy(noAccess = true, offline = false) }
                    else -> _state.update { it.copy(offline = true) }
                }
            } catch (e: Exception) {
                Log.w("PanzeriWear", "refresh falhou: $e")
                _state.update { it.copy(offline = true) }
            } finally {
                _state.update { it.copy(refreshing = false) }
            }
        }
    }

    // Esquecer este relogio (credencial e treinos guardados) e voltar a pedir pareamento.
    fun forgetPairing() {
        store.token = null
        store.savePairing(null)
        store.clearWeek()
        _state.update { UiState(screen = Screen.Loading) }
        startPairing()
    }

    fun newCode() {
        store.savePairing(null)
        startPairing()
    }

    private fun startPairing() {
        pairingJob?.cancel()
        pairingJob = viewModelScope.launch {
            _state.update { it.copy(screen = Screen.Pairing(code = null, message = null)) }
            var pending = store.pendingPairing()?.takeIf { it.expiresAtMillis > System.currentTimeMillis() + 15_000 }
            while (true) {
                if (pending == null) {
                    pending = try {
                        val started = Api.startPairing(deviceName())
                        PendingPairing(started.pairingId, started.pollSecret, started.code, started.expiresAtMillis).also { store.savePairing(it) }
                    } catch (e: Exception) {
                        _state.update { it.copy(screen = Screen.Pairing(code = null, message = "Sem conexão. Tentando de novo…")) }
                        delay(5_000)
                        continue
                    }
                }
                _state.update { it.copy(screen = Screen.Pairing(code = pending!!.code, message = null)) }
                when (val result = try { Api.poll(pending.pairingId, pending.pollSecret) } catch (e: ApiException) { if (e.status == 401) PollResult.Expired else PollResult.Pending } catch (e: Exception) { PollResult.Pending }) {
                    is PollResult.Paired -> {
                        store.token = result.token
                        store.savePairing(null)
                        _state.update { it.copy(screen = Screen.Week) }
                        refresh()
                        return@launch
                    }
                    PollResult.Expired, PollResult.Revoked, PollResult.AlreadyIssued -> { store.savePairing(null); pending = null }
                    PollResult.Pending -> if (pending.expiresAtMillis <= System.currentTimeMillis()) { store.savePairing(null); pending = null }
                }
                delay(3_000)
            }
        }
    }

    private fun deviceName(): String {
        val model = Build.MODEL?.trim().orEmpty()
        val maker = Build.MANUFACTURER?.trim().orEmpty()
        return if (model.startsWith(maker, ignoreCase = true) || maker.isEmpty()) model else "$maker $model"
    }
}
