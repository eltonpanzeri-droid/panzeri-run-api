-- AlterTable
ALTER TABLE "StravaAnalysisCache"
  ALTER COLUMN "lastActivityId" DROP NOT NULL,
  ALTER COLUMN "analysis" DROP NOT NULL,
  ADD COLUMN "customFrequencyDays" INTEGER;
