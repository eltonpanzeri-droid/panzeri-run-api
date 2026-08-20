-- Satisfacao em 4 dimensoes (19/08): elaboracao, fazer (ja existia como "satisfaction"),
-- capacidade (como conseguiu fazer) e carga (adequacao do esforco).
ALTER TABLE "WorkoutCompletion" ADD COLUMN "satisfactionElaboracao" TEXT;
ALTER TABLE "WorkoutCompletion" ADD COLUMN "satisfactionCapacidade" TEXT;
ALTER TABLE "WorkoutCompletion" ADD COLUMN "satisfactionCarga" TEXT;
