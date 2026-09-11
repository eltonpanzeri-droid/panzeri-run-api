-- Feedback pos-treino v2 (11/09/2026)
-- Adiciona variaveis de estado pre-treino (sono, cansaco, estresse, motivacao),
-- sensacao ao terminar, timing de dor e versionamento do questionario.
-- Campos historicos (satisfaction, satisfactionCarga, satisfactionElaboracao,
-- satisfactionCapacidade) sao preservados intactos para preservar historico.
ALTER TABLE "WorkoutCompletion"
  ADD COLUMN "preSleepQuality"    INTEGER,
  ADD COLUMN "prePhysicalFatigue" INTEGER,
  ADD COLUMN "preStressLevel"     INTEGER,
  ADD COLUMN "preMotivation"      INTEGER,
  ADD COLUMN "postWorkoutFeeling" INTEGER,
  ADD COLUMN "painTiming"         TEXT,
  ADD COLUMN "feedbackVersion"    INTEGER NOT NULL DEFAULT 1;
