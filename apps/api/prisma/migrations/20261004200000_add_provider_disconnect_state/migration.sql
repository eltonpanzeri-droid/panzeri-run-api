-- Estado de desconexao/revogacao de provider (Polar) e trilha de auditoria generica.
-- Aditiva: linhas existentes ficam com disconnectedAt NULL (= conexao ativa, comportamento atual).
ALTER TABLE "PolarConnection" ALTER COLUMN "accessTokenEncrypted" DROP NOT NULL;
ALTER TABLE "PolarConnection" ADD COLUMN "disconnectedAt" TIMESTAMP(3);

CREATE TABLE "ProviderConnectionEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProviderConnectionEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProviderConnectionEvent_userId_provider_idx" ON "ProviderConnectionEvent"("userId", "provider");
