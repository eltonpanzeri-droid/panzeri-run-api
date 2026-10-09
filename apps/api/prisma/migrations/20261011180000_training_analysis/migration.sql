-- Etapa 2.2 (11/10/2026): contrato persistente do Analista de Treinos. Migration ADITIVA: 1 tabela nova e indices; nada existente muda.

-- CreateTable
CREATE TABLE "TrainingAnalysis" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "refKey" TEXT NOT NULL,
    "analystVersion" INTEGER NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "contract" JSONB NOT NULL,
    "sources" JSONB NOT NULL,
    "sourceFingerprint" TEXT NOT NULL,
    "deliveredWithPlanId" TEXT,
    "invalidatedProviders" JSONB,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrainingAnalysis_userId_scope_refKey_idx" ON "TrainingAnalysis"("userId", "scope", "refKey");

-- CreateIndex
CREATE INDEX "TrainingAnalysis_deliveredWithPlanId_idx" ON "TrainingAnalysis"("deliveredWithPlanId");

-- CreateIndex
CREATE INDEX "TrainingAnalysis_userId_periodEnd_idx" ON "TrainingAnalysis"("userId", "periodEnd");
