-- CreateTable: fundacao canonica de entrega de treino pra providers externos (Polar/Garmin/COROS/
-- Apple). Nao representa execucao (ActivityLog/SessionExecutionLink continuam intocados por esta
-- tabela). externalWorkoutId, sentAt, deliveredAt, failedAt, errorMessage e canceledAt sao
-- nullable de proposito: uma tentativa comeca 'pending' sem nenhum desses preenchidos.
-- status: 'pending' | 'sent' | 'delivered_to_device' | 'failed' | 'canceled'. 'delivered_to_device'
-- so' e' usado quando o provider confirma entrega real no dispositivo (nunca inferido de 'sent').
CREATE TABLE "WorkoutDelivery" (
    "id" TEXT NOT NULL,
    "trainingSessionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "canonicalWorkout" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "externalWorkoutId" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "canceledAt" TIMESTAMP(3),
    "providerMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkoutDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkoutDelivery_trainingSessionId_idx" ON "WorkoutDelivery"("trainingSessionId");

-- CreateIndex
CREATE INDEX "WorkoutDelivery_provider_status_idx" ON "WorkoutDelivery"("provider", "status");

-- AddForeignKey
ALTER TABLE "WorkoutDelivery" ADD CONSTRAINT "WorkoutDelivery_trainingSessionId_fkey" FOREIGN KEY ("trainingSessionId") REFERENCES "TrainingSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
