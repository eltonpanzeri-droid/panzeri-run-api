-- Escolha da aluna sobre qual observacao vale quando ha gravacao do proprio Panzeri Run (21/11/2026). Coluna nova, nula, sem efeito nos dados existentes.
ALTER TABLE "ActivityLog" ADD COLUMN "studentCanonicalChoiceAt" TIMESTAMP(3);
