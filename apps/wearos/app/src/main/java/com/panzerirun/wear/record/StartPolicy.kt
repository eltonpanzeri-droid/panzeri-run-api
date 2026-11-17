package com.panzerirun.wear.record

// O que fazer ao tocar em "Iniciar corrida" conforme a situacao do Health Services (17/11/2026, ordem de Elton: o relogio NUNCA encerra uma corrida sozinho; pergunta primeiro).
// Logica pura para ser testada sem relogio.
enum class TrackedKind { NONE, OWNED_IN_PROGRESS, OTHER_APP_IN_PROGRESS }

sealed interface StartDecision {
    object Proceed : StartDecision // nada em andamento: comeca
    object AskReplace : StartDecision // ha corrida nossa em andamento: pergunta se encerra a antiga
    object EndOldThenProceed : StartDecision // a aluna ja confirmou: encerra a antiga e comeca a nova
    object OtherAppRunning : StartDecision // treino de outro aplicativo: nao mexe, avisa
}

object StartPolicy {
    fun decide(tracked: TrackedKind, userConfirmedReplace: Boolean): StartDecision = when (tracked) {
        TrackedKind.NONE -> StartDecision.Proceed
        TrackedKind.OTHER_APP_IN_PROGRESS -> StartDecision.OtherAppRunning
        TrackedKind.OWNED_IN_PROGRESS -> if (userConfirmedReplace) StartDecision.EndOldThenProceed else StartDecision.AskReplace
    }
}
