-- CreateTable: fundacao canonica de entrega de treino pra providers externos (Polar/Garmin/COROS/
-- Apple). Nao representa execucao (ActivityLog/SessionExecutionLink continuam intocados por esta
-- tabela). externalWorkoutId, sentAt, failedAt e errorMessage sao nullable de proposito: uma
-- tentativa comeca 'pending' sem nenhum desses preenchidos.
CREATE TABLE "WorkoutDelivery" (
    "id" TEXT NOT NULL,
    "trainingSessionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "canonicalWorkout" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "externalWorkoutId" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
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
