-- Reestruturacao do check-in semanal (24/09/2026) — v3, 9 perguntas. Colunas novas, nullable,
-- zero impacto em dados existentes. Nenhuma coluna v1/v2 e' removida ou alterada.
ALTER TABLE "WeeklyCheckIn"
  ADD COLUMN "weekDemandVsNormal"          INTEGER,
  ADD COLUMN "expectedRoutineInterference" INTEGER,
  ADD COLUMN "freeTextObservation"         TEXT;
