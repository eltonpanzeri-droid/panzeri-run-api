-- Desacoplamento da FC, algoritmo versao 2 (08/11/2026): colunas de qualidade e auditoria dos eventos transitorios de velocidade. Aditivo e nulo; nenhuma linha existente e' alterada.
-- Rollback: ALTER TABLE "ActivityHrDecoupling" DROP COLUMN "qualityStatus", DROP COLUMN "transientEventCount", DROP COLUMN "transientEventSec", DROP COLUMN "excludedSec", DROP COLUMN "excludedPct", DROP COLUMN "sustainedEventCount";
ALTER TABLE "ActivityHrDecoupling" ADD COLUMN "qualityStatus" TEXT,
ADD COLUMN "transientEventCount" INTEGER,
ADD COLUMN "transientEventSec" DOUBLE PRECISION,
ADD COLUMN "excludedSec" DOUBLE PRECISION,
ADD COLUMN "excludedPct" DOUBLE PRECISION,
ADD COLUMN "sustainedEventCount" INTEGER;
