-- AlterTable: colunas aditivas e nullable em ActivityLog, sem reescrever dado existente. Linhas ja
-- importadas ficam com executionClassification/executionClassifiedAt = NULL ("nao processado
-- ainda"), que e' o estado correto ate' o SessionExecutionLinkService classificar cada uma.
ALTER TABLE "ActivityLog" ADD COLUMN     "executionClassification" TEXT;
ALTER TABLE "ActivityLog" ADD COLUMN     "executionClassifiedAt" TIMESTAMP(3);
ALTER TABLE "ActivityLog" ADD COLUMN     "executionClassifiedBy" TEXT;

-- CreateTable
CREATE TABLE "SessionExecutionLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "trainingSessionId" TEXT NOT NULL,
    "activityLogId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "confidence" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "supersededByLinkId" TEXT,

    CONSTRAINT "SessionExecutionLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SessionExecutionLink_supersededByLinkId_key" ON "SessionExecutionLink"("supersededByLinkId");

-- CreateIndex
CREATE INDEX "SessionExecutionLink_trainingSessionId_idx" ON "SessionExecutionLink"("trainingSessionId");

-- CreateIndex
CREATE INDEX "SessionExecutionLink_activityLogId_idx" ON "SessionExecutionLink"("activityLogId");

-- CreateIndex
CREATE INDEX "SessionExecutionLink_userId_idx" ON "SessionExecutionLink"("userId");

-- Indice parcial (Prisma nao expressa isso no schema.prisma, so' SQL puro): no maximo UM link
-- ATIVO por par (trainingSessionId, activityLogId). Nao impede N linhas historicas revogadas pro
-- mesmo par (correcao -> correcao de volta), so' impede duas linhas ativas simultaneas redundantes
-- pro mesmo par exato. Multiplos pares diferentes (1 sessao com N atividades, ou 1 atividade
-- futuramente com N sessoes se algum dia justificavel) continuam permitidos.
CREATE UNIQUE INDEX "SessionExecutionLink_active_pair_key" ON "SessionExecutionLink"("trainingSessionId", "activityLogId") WHERE "status" = 'active';

-- AddForeignKey
ALTER TABLE "SessionExecutionLink" ADD CONSTRAINT "SessionExecutionLink_trainingSessionId_fkey" FOREIGN KEY ("trainingSessionId") REFERENCES "TrainingSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionExecutionLink" ADD CONSTRAINT "SessionExecutionLink_activityLogId_fkey" FOREIGN KEY ("activityLogId") REFERENCES "ActivityLog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionExecutionLink" ADD CONSTRAINT "SessionExecutionLink_supersededByLinkId_fkey" FOREIGN KEY ("supersededByLinkId") REFERENCES "SessionExecutionLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;
