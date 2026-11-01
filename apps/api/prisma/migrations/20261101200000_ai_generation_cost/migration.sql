-- Custo real de cada chamada de IA (01/11/2026). Aditivo: tabela nova; nenhuma tabela existente e' alterada. Rollback: DROP TABLE "AiGenerationCost".
-- CreateTable
CREATE TABLE "AiGenerationCost" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "agent" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "effort" TEXT,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheCreationTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(12,6) NOT NULL,
    "costWithoutCacheUsd" DECIMAL(12,6) NOT NULL,
    "inputUsd" DECIMAL(12,6) NOT NULL,
    "cacheWriteUsd" DECIMAL(12,6) NOT NULL,
    "cacheReadUsd" DECIMAL(12,6) NOT NULL,
    "outputUsd" DECIMAL(12,6) NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiGenerationCost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiGenerationCost_createdAt_idx" ON "AiGenerationCost"("createdAt");

-- CreateIndex
CREATE INDEX "AiGenerationCost_agent_createdAt_idx" ON "AiGenerationCost"("agent", "createdAt");

-- CreateIndex
CREATE INDEX "AiGenerationCost_userId_createdAt_idx" ON "AiGenerationCost"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "AiGenerationCost" ADD CONSTRAINT "AiGenerationCost_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

