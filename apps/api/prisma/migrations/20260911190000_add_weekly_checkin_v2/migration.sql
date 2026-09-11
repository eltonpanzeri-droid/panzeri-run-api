-- 11/09: Check-in semanal expandido de 3 para 15 perguntas (v2).
-- As 3 colunas originais (elaborationSatisfaction, adherenceSatisfaction, nextWeekMotivation)
-- ficam nullable para nao quebrar registros antigos (v1). Novos campos adicionados nullable.
-- Sentinel de "pulou" em v1: elaborationSatisfaction===0.
-- Sentinel de "pulou" em v2: checkinSkipped=true.

ALTER TABLE "WeeklyCheckIn" ALTER COLUMN "elaborationSatisfaction" DROP NOT NULL;
ALTER TABLE "WeeklyCheckIn" ALTER COLUMN "adherenceSatisfaction" DROP NOT NULL;
ALTER TABLE "WeeklyCheckIn" ALTER COLUMN "nextWeekMotivation" DROP NOT NULL;

-- V2 Bloco 1: Como foi sua semana
ALTER TABLE "WeeklyCheckIn" ADD COLUMN "prescriptionLiking" INTEGER;
ALTER TABLE "WeeklyCheckIn" ADD COLUMN "prescriptionSuitability" INTEGER;
ALTER TABLE "WeeklyCheckIn" ADD COLUMN "perceivedExecution" INTEGER;
ALTER TABLE "WeeklyCheckIn" ADD COLUMN "executionSatisfaction" INTEGER;
ALTER TABLE "WeeklyCheckIn" ADD COLUMN "postWeekMotivation" INTEGER;

-- V2 Bloco 2: Como voce esta
ALTER TABLE "WeeklyCheckIn" ADD COLUMN "weeklySleep" INTEGER;
ALTER TABLE "WeeklyCheckIn" ADD COLUMN "currentPhysicalFatigue" INTEGER;
ALTER TABLE "WeeklyCheckIn" ADD COLUMN "weeklyStress" INTEGER;
ALTER TABLE "WeeklyCheckIn" ADD COLUMN "routineInterference" INTEGER;
ALTER TABLE "WeeklyCheckIn" ADD COLUMN "bodyResponseVsNormal" INTEGER;

-- V2 Bloco 3: Proxima semana
ALTER TABLE "WeeklyCheckIn" ADD COLUMN "nextWeekConfidence" INTEGER;
ALTER TABLE "WeeklyCheckIn" ADD COLUMN "expectedScheduleFeasibility" INTEGER;
ALTER TABLE "WeeklyCheckIn" ADD COLUMN "expectedPhysicalState" INTEGER;
ALTER TABLE "WeeklyCheckIn" ADD COLUMN "preferredNextWeekTraining" TEXT;

-- Meta
ALTER TABLE "WeeklyCheckIn" ADD COLUMN "checkinVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "WeeklyCheckIn" ADD COLUMN "checkinSkipped" BOOLEAN NOT NULL DEFAULT false;
