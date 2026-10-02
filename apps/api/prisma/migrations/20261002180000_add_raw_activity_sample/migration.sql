-- Ingestao de samples (02/10/2026): tabela aditiva, generica por provider/tipo de amostra — nunca
-- uma tabela por metrica (ver comentario do model em schema.prisma). Nenhuma coluna existente de
-- ActivityLog e alterada; falha nesta tabela nunca compromete o resumo ja importado.
CREATE TABLE "RawActivitySample" (
    "id" TEXT NOT NULL,
    "activityLogId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "sampleType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "providerMeta" JSONB,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RawActivitySample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RawActivitySample_activityLogId_idx" ON "RawActivitySample"("activityLogId");

-- CreateIndex
CREATE UNIQUE INDEX "RawActivitySample_activityLogId_provider_sampleType_key" ON "RawActivitySample"("activityLogId", "provider", "sampleType");

-- AddForeignKey
ALTER TABLE "RawActivitySample" ADD CONSTRAINT "RawActivitySample_activityLogId_fkey" FOREIGN KEY ("activityLogId") REFERENCES "ActivityLog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
