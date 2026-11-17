package com.panzerirun.wear

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import com.panzerirun.wear.record.RecordingState
import com.panzerirun.wear.record.WorkoutController
import com.panzerirun.wear.ui.PanzeriWearApp

class MainActivity : ComponentActivity() {
    private val viewModel: AppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // SO' na variante debug: permite abrir a pergunta "corrida em andamento" para conferir a tela (adb shell am start ... --es debugPrompt replace). Na release este bloco nao existe.
        if (BuildConfig.DEBUG && intent.getStringExtra("debugPrompt") == "replace") WorkoutController.publish(RecordingState.ConfirmReplace(intent.getStringExtra("sessionId")))
        setContent {
            PanzeriWearApp(stateFlow = viewModel.state, onRefresh = viewModel::refresh, onNewCode = viewModel::newCode, onForget = viewModel::forgetPairing)
        }
    }

    override fun onStart() {
        super.onStart()
        // ao voltar para o app, baixa a semana de novo (se ja' pareado); sem internet, mostra o que esta guardado
        if (viewModel.state.value.screen == Screen.Week) viewModel.refresh()
    }
}
