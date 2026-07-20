-- CreateTable
CREATE TABLE "Reassessment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "evolutionSummary" TEXT,
    "evolutionWins" JSONB,
    "evolutionConcerns" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reassessment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Reassessment_userId_createdAt_idx" ON "Reassessment"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "Reassessment" ADD CONSTRAINT "Reassessment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
