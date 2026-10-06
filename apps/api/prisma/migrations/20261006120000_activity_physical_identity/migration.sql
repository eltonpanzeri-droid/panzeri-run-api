-- Identidade fisica cross-provider (Apple Etapa 2). Somente ADICIONA colunas anulaveis e um indice: nenhum registro e
-- alterado, apagado ou fundido. O historico anterior fica com tudo NULL (= nunca avaliado).
ALTER TABLE "ActivityLog" ADD COLUMN "physicalEventId" TEXT;
ALTER TABLE "ActivityLog" ADD COLUMN "physicalIdentityStatus" TEXT;
ALTER TABLE "ActivityLog" ADD COLUMN "physicalIdentityEvidence" JSONB;
ALTER TABLE "ActivityLog" ADD COLUMN "physicalIdentityEvaluatedAt" TIMESTAMP(3);

CREATE INDEX "ActivityLog_physicalEventId_idx" ON "ActivityLog"("physicalEventId");
