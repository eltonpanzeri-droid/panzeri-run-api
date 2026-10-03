-- Primeira camada canonica de serie temporal (03/10/2026) — aditiva, derivada de RawActivitySample
-- (que permanece intocado). Uma linha por (atividade, offset em segundos), nao por metrica; colunas
-- ficam null quando aquele offset nao teve leitura daquela metrica. Ver comentario do model em
-- schema.prisma para a justificativa completa.
CREATE TABLE "ActivityTimeSeriesPoint" (
    "id" TEXT NOT NULL,
    "activityLogId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "offsetSec" DOUBLE PRECISION NOT NULL,
    "heartRateBpm" INTEGER,
    "speedKmh" DOUBLE PRECISION,
    "distanceMeters" DOUBLE PRECISION,
    "cadenceSpm" INTEGER,
    "normalizationVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivityTimeSeriesPoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActivityTimeSeriesPoint_activityLogId_idx" ON "ActivityTimeSeriesPoint"("activityLogId");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityTimeSeriesPoint_activityLogId_offsetSec_normalizat_key" ON "ActivityTimeSeriesPoint"("activityLogId", "offsetSec", "normalizationVersion");

-- AddForeignKey
ALTER TABLE "ActivityTimeSeriesPoint" ADD CONSTRAINT "ActivityTimeSeriesPoint_activityLogId_fkey" FOREIGN KEY ("activityLogId") REFERENCES "ActivityLog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
