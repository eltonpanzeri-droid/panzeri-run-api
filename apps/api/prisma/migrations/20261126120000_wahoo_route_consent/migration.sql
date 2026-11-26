-- Percurso GPS da Wahoo com autorizacao propria da aluna (26/11/2026). Colunas nulas e aditivas: nada muda para quem ja esta conectada.
-- Rollback: ALTER TABLE "WahooConnection" DROP COLUMN "routeConsentVersion", DROP COLUMN "routeConsentTextHash", DROP COLUMN "routeConsentedAt";
ALTER TABLE "WahooConnection" ADD COLUMN "routeConsentVersion" TEXT,
ADD COLUMN "routeConsentTextHash" TEXT,
ADD COLUMN "routeConsentedAt" TIMESTAMP(3);
