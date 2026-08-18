-- Investigador de dor guiado (18/08): duas perguntas novas no relato de dor.
ALTER TABLE "PainReport" ADD COLUMN "worseningTrend" TEXT;
ALTER TABLE "PainReport" ADD COLUMN "dailyLifeImpact" TEXT;
