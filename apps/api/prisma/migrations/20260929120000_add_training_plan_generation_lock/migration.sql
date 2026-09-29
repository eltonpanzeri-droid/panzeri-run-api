-- Auditoria Astra (29/09/2026), item 02: trava de concorrencia no banco pra geracao de treino.
-- Tabela nova, nada destrutivo.

CREATE TABLE "TrainingPlanGenerationLock" (
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingPlanGenerationLock_pkey" PRIMARY KEY ("userId")
);
