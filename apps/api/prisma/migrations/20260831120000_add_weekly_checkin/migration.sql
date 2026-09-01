-- CreateTable
CREATE TABLE "WeeklyCheckIn" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT,
    "weekStartDate" TIMESTAMP(3) NOT NULL,
    "asPrescribedSessions" INTEGER NOT NULL,
    "changedModalitySessions" INTEGER NOT NULL,
    "differentSessions" INTEGER NOT NULL,
    "missedSessions" INTEGER NOT NULL,
    "elaborationSatisfaction" INTEGER NOT NULL,
    "adherenceSatisfaction" INTEGER NOT NULL,
    "nextWeekMotivation" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklyCheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WeeklyCheckIn_userId_createdAt_idx" ON "WeeklyCheckIn"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyCheckIn_userId_planId_key" ON "WeeklyCheckIn"("userId", "planId");

-- AddForeignKey
ALTER TABLE "WeeklyCheckIn" ADD CONSTRAINT "WeeklyCheckIn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyCheckIn" ADD CONSTRAINT "WeeklyCheckIn_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TrainingPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
