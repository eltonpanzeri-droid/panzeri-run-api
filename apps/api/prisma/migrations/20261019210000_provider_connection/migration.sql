-- 19/10/2026 — Central Universal de Integracoes, Passo 2. Migration ADITIVA: 2 tabelas novas (conexao generica por provedor e tentativas OAuth de uso unico) e indices.
-- Nenhuma tabela existente e' tocada; nenhuma linha e' alterada. Reversao: DROP TABLE "ProviderConnection"; DROP TABLE "ProviderOAuthAttempt"; (so' guardam conexoes dos provedores novos).

-- CreateTable
CREATE TABLE "ProviderOAuthAttempt" (
    "stateHash" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "consent" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderOAuthAttempt_pkey" PRIMARY KEY ("stateHash")
);

-- CreateTable
CREATE TABLE "ProviderConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "accessTokenEncrypted" TEXT,
    "refreshTokenEncrypted" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "grantedCategories" JSONB NOT NULL,
    "consentVersion" TEXT NOT NULL,
    "consentedAt" TIMESTAMP(3) NOT NULL,
    "refreshLockUntil" TIMESTAMP(3),
    "collectFrom" TIMESTAMP(3),
    "lastSyncCompletedAt" TIMESTAMP(3),
    "disconnectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProviderOAuthAttempt_userId_idx" ON "ProviderOAuthAttempt"("userId");

-- CreateIndex
CREATE INDEX "ProviderOAuthAttempt_expiresAt_idx" ON "ProviderOAuthAttempt"("expiresAt");

-- CreateIndex
CREATE INDEX "ProviderConnection_userId_idx" ON "ProviderConnection"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderConnection_provider_userId_key" ON "ProviderConnection"("provider", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderConnection_provider_externalAccountId_key" ON "ProviderConnection"("provider", "externalAccountId");

