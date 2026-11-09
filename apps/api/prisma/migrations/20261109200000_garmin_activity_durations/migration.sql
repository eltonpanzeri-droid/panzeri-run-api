-- Garmin (09/11/2026): tempos acumulados por amostra (relogio, cronometro, em movimento). Colunas novas e vazias; nada existente muda.
-- Rollback: ALTER TABLE "ActivityTimeSeriesPoint" DROP COLUMN "timerDurationSec", DROP COLUMN "movingDurationSec", DROP COLUMN "clockDurationSec";
ALTER TABLE "ActivityTimeSeriesPoint" ADD COLUMN "timerDurationSec" INTEGER, ADD COLUMN "movingDurationSec" INTEGER, ADD COLUMN "clockDurationSec" INTEGER;
