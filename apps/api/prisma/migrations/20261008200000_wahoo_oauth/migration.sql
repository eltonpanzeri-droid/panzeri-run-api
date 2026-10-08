-- Wahoo OAuth (08/10/2026, Etapa 3). Migration ADITIVA: so' cria tabelas novas; nenhuma tabela existente e' alterada.

CREATE TABLE "WahooOAuthAttempt" (
    "stateHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeVerifierEncrypted" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WahooOAuthAttempt_pkey" PRIMARY KEY ("stateHash")
);
CREATE INDEX "WahooOAuthAttempt_userId_idx" ON "WahooOAuthAttempt"("userId");
CREATE INDEX "WahooOAuthAttempt_expiresAt_idx" ON "WahooOAuthAttempt"("expiresAt");

CREATE TABLE "WahooConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "wahooUserId" TEXT NOT NULL,
    "accessTokenEncrypted" TEXT,
    "refreshTokenEncrypted" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "grantedScopes" TEXT NOT NULL,
    "refreshLockUntil" TIMESTAMP(3),
    "disconnectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WahooConnection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WahooConnection_userId_key" ON "WahooConnection"("userId");
CREATE UNIQUE INDEX "WahooConnection_wahooUserId_key" ON "WahooConnection"("wahooUserId");
