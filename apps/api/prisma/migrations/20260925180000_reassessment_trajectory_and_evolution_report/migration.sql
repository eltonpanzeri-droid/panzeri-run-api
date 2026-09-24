-- Passo 3 (25/09/2026): versionamento explicito de instrumento + Evolution Report persistido.
-- Todas as colunas novas sao nullable/sem default destrutivo: registros existentes ficam com
-- interviewVersion/reassessmentVersion = NULL (legado, nunca reclassificado retroativamente).

ALTER TABLE "OnboardingInterview" ADD COLUMN "interviewVersion" INTEGER;
ALTER TABLE "Reassessment" ADD COLUMN "reassessmentVersion" INTEGER;

CREATE TABLE "EvolutionReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reassessmentId" TEXT NOT NULL,
    "trajectorySnapshot" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "wins" JSONB NOT NULL,
    "concerns" JSONB NOT NULL,
    "domainObservations" JSONB,
    "invalidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvolutionReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EvolutionReport_reassessmentId_key" ON "EvolutionReport"("reassessmentId");
CREATE INDEX "EvolutionReport_userId_createdAt_idx" ON "EvolutionReport"("userId", "createdAt");

ALTER TABLE "EvolutionReport" ADD CONSTRAINT "EvolutionReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EvolutionReport" ADD CONSTRAINT "EvolutionReport_reassessmentId_fkey" FOREIGN KEY ("reassessmentId") REFERENCES "Reassessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
