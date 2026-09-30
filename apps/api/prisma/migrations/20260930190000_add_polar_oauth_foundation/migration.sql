CREATE TABLE "PolarOAuthAttempt" (
    "stateHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PolarOAuthAttempt_pkey" PRIMARY KEY ("stateHash")
);
CREATE INDEX "PolarOAuthAttempt_userId_idx" ON "PolarOAuthAttempt"("userId");
CREATE INDEX "PolarOAuthAttempt_expiresAt_idx" ON "PolarOAuthAttempt"("expiresAt");

CREATE TABLE "PolarConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "polarUserId" TEXT NOT NULL,
    "accessTokenEncrypted" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PolarConnection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PolarConnection_userId_key" ON "PolarConnection"("userId");
CREATE UNIQUE INDEX "PolarConnection_polarUserId_key" ON "PolarConnection"("polarUserId");