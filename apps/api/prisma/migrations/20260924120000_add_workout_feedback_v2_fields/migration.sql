-- Reestruturacao do feedback individual de treino (24/09/2026) — feedbackVersion 2.
-- Todas as colunas novas, nullable, zero impacto em dados existentes. Nenhuma coluna da v1
-- (preSleepQuality, prePhysicalFatigue, preStressLevel, preMotivation, postWorkoutFeeling,
-- satisfactionCapacidade, etc.) e' removida ou alterada — permanecem intactas para historico.
ALTER TABLE "WorkoutCompletion"
  ADD COLUMN "sleepDurationCategory"      TEXT,
  ADD COLUMN "sleepDurationHoursEstimate" DOUBLE PRECISION,
  ADD COLUMN "sleepScheduleIrregularity"  INTEGER,
  ADD COLUMN "sleepInterruption"          INTEGER,
  ADD COLUMN "sleepDifficulty"            INTEGER,
  ADD COLUMN "preMentalFatigue"           INTEGER,
  ADD COLUMN "executionVsPrescribed"      INTEGER,
  ADD COLUMN "postPhysicalFatigue"        INTEGER,
  ADD COLUMN "postMentalFatigue"          INTEGER,
  ADD COLUMN "emotionalExperienceDuring"  INTEGER,
  ADD COLUMN "mentalStateChangePrePost"   INTEGER;
