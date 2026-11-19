-- AlterTable
ALTER TABLE "MenstrualDailyLog" ADD COLUMN     "notes" TEXT,
ADD COLUMN     "symptoms" JSONB;

-- CreateTable
CREATE TABLE "MenstrualReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "monthKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "narrative" TEXT,
    "agentStatus" TEXT NOT NULL DEFAULT 'skipped',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MenstrualReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenstrualHistorySummary" (
    "userId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "chars" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenstrualHistorySummary_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "MenstrualReport_userId_createdAt_idx" ON "MenstrualReport"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MenstrualReport_userId_monthKey_key" ON "MenstrualReport"("userId", "monthKey");

-- AddForeignKey
ALTER TABLE "MenstrualReport" ADD CONSTRAINT "MenstrualReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenstrualHistorySummary" ADD CONSTRAINT "MenstrualHistorySummary_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

