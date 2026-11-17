package com.panzerirun.wear

import com.panzerirun.wear.record.StartDecision
import com.panzerirun.wear.record.StartPolicy
import com.panzerirun.wear.record.TrackedKind
import org.junit.Assert.assertEquals
import org.junit.Test

// Regra de Elton (17/11/2026): corrida antiga so e encerrada depois que a aluna confirma.
class StartPolicyTest {
    @Test fun `sem nada em andamento comeca direto`() {
        assertEquals(StartDecision.Proceed, StartPolicy.decide(TrackedKind.NONE, false))
        assertEquals(StartDecision.Proceed, StartPolicy.decide(TrackedKind.NONE, true))
    }

    @Test fun `corrida nossa em andamento pergunta antes de encerrar`() {
        assertEquals(StartDecision.AskReplace, StartPolicy.decide(TrackedKind.OWNED_IN_PROGRESS, false))
    }

    @Test fun `depois da confirmacao encerra a antiga e comeca a nova`() {
        assertEquals(StartDecision.EndOldThenProceed, StartPolicy.decide(TrackedKind.OWNED_IN_PROGRESS, true))
    }

    @Test fun `treino de outro aplicativo nunca e encerrado pelo relogio`() {
        assertEquals(StartDecision.OtherAppRunning, StartPolicy.decide(TrackedKind.OTHER_APP_IN_PROGRESS, false))
        assertEquals(StartDecision.OtherAppRunning, StartPolicy.decide(TrackedKind.OTHER_APP_IN_PROGRESS, true))
    }
}
