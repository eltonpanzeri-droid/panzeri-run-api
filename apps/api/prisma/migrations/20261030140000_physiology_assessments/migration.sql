-- Testes fisicos (30/10/2026). Aditivo: nenhuma coluna ou tabela existente perde dado.
-- FitnessTest ganha a data real do teste e a versao do modelo; totalSeconds, FC e notes (resultado original) nao sao tocados.
ALTER TABLE "FitnessTest" ADD COLUMN "performedAt" DATE;
ALTER TABLE "FitnessTest" ADD COLUMN "modelVersion" TEXT;

CREATE TABLE "PhysiologicalAssessment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "domain" TEXT NOT NULL DEFAULT 'aerobic',
    "method" TEXT NOT NULL,
    "methodLabel" TEXT,
    "performedAt" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "enteredByUserId" TEXT,
    "rawResults" JSONB NOT NULL,
    "limitations" JSONB,
    "notes" TEXT,
    "fitnessTestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhysiologicalAssessment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PhysiologicalIndicator" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "rangeLow" DOUBLE PRECISION,
    "rangeHigh" DOUBLE PRECISION,
    "modelVersion" TEXT,
    "basis" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhysiologicalIndicator_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OperationalReference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "referenceAssessmentId" TEXT,
    "payload" JSONB NOT NULL,
    "justification" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationalReference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PhysiologicalAssessment_fitnessTestId_key" ON "PhysiologicalAssessment"("fitnessTestId");
CREATE INDEX "PhysiologicalAssessment_userId_performedAt_idx" ON "PhysiologicalAssessment"("userId", "performedAt");
CREATE UNIQUE INDEX "PhysiologicalIndicator_assessmentId_key_key" ON "PhysiologicalIndicator"("assessmentId", "key");
CREATE INDEX "PhysiologicalIndicator_userId_key_idx" ON "PhysiologicalIndicator"("userId", "key");
CREATE UNIQUE INDEX "OperationalReference_userId_version_key" ON "OperationalReference"("userId", "version");

ALTER TABLE "PhysiologicalAssessment" ADD CONSTRAINT "PhysiologicalAssessment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PhysiologicalAssessment" ADD CONSTRAINT "PhysiologicalAssessment_fitnessTestId_fkey" FOREIGN KEY ("fitnessTestId") REFERENCES "FitnessTest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PhysiologicalIndicator" ADD CONSTRAINT "PhysiologicalIndicator_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "PhysiologicalAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PhysiologicalIndicator" ADD CONSTRAINT "PhysiologicalIndicator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OperationalReference" ADD CONSTRAINT "OperationalReference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
