-- AlterTable
ALTER TABLE "StravaActivity" ADD COLUMN "elapsedTimeSec" INTEGER;
ALTER TABLE "StravaActivity" ADD COLUMN "elevationGainM" DOUBLE PRECISION;

-- Backfill a partir do JSON bruto ja guardado (raw), pra nao perder historico existente.
UPDATE "StravaActivity"
SET
  "elapsedTimeSec" = NULLIF((raw->>'elapsed_time'), '')::INTEGER,
  "elevationGainM" = NULLIF((raw->>'total_elevation_gain'), '')::DOUBLE PRECISION
WHERE raw IS NOT NULL;
