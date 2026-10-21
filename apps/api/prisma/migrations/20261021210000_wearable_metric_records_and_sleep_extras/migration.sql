-- AlterTable
ALTER TABLE "WearableSleepSummary" ADD COLUMN     "respirationOffsetSec" INTEGER,
ADD COLUMN     "sleepScores" JSONB,
ADD COLUMN     "spo2OffsetSec" INTEGER;

-- CreateTable
CREATE TABLE "WearableMetricRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "metricKind" TEXT NOT NULL,
    "calendarDate" TEXT,
    "startTimeSec" INTEGER NOT NULL,
    "startOffsetSec" INTEGER,
    "providerSummaryId" TEXT,
    "identityKey" TEXT NOT NULL,
    "values" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WearableMetricRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WearableMetricRecord_userId_metricKind_startTimeSec_idx" ON "WearableMetricRecord"("userId", "metricKind", "startTimeSec");

-- CreateIndex
CREATE UNIQUE INDEX "WearableMetricRecord_userId_provider_metricKind_identityKey_key" ON "WearableMetricRecord"("userId", "provider", "metricKind", "identityKey");

