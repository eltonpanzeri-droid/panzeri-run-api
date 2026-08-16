-- CreateSequence
CREATE SEQUENCE "TrainingPlan_planCode_seq";

-- AddColumn (nullable at first, backfilled below in creation order)
ALTER TABLE "TrainingPlan" ADD COLUMN "planCode" INTEGER;

-- Backfill existing plans in creation order (oldest = 1) -- cada prescricao ja gerada ganha um
-- numero de controle retroativo, mesmo criterio usado pra studentCode.
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt" ASC) AS rn
  FROM "TrainingPlan"
)
UPDATE "TrainingPlan" p SET "planCode" = ordered.rn
FROM ordered
WHERE p.id = ordered.id;

-- Continue the sequence right after the highest backfilled value
SELECT setval('"TrainingPlan_planCode_seq"', COALESCE((SELECT MAX("planCode") FROM "TrainingPlan"), 0) + 1, false);

-- Attach the sequence as the column default, then enforce NOT NULL + UNIQUE
ALTER TABLE "TrainingPlan" ALTER COLUMN "planCode" SET DEFAULT nextval('"TrainingPlan_planCode_seq"');
ALTER TABLE "TrainingPlan" ALTER COLUMN "planCode" SET NOT NULL;
ALTER TABLE "TrainingPlan" ADD CONSTRAINT "TrainingPlan_planCode_key" UNIQUE ("planCode");
ALTER SEQUENCE "TrainingPlan_planCode_seq" OWNED BY "TrainingPlan"."planCode";
