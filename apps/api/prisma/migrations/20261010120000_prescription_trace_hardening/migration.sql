-- Endurecimento da rastreabilidade (correcoes da revisao do Astra, 10/10/2026). Migration ADITIVA: so adiciona colunas anulaveis; nada e removido,
-- reescrito ou preenchido retroativamente. Pacotes ja existentes ficam com sourceProviders = NULL (proveniencia desconhecida => tratada de forma conservadora).

-- AlterTable
ALTER TABLE "PrescriptionEvidencePackage" ADD COLUMN "sourceProviders" JSONB,
                                          ADD COLUMN "agentInputRedactions" JSONB;

-- AlterTable
ALTER TABLE "PrescriptionDecision" ADD COLUMN "sessionSnapshot" JSONB,
                                  ADD COLUMN "sessionSnapshotSha256" TEXT;
