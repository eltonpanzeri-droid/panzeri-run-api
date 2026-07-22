-- AlterTable
ALTER TABLE "WorkoutCompletion" ADD COLUMN "painFlag" TEXT;

-- CreateTable
CREATE TABLE "TargetRace" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "raceDate" TIMESTAMP(3) NOT NULL,
    "distanceKm" DOUBLE PRECISION NOT NULL,
    "targetSeconds" INTEGER,
    "priority" TEXT NOT NULL DEFAULT 'principal',
    "status" TEXT NOT NULL DEFAULT 'em_andamento',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TargetRace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PainReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "regions" TEXT[],
    "regionDetails" JSONB,
    "otherLocation" TEXT,
    "intensity" INTEGER NOT NULL,
    "onsetPattern" TEXT NOT NULL,
    "persistencePattern" TEXT NOT NULL,
    "previousPainStatus" TEXT,
    "resolvedRegions" TEXT[],
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PainReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TargetRace_userId_status_idx" ON "TargetRace"("userId", "status");

-- CreateIndex
CREATE INDEX "PainReport_userId_createdAt_idx" ON "PainReport"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "TargetRace" ADD CONSTRAINT "TargetRace_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PainReport" ADD CONSTRAINT "PainReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
