-- Exclusao de atividade (ignorar/excluir) pela aluna ou treinador (01/11/2026). Aditivo: 5 colunas nulas em ActivityLog; nada existente e' alterado. Rollback: DROP COLUMN das 5 colunas (sem perda de dado anterior).
-- AlterTable
ALTER TABLE "ActivityLog" ADD COLUMN     "excludedAt" TIMESTAMP(3),
ADD COLUMN     "excludedBy" TEXT,
ADD COLUMN     "excludedById" TEXT,
ADD COLUMN     "exclusionMode" TEXT,
ADD COLUMN     "exclusionReason" TEXT;

