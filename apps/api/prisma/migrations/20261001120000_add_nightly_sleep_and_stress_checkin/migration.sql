-- CreateTable: uma noite de sono por aluno, reutilizada entre sessoes do mesmo dia.
CREATE TABLE "NightlySleepLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nightDate" TIMESTAMP(3) NOT NULL,
    "sleepQuality" INTEGER,
    "sleepDurationCategory" TEXT,
    "sleepDurationHoursEstimate" DOUBLE PRECISION,
    "bedtimeShiftDirection" TEXT,
    "wakeTimeShiftDirection" TEXT,
    "sleepInterruption" INTEGER,
    "sleepDifficulty" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NightlySleepLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable: estresse das ultimas 24h, timestamp real, janela movel.
CREATE TABLE "StressCheckin" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "respondedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stressLevel" INTEGER,
    "stressEventFrequency" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StressCheckin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NightlySleepLog_userId_nightDate_key" ON "NightlySleepLog"("userId", "nightDate");

-- CreateIndex
CREATE INDEX "StressCheckin_userId_respondedAt_idx" ON "StressCheckin"("userId", "respondedAt");

-- AddForeignKey
ALTER TABLE "NightlySleepLog" ADD CONSTRAINT "NightlySleepLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StressCheckin" ADD CONSTRAINT "StressCheckin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: colunas de vinculo aditivas e nullable em WorkoutCompletion. Linhas existentes ficam
-- NULL (correto: nenhum completion anterior a esta migration pertence a uma noite/checkin
-- compartilhado — continuam lidos pelas colunas proprias, sem reinterpretacao retroativa).
ALTER TABLE "WorkoutCompletion" ADD COLUMN     "nightlySleepLogId" TEXT;
ALTER TABLE "WorkoutCompletion" ADD COLUMN     "stressCheckinId" TEXT;

-- AddForeignKey
ALTER TABLE "WorkoutCompletion" ADD CONSTRAINT "WorkoutCompletion_nightlySleepLogId_fkey" FOREIGN KEY ("nightlySleepLogId") REFERENCES "NightlySleepLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutCompletion" ADD CONSTRAINT "WorkoutCompletion_stressCheckinId_fkey" FOREIGN KEY ("stressCheckinId") REFERENCES "StressCheckin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
