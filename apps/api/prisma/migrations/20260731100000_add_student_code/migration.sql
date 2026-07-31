-- CreateSequence
CREATE SEQUENCE "User_studentCode_seq";

-- AddColumn (nullable at first, backfilled below in signup order)
ALTER TABLE "User" ADD COLUMN "studentCode" INTEGER;

-- Backfill existing users in signup order (oldest = 1)
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt" ASC) AS rn
  FROM "User"
)
UPDATE "User" u SET "studentCode" = ordered.rn
FROM ordered
WHERE u.id = ordered.id;

-- Continue the sequence right after the highest backfilled value
SELECT setval('"User_studentCode_seq"', COALESCE((SELECT MAX("studentCode") FROM "User"), 0) + 1, false);

-- Attach the sequence as the column default, then enforce NOT NULL + UNIQUE
ALTER TABLE "User" ALTER COLUMN "studentCode" SET DEFAULT nextval('"User_studentCode_seq"');
ALTER TABLE "User" ALTER COLUMN "studentCode" SET NOT NULL;
ALTER TABLE "User" ADD CONSTRAINT "User_studentCode_key" UNIQUE ("studentCode");
ALTER SEQUENCE "User_studentCode_seq" OWNED BY "User"."studentCode";
