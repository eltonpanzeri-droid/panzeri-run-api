-- AddColumn
ALTER TABLE "User" ADD COLUMN "generationWeekStart" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "generationAttemptsUsed" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "generationExtraAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "lastGenerationAttemptAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "generationExhaustedAlertSent" BOOLEAN NOT NULL DEFAULT false;
