-- Correcao definitiva do ciclo de vida da prescricao (25/09/2026, fechamento do Passo 2).
-- Todas as colunas sao nullable/com default seguro — nao reinterpreta nenhum dado legado.

-- TrainingSession: origem real (nullable = desconhecido pra registros antigos), rastreabilidade
-- temporal minima, e snapshot append-only da prescricao quando editada apos ja ter completion.
ALTER TABLE "TrainingSession" ADD COLUMN "origin" TEXT;
ALTER TABLE "TrainingSession" ADD COLUMN "prescriptionHistory" JSONB;
ALTER TABLE "TrainingSession" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- WorkoutCompletion: motivos de "Fiz, mas mudei o treino" (rotulo novo do status legado 'adjusted').
ALTER TABLE "WorkoutCompletion" ADD COLUMN "adjustmentReasons" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "WorkoutCompletion" ADD COLUMN "adjustmentComment" TEXT;
ALTER TABLE "WorkoutCompletion" ADD COLUMN "adjustmentPreferredActivity" TEXT;
