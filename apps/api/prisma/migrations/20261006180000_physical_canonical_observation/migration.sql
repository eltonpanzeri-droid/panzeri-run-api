-- Apple Etapa 3A: observacao canonica por evento fisico + ecossistema primario do atleta por periodo.
-- Somente ADICIONA: 2 colunas anulaveis em "ActivityLog" e 1 tabela nova. Nenhum registro existente e alterado ou apagado.
ALTER TABLE "ActivityLog" ADD COLUMN "physicalCanonicalActivityLogId" TEXT;
ALTER TABLE "ActivityLog" ADD COLUMN "physicalCanonicalReason" JSONB;

CREATE TABLE "AthletePrimarySource" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "origin" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AthletePrimarySource_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AthletePrimarySource_userId_effectiveFrom_idx" ON "AthletePrimarySource"("userId", "effectiveFrom");
