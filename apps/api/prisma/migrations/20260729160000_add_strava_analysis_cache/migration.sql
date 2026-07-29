-- CreateTable
CREATE TABLE "StravaAnalysisCache" (
    "userId" TEXT NOT NULL,
    "lastActivityId" TEXT,
    "analysis" JSONB,
    "customFrequencyDays" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StravaAnalysisCache_pkey" PRIMARY KEY ("userId")
);
