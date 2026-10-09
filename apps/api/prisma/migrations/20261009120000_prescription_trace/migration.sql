-- Rastreabilidade das prescricoes (Etapa 1.2a, 09/10/2026). Migration ADITIVA: so cria 2 tabelas novas e seus indices; nenhuma tabela
-- existente e alterada e nenhum dado existente muda.

-- CreateTable
CREATE TABLE "PrescriptionEvidencePackage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "sessionId" TEXT,
    "kind" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "methodologyVersion" TEXT NOT NULL,
    "modelIds" TEXT[],
    "agentInputHash" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "contextGaps" JSONB NOT NULL,
    "agentInput" JSONB,
    "agentInputPurgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrescriptionEvidencePackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrescriptionDecision" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "sessionId" TEXT,
    "kind" TEXT NOT NULL,
    "weekday" INTEGER,
    "modality" TEXT,
    "summary" TEXT NOT NULL,
    "changeFromPrevious" JSONB,
    "rationale" JSONB,
    "intent" TEXT,
    "expected" JSONB,
    "basis" JSONB,
    "traceStatus" TEXT NOT NULL DEFAULT 'absent',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrescriptionDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PrescriptionEvidencePackage_userId_createdAt_idx" ON "PrescriptionEvidencePackage"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PrescriptionEvidencePackage_planId_idx" ON "PrescriptionEvidencePackage"("planId");

-- CreateIndex
CREATE INDEX "PrescriptionEvidencePackage_sessionId_idx" ON "PrescriptionEvidencePackage"("sessionId");

-- CreateIndex
CREATE INDEX "PrescriptionEvidencePackage_createdAt_idx" ON "PrescriptionEvidencePackage"("createdAt");

-- CreateIndex
CREATE INDEX "PrescriptionDecision_userId_createdAt_idx" ON "PrescriptionDecision"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PrescriptionDecision_packageId_idx" ON "PrescriptionDecision"("packageId");

-- CreateIndex
CREATE INDEX "PrescriptionDecision_sessionId_idx" ON "PrescriptionDecision"("sessionId");

-- CreateIndex
CREATE INDEX "PrescriptionDecision_planId_idx" ON "PrescriptionDecision"("planId");

-- AddForeignKey
ALTER TABLE "PrescriptionDecision" ADD CONSTRAINT "PrescriptionDecision_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "PrescriptionEvidencePackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
