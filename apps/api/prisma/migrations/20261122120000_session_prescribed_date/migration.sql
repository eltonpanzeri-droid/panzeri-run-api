-- 22/11/2026: dia prescrito original do treino quando a data realizada passa a prevalecer (vinculo de atividade feita em outro dia).
-- Rollback: ALTER TABLE "TrainingSession" DROP COLUMN "prescribedDate";
ALTER TABLE "TrainingSession" ADD COLUMN "prescribedDate" TIMESTAMP(3);
