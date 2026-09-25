-- Passo 4 (25/09/2026): ContextEvent (contexto longitudinal + retorno apos lacuna).
-- Tabela nova + uma coluna nullable em WorkoutCompletion. Nada destrutivo.

CREATE TABLE "ContextEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "subtype" TEXT,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'ongoing',
    "source" TEXT NOT NULL,
    "originalText" TEXT,
    "gapAnchorDate" TIMESTAMP(3),
    "trainingDuringGapReported" TEXT,
    "physicalStateComparedToBefore" INTEGER,
    "mentalReadinessComparedToBefore" INTEGER,
    "firstObservationLinkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContextEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContextEvent_userId_createdAt_idx" ON "ContextEvent"("userId", "createdAt");
CREATE INDEX "ContextEvent_userId_status_idx" ON "ContextEvent"("userId", "status");
CREATE INDEX "ContextEvent_userId_gapAnchorDate_idx" ON "ContextEvent"("userId", "gapAnchorDate");

ALTER TABLE "ContextEvent" ADD CONSTRAINT "ContextEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkoutCompletion" ADD COLUMN "firstObservationAfterGapEventId" TEXT;
CREATE INDEX "WorkoutCompletion_firstObservationAfterGapEventId_idx" ON "WorkoutCompletion"("firstObservationAfterGapEventId");
ALTER TABLE "WorkoutCompletion" ADD CONSTRAINT "WorkoutCompletion_firstObservationAfterGapEventId_fkey" FOREIGN KEY ("firstObservationAfterGapEventId") REFERENCES "ContextEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
