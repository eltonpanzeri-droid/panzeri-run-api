-- CreateTable
CREATE TABLE "StravaAnalysisCache" (
    "userId" TEXT NOT NULL,
    "lastActivityId" TEXT NOT NULL,
    "analysis" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StravaAnalysisCache_pkey" PRIMARY KEY ("userId")
);
