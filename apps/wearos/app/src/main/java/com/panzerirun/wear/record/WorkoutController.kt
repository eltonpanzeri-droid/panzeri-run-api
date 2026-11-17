package com.panzerirun.wear.record

import android.Manifest
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.content.ContextCompat
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

// Ponte entre a tela e o servico de gravacao. O servico escreve o estado aqui; a tela so' le e manda comandos (iniciar, pausar, retomar, encerrar).

sealed interface RecordingState {
    object Idle : RecordingState
    object Preparing : RecordingState
    data class Recording(
        val paused: Boolean,
        val activeBaseMs: Long, // tempo ativo acumulado ate' a ultima mudanca de estado
        val activeSinceElapsed: Long?, // SystemClock.elapsedRealtime() em que voltou a contar (null = pausado)
        val distanceMeters: Double,
        val heartRate: Int?,
        val paceSecPerKm: Int?,
        val gpsReady: Boolean,
    ) : RecordingState
    data class Finished(val summary: RecordingSummary) : RecordingState
    data class Failed(val message: String) : RecordingState
}

object WorkoutController {
    const val ACTION_START = "com.panzerirun.wear.record.START"
    const val ACTION_PAUSE = "com.panzerirun.wear.record.PAUSE"
    const val ACTION_RESUME = "com.panzerirun.wear.record.RESUME"
    const val ACTION_STOP = "com.panzerirun.wear.record.STOP"
    const val EXTRA_SESSION_ID = "sessionId"

    private val _state = MutableStateFlow<RecordingState>(RecordingState.Idle)
    val state: StateFlow<RecordingState> = _state.asStateFlow()

    internal fun publish(state: RecordingState) { _state.value = state }

    fun acknowledge() { if (_state.value is RecordingState.Finished || _state.value is RecordingState.Failed) _state.value = RecordingState.Idle }

    // Permissoes pedidas SO' quando a aluna toca em "Iniciar corrida" (nunca ao abrir o app).
    fun requiredPermissions(): Array<String> = buildList {
        add(Manifest.permission.ACCESS_FINE_LOCATION)
        add(Manifest.permission.BODY_SENSORS)
        add(Manifest.permission.ACTIVITY_RECOGNITION)
        if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
    }.toTypedArray()

    private fun send(context: Context, action: String, sessionId: String? = null, foreground: Boolean = false) {
        val intent = Intent(context, WorkoutService::class.java).setAction(action).apply { sessionId?.let { putExtra(EXTRA_SESSION_ID, it) } }
        if (foreground) ContextCompat.startForegroundService(context, intent) else context.startService(intent)
    }

    fun start(context: Context, sessionId: String?) {
        if (_state.value is RecordingState.Preparing || _state.value is RecordingState.Recording) return
        _state.value = RecordingState.Preparing
        send(context, ACTION_START, sessionId, foreground = true)
    }
    fun pause(context: Context) = send(context, ACTION_PAUSE)
    fun resume(context: Context) = send(context, ACTION_RESUME)
    fun stop(context: Context) = send(context, ACTION_STOP)
}
