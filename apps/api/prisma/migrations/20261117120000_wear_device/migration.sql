-- Relogio Wear OS pareado por codigo (17/11/2026, fase 1). Tabela nova e aditiva: nada existente muda.
CREATE TABLE "WearDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "deviceName" TEXT,
    "platform" TEXT NOT NULL DEFAULT 'wear_os',
    "pairingCodeHash" TEXT,
    "pollSecretHash" TEXT,
    "pairingExpiresAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "tokenHash" TEXT,
    "tokenIssuedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WearDevice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WearDevice_pairingCodeHash_key" ON "WearDevice"("pairingCodeHash");
CREATE UNIQUE INDEX "WearDevice_tokenHash_key" ON "WearDevice"("tokenHash");
CREATE INDEX "WearDevice_userId_idx" ON "WearDevice"("userId");

ALTER TABLE "WearDevice" ADD CONSTRAINT "WearDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
