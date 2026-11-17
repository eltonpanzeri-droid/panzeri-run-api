package com.panzerirun.wear.record

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.health.services.client.ExerciseClient
import androidx.health.services.client.ExerciseUpdateCallback
import androidx.health.services.client.HealthServices
import androidx.health.services.client.data.Availability
import androidx.health.services.client.data.DataType
import androidx.health.services.client.data.ExerciseConfig
import androidx.health.services.client.data.ExerciseLapSummary
import androidx.health.services.client.data.ExerciseTrackedStatus
import androidx.health.services.client.data.ExerciseType
import androidx.health.services.client.data.ExerciseUpdate
import androidx.wear.ongoing.OngoingActivity
import androidx.wear.ongoing.Status
import com.panzerirun.wear.MainActivity
import com.panzerirun.wear.R
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.guava.await
import kotlinx.coroutines.launch
import java.util.TimeZone

// Gravacao do treino (fase 3). SO' existe enquanto a aluna esta correndo: roda em primeiro plano com a notificacao visivel, le frequencia cardiaca, distancia e GPS pelo Health Services
// e para sozinho ao encerrar. Nao pede localizacao em segundo plano e nao coleta nada fora do treino. O treino encerrado fica guardado no relogio (WorkoutStore).
class WorkoutService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var snapshotJob: Job? = null
    private lateinit var client: ExerciseClient
    private lateinit var store: WorkoutStore
    private var recorder: Recorder? = null
    private var gpsReady = false
    private var lastSpeed: Double? = null
    private var paused = false
    private var registered = false

    private val callback = object : ExerciseUpdateCallback {
        override fun onRegistered() {}
        override fun onRegistrationFailed(throwable: Throwable) { fail("Não consegui ligar os sensores do relógio.") }
        override fun onLapSummaryReceived(lapSummary: ExerciseLapSummary) {}
        override fun onAvailabilityChanged(dataType: DataType<*, *>, availability: Availability) {
            if (dataType == DataType.LOCATION) { gpsReady = availability == androidx.health.services.client.data.LocationAvailability.ACQUIRED_TETHERED || availability == androidx.health.services.client.data.LocationAvailability.ACQUIRED_UNTETHERED; publish() }
        }
        override fun onExerciseUpdateReceived(update: ExerciseUpdate) { handle(update) }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        client = HealthServices.getClient(this).exerciseClient
        store = WorkoutStore(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            WorkoutController.ACTION_START -> begin(intent.getStringExtra(WorkoutController.EXTRA_SESSION_ID), intent.getBooleanExtra(WorkoutController.EXTRA_REPLACE, false))
            WorkoutController.ACTION_PAUSE -> scope.launch { runCatching { client.pauseExerciseAsync().await() } }
            WorkoutController.ACTION_RESUME -> scope.launch { runCatching { client.resumeExerciseAsync().await() } }
            WorkoutController.ACTION_STOP -> finish()
            else -> if (recorder == null) stopSelf()
        }
        return START_NOT_STICKY
    }

    private fun begin(sessionId: String?, replace: Boolean) {
        if (recorder != null) return
        startInForeground()
        scope.launch {
            try {
                // Corrida anterior que o sistema deixou aberta (app fechado no meio): o relogio NUNCA a encerra sozinho; pergunta primeiro. So' encerra depois da confirmacao (replace).
                // Treino de OUTRO aplicativo em andamento: nao mexe, avisa.
                val status = runCatching { client.getCurrentExerciseInfoAsync().await().exerciseTrackedStatus }.getOrNull()
                val kind = when (status) { ExerciseTrackedStatus.OWNED_EXERCISE_IN_PROGRESS -> TrackedKind.OWNED_IN_PROGRESS; ExerciseTrackedStatus.OTHER_APP_IN_PROGRESS -> TrackedKind.OTHER_APP_IN_PROGRESS; else -> TrackedKind.NONE }
                when (StartPolicy.decide(kind, replace)) {
                    StartDecision.OtherAppRunning -> return@launch fail("Outro aplicativo de treino está em andamento. Encerre-o e tente de novo.")
                    StartDecision.AskReplace -> {
                        WorkoutController.publish(RecordingState.ConfirmReplace(sessionId))
                        stopForegroundAndSelf()
                        return@launch
                    }
                    StartDecision.EndOldThenProceed -> runCatching { client.endExerciseAsync().await() }
                    StartDecision.Proceed -> Unit
                }
                val capabilities = client.getCapabilitiesAsync().await()
                if (ExerciseType.RUNNING !in capabilities.supportedExerciseTypes) return@launch fail("Este relógio não permite gravar corrida pelo Panzeri Run.")
                val supported = capabilities.getExerciseTypeCapabilities(ExerciseType.RUNNING).supportedDataTypes
                val wanted = setOf<DataType<*, *>>(DataType.HEART_RATE_BPM, DataType.DISTANCE_TOTAL, DataType.SPEED, DataType.LOCATION).filter { it in supported }.toSet()
                val config = ExerciseConfig.builder(ExerciseType.RUNNING)
                    .setDataTypes(wanted)
                    .setIsAutoPauseAndResumeEnabled(false)
                    .setIsGpsEnabled(DataType.LOCATION in supported)
                    .build()
                client.setUpdateCallback(callback)
                registered = true
                client.startExerciseAsync(config).await()
                val now = System.currentTimeMillis()
                recorder = Recorder(sessionId, now, TimeZone.getDefault().getOffset(now) / 60_000)
                paused = false
                publish()
                store.clearInProgress()
                lastJournalSecond = -1
                // Diario de seguranca a cada 5 s: resumo + so' os pontos novos (perda maxima de cerca de 5 s se o app for fechado no meio)
                snapshotJob = scope.launch {
                    while (true) {
                        delay(JOURNAL_INTERVAL_MS)
                        writeJournal()
                    }
                }
            } catch (e: Exception) {
                fail("Não consegui iniciar a corrida. Feche outros apps de treino e tente de novo.")
            }
        }
    }

    private var lastJournalSecond = -1

    private fun writeJournal() {
        val rec = recorder ?: return
        val now = System.currentTimeMillis()
        val current = rec.currentSecond(now)
        val fresh = rec.pointsJson(lastJournalSecond, current) // so' segundos completos
        runCatching { store.appendJournal(rec.metaJson(now, interrupted = true), fresh) }
        lastJournalSecond = current - 1
    }

    private fun handle(update: ExerciseUpdate) {
        val rec = recorder ?: return
        val now = System.currentTimeMillis()
        val bootMillis = now - SystemClock.elapsedRealtime()
        val metrics = update.latestMetrics
        metrics.getData(DataType.HEART_RATE_BPM).forEach { rec.onHeartRate(bootMillis + it.timeDurationFromBoot.toMillis(), it.value) }
        metrics.getData(DataType.LOCATION).forEach { rec.onLocation(bootMillis + it.timeDurationFromBoot.toMillis(), it.value.latitude, it.value.longitude, it.value.altitude) }
        metrics.getData(DataType.SPEED).forEach { rec.onSpeed(bootMillis + it.timeDurationFromBoot.toMillis(), it.value); lastSpeed = it.value }
        metrics.getData(DataType.DISTANCE_TOTAL)?.let { rec.onDistanceTotal(now, it.total) }
        val state = update.exerciseStateInfo.state
        if (state.isEnded) { finish(); return }
        val nowPaused = state.isPaused
        if (nowPaused && !paused) rec.onPaused(now) else if (!nowPaused && paused) rec.onResumed(now)
        paused = nowPaused
        publish()
    }

    private fun publish() {
        val rec = recorder ?: return
        val now = System.currentTimeMillis()
        val pace = lastSpeed?.takeIf { it > 0.5 && !paused }?.let { Math.round(1000.0 / it).toInt() }
        WorkoutController.publish(RecordingState.Recording(
            paused = paused, activeBaseMs = rec.activeMillis(now), activeSinceElapsed = if (paused) null else SystemClock.elapsedRealtime(),
            movingMs = rec.movingMillis(), distanceMeters = rec.distanceMeters(), heartRate = rec.lastHeartRate(), paceSecPerKm = pace, gpsReady = gpsReady,
        ))
    }

    private fun finish() {
        val rec = recorder
        scope.launch {
            runCatching { client.endExerciseAsync().await() }
            runCatching { client.clearUpdateCallbackAsync(callback).await() }
            registered = false
            snapshotJob?.cancel()
            if (rec == null) { WorkoutController.publish(RecordingState.Idle); stopForegroundAndSelf(); return@launch }
            val ended = System.currentTimeMillis()
            val summary = rec.summary(ended)
            if (summary.activeSec < 10) {
                // Menos de 10 s: quase sempre foi um toque sem querer, mas quem decide e' a aluna (guardar ou descartar). Nada e' apagado antes da resposta.
                WorkoutController.publish(RecordingState.ConfirmShort(summary, rec.toJson(ended).toString()))
            } else {
                store.savePending(rec.clientId, rec.toJson(ended))
                store.clearInProgress()
                WorkoutController.publish(RecordingState.Finished(summary))
            }
            recorder = null
            stopForegroundAndSelf()
        }
    }

    private fun fail(message: String) {
        scope.launch {
            if (registered) runCatching { client.clearUpdateCallbackAsync(callback).await() }
            registered = false
            snapshotJob?.cancel()
            recorder = null
            WorkoutController.publish(RecordingState.Failed(message))
            stopForegroundAndSelf()
        }
    }

    private fun stopForegroundAndSelf() {
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun startInForeground() {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Treino em andamento", NotificationManager.IMPORTANCE_LOW))
        val touch = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle("Corrida em andamento")
            .setContentText("Toque para voltar ao treino")
            .setCategory(NotificationCompat.CATEGORY_WORKOUT)
            .setOngoing(true)
            .setContentIntent(touch)
        // a atividade em andamento aparece no mostrador, com atalho para voltar ao app
        OngoingActivity.Builder(this, NOTIFICATION_ID, builder)
            .setStaticIcon(R.drawable.ic_launcher_foreground)
            .setTouchIntent(touch)
            .setStatus(Status.Builder().addTemplate("Corrida").build())
            .build().apply(this)
        val notification: Notification = builder.build()
        val type = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH or ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
        startForeground(NOTIFICATION_ID, notification, type)
    }

    override fun onDestroy() {
        // se o sistema derrubar o servico no meio, a copia periodica fica em in-progress.json e e' recuperada na proxima abertura
        scope.cancel()
        super.onDestroy()
    }

    private companion object {
        const val CHANNEL_ID = "recording"
        const val NOTIFICATION_ID = 7
        const val JOURNAL_INTERVAL_MS = 5_000L
    }
}
