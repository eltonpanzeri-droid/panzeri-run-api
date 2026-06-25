CREATE TABLE "TrainingExecutionInsight" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "summary" JSONB NOT NULL,
  "items" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TrainingExecutionInsight_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TrainingExecutionInsight_planId_key" ON "TrainingExecutionInsight"("planId");
CREATE INDEX "TrainingExecutionInsight_userId_idx" ON "TrainingExecutionInsight"("userId");
