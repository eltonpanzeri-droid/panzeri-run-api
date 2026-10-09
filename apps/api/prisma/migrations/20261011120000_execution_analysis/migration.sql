-- Etapa 2.1 (11/10/2026): analise deterministica da execucao. Migration ADITIVA: 2 tabelas novas (indicadores derivados) e seus indices; nada existente muda.

-- CreateTable
CREATE TABLE "SessionExecutionAnalysis" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "trainingSessionId" TEXT NOT NULL,
    "activityLogId" TEXT,
    "provider" TEXT,
    "modality" TEXT NOT NULL,
    "scheduledDate" TIMESTAMP(3) NOT NULL,
    "algorithmVersion" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "sourceFingerprint" TEXT NOT NULL,
    "indicators" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionExecutionAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyExecutionReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekStartDate" TIMESTAMP(3) NOT NULL,
    "analyzedPlanId" TEXT,
    "deliveredWithPlanId" TEXT,
    "algorithmVersion" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "indicators" JSONB NOT NULL,
    "textLines" JSONB NOT NULL,
    "sources" JSONB NOT NULL,
    "invalidatedProviders" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklyExecutionReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SessionExecutionAnalysis_userId_scheduledDate_idx" ON "SessionExecutionAnalysis"("userId", "scheduledDate");

-- CreateIndex
CREATE INDEX "SessionExecutionAnalysis_activityLogId_idx" ON "SessionExecutionAnalysis"("activityLogId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionExecutionAnalysis_trainingSessionId_algorithmVersion_key" ON "SessionExecutionAnalysis"("trainingSessionId", "algorithmVersion");

-- CreateIndex
CREATE INDEX "WeeklyExecutionReport_userId_weekStartDate_idx" ON "WeeklyExecutionReport"("userId", "weekStartDate");

-- CreateIndex
CREATE INDEX "WeeklyExecutionReport_deliveredWithPlanId_idx" ON "WeeklyExecutionReport"("deliveredWithPlanId");
