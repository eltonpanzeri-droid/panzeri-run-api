-- Garmin (09/11/2026): temperatura do ar por amostra. Coluna nova e vazia; nada existente muda.
-- Rollback: ALTER TABLE "ActivityTimeSeriesPoint" DROP COLUMN "temperatureCelsius";
ALTER TABLE "ActivityTimeSeriesPoint" ADD COLUMN "temperatureCelsius" DOUBLE PRECISION;
