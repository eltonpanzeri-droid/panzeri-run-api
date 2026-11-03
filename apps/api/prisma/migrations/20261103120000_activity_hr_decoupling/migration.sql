-- Desacoplamento da frequencia cardiaca (03/11/2026). Aditivo: tabela nova derivada da serie temporal; nenhuma tabela existente e' alterada. Rollback: DROP TABLE "ActivityHrDecoupling".
-- CreateTable
CREATE TABLE "ActivityHrDecoupling" (
    "id" TEXT NOT NULL,
    "activityLogId" TEXT NOT NULL,
    "algorithmVersion" INTEGER NOT NULL,
    "pointCount" INTEGER NOT NULL,
    "eligible" BOOLEAN NOT NULL,
    "exclusionReason" TEXT,
    "category" TEXT,
    "analyzedStartSec" DOUBLE PRECISION,
    "analyzedEndSec" DOUBLE PRECISION,
    "movingSec" DOUBLE PRECISION,
    "meanSpeed1" DOUBLE PRECISION,
    "meanSpeed2" DOUBLE PRECISION,
    "meanHr1" DOUBLE PRECISION,
    "meanHr2" DOUBLE PRECISION,
    "r1" DOUBLE PRECISION,
    "r2" DOUBLE PRECISION,
    "decouplingPct" DOUBLE PRECISION,
    "speedCvPct" DOUBLE PRECISION,
    "halfDiffPct" DOUBLE PRECISION,
    "coverageHr1" DOUBLE PRECISION,
    "coverageHr2" DOUBLE PRECISION,
    "coverageSpeed1" DOUBLE PRECISION,
    "coverageSpeed2" DOUBLE PRECISION,
    "validHrSamples" INTEGER NOT NULL,
    "validSpeedSamples" INTEGER NOT NULL,
    "discardedHrSamples" INTEGER NOT NULL,
    "discardedSpeedSamples" INTEGER NOT NULL,
    "gapCount" INTEGER NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivityHrDecoupling_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActivityHrDecoupling_activityLogId_idx" ON "ActivityHrDecoupling"("activityLogId");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityHrDecoupling_activityLogId_algorithmVersion_key" ON "ActivityHrDecoupling"("activityLogId", "algorithmVersion");

-- AddForeignKey
ALTER TABLE "ActivityHrDecoupling" ADD CONSTRAINT "ActivityHrDecoupling_activityLogId_fkey" FOREIGN KEY ("activityLogId") REFERENCES "ActivityLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
