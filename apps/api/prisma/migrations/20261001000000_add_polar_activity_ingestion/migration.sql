-- AlterTable: estado de registro AccessLink e retomada de sincronizacao Polar.
-- Aditivo e nao destrutivo: todas as colunas novas sao nullable, sem default que reescreva dado
-- existente. Linhas ja existentes de PolarConnection ficam com registeredAt/openTransactionId/
-- lastSyncCompletedAt = NULL, o que e semanticamente correto (nenhuma delas foi registrada ou
-- sincronizada na AccessLink ainda, porque esse fluxo nao existia antes desta migration).
ALTER TABLE "PolarConnection" ADD COLUMN     "registeredAt" TIMESTAMP(3);
ALTER TABLE "PolarConnection" ADD COLUMN     "openTransactionId" TEXT;
ALTER TABLE "PolarConnection" ADD COLUMN     "openTransactionOpenedAt" TIMESTAMP(3);
ALTER TABLE "PolarConnection" ADD COLUMN     "lastSyncCompletedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "RawExternalActivity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadSchemaVersion" TEXT,
    "ingestionMeta" JSONB,
    "sourceUpdatedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RawExternalActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "rawActivityId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "utcOffsetMinutes" INTEGER,
    "durationSec" INTEGER,
    "distanceMeters" DOUBLE PRECISION,
    "sport" TEXT,
    "caloriesKcal" INTEGER,
    "avgHeartRateBpm" INTEGER,
    "maxHeartRateBpm" INTEGER,
    "cadenceAvg" INTEGER,
    "powerAvgWatts" INTEGER,
    "elevationGainMeters" DOUBLE PRECISION,
    "hasRoute" BOOLEAN,
    "detailFetchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RawExternalActivity_userId_idx" ON "RawExternalActivity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RawExternalActivity_provider_userId_externalId_key" ON "RawExternalActivity"("provider", "userId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityLog_rawActivityId_key" ON "ActivityLog"("rawActivityId");

-- CreateIndex
CREATE INDEX "ActivityLog_userId_startedAt_idx" ON "ActivityLog"("userId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityLog_provider_userId_externalId_key" ON "ActivityLog"("provider", "userId", "externalId");

-- AddForeignKey
ALTER TABLE "RawExternalActivity" ADD CONSTRAINT "RawExternalActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_rawActivityId_fkey" FOREIGN KEY ("rawActivityId") REFERENCES "RawExternalActivity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
