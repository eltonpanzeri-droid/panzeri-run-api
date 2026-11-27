-- Escala unica de dor 1-10 no feedback do treino (28/11/2026). Coluna ADITIVA e opcional: o painFlag antigo continua e e derivado da nota.
ALTER TABLE "WorkoutCompletion" ADD COLUMN "painIntensity" INTEGER;
