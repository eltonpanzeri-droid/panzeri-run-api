-- 19/10/2026 — Central Universal, consentimento aplicavel. Migration ADITIVA: 3 colunas NULAVEIS (ProviderConnection.consentTextHash, ProviderConnection.grantedPurposes,
-- ProviderInboundEvent.category). Nenhuma linha existente e' alterada (as tabelas estavam vazias em producao na verificacao de 19/10).
-- Reversao: ALTER TABLE ... DROP COLUMN das tres colunas.

-- AlterTable
ALTER TABLE "ProviderInboundEvent" ADD COLUMN     "category" TEXT;

-- AlterTable
ALTER TABLE "ProviderConnection" ADD COLUMN     "consentTextHash" TEXT,
ADD COLUMN     "grantedPurposes" JSONB;

