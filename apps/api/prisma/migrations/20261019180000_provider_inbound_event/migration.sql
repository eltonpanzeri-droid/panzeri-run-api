-- 19/10/2026 — Central Universal de Integracoes, Passo 1. Migration ADITIVA: 1 tabela nova (fila de eventos de provedores novos) e 3 indices.
-- Nenhuma tabela existente e' tocada; nenhuma linha e' alterada. Reversao: DROP TABLE "ProviderInboundEvent" (so' contem fila de trabalho transitoria).

-- CreateTable
CREATE TABLE "ProviderInboundEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "userId" TEXT,
    "externalAccountId" TEXT,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "lastError" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderInboundEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProviderInboundEvent_status_nextAttemptAt_idx" ON "ProviderInboundEvent"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "ProviderInboundEvent_userId_idx" ON "ProviderInboundEvent"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderInboundEvent_provider_dedupeKey_key" ON "ProviderInboundEvent"("provider", "dedupeKey");

