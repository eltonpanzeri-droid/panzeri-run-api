-- CreateTable
CREATE TABLE "WearableSleepSummary" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "calendarDate" TEXT NOT NULL,
    "startTimeSec" INTEGER NOT NULL,
    "startOffsetSec" INTEGER NOT NULL,
    "durationSec" INTEGER,
    "deepSleepSec" INTEGER,
    "lightSleepSec" INTEGER,
    "remSleepSec" INTEGER,
    "awakeSec" INTEGER,
    "napTotalSec" INTEGER,
    "unmeasurableSec" INTEGER,
    "scoreValue" INTEGER,
    "scoreQualifier" TEXT,
    "validation" TEXT,
    "endTimeSec" INTEGER,
    "levels" JSONB,
    "naps" JSONB,
    "providerSummaryId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WearableSleepSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WearableDailySummary" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "calendarDate" TEXT NOT NULL,
    "startTimeSec" INTEGER NOT NULL,
    "startOffsetSec" INTEGER NOT NULL,
    "durationSec" INTEGER,
    "steps" INTEGER,
    "distanceMeters" DOUBLE PRECISION,
    "activeKilocalories" DOUBLE PRECISION,
    "restingHeartRateBpm" INTEGER,
    "stepsGoal" INTEGER,
    "providerSummaryId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WearableDailySummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WearableHrvSummary" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "calendarDate" TEXT NOT NULL,
    "startTimeSec" INTEGER NOT NULL,
    "startOffsetSec" INTEGER NOT NULL,
    "durationSec" INTEGER,
    "lastNightAvg" DOUBLE PRECISION NOT NULL,
    "hrvValues" JSONB,
    "providerSummaryId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WearableHrvSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WearableSleepSummary_userId_calendarDate_idx" ON "WearableSleepSummary"("userId", "calendarDate");

-- CreateIndex
CREATE UNIQUE INDEX "WearableSleepSummary_userId_provider_calendarDate_startTime_key" ON "WearableSleepSummary"("userId", "provider", "calendarDate", "startTimeSec");

-- CreateIndex
CREATE INDEX "WearableDailySummary_userId_calendarDate_idx" ON "WearableDailySummary"("userId", "calendarDate");

-- CreateIndex
CREATE UNIQUE INDEX "WearableDailySummary_userId_provider_calendarDate_startTime_key" ON "WearableDailySummary"("userId", "provider", "calendarDate", "startTimeSec");

-- CreateIndex
CREATE INDEX "WearableHrvSummary_userId_calendarDate_idx" ON "WearableHrvSummary"("userId", "calendarDate");

-- CreateIndex
CREATE UNIQUE INDEX "WearableHrvSummary_userId_provider_calendarDate_startTimeSe_key" ON "WearableHrvSummary"("userId", "provider", "calendarDate", "startTimeSec");

