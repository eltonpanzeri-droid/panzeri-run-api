-- 15/10/2026 — Correcao de atividades x medalhas x reavaliacao pendente. Migration ADITIVA: 4 colunas novas em "UserAchievement" (todas com padrao ou nulas),
-- 2 tabelas novas e indices. Nenhuma linha e' apagada nem tem valor existente alterado, EXCETO a conversao de estado das retracoes de volume antigas
-- (marcador evidence._volumeReconciliation.status = 'retracted' -> status 'revoked'); o marcador e' MANTIDO (compatibilidade com o codigo anterior e com
-- a CLI de reconciliacao de volume). A conversao e o historico correspondente sao idempotentes (reexecutar nao duplica nada).
-- Reversao: remover as colunas/tabelas novas; as concessoes e o marcador antigo continuam intactos.

-- AlterTable
ALTER TABLE "UserAchievement" ADD COLUMN     "revokedAt" TIMESTAMP(3),
ADD COLUMN     "revokedReason" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'active',
ADD COLUMN     "statusChangedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "UserAchievementTransition" (
    "id" TEXT NOT NULL,
    "userAchievementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trigger" TEXT NOT NULL,
    "reason" TEXT,
    "cause" JSONB,
    "before" JSONB,
    "after" JSONB,
    "ruleVersion" INTEGER NOT NULL,

    CONSTRAINT "UserAchievementTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorrectionReevaluation" (
    "userId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "dirtySince" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "analysisSessionIds" JSONB NOT NULL DEFAULT '[]',
    "forceSessionIds" JSONB NOT NULL DEFAULT '[]',
    "medalsPending" BOOLEAN NOT NULL DEFAULT false,
    "medalScope" JSONB,
    "leaseUntil" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CorrectionReevaluation_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "UserAchievementTransition_userAchievementId_at_idx" ON "UserAchievementTransition"("userAchievementId", "at");

-- CreateIndex
CREATE INDEX "UserAchievementTransition_userId_at_idx" ON "UserAchievementTransition"("userId", "at");

-- CreateIndex
CREATE INDEX "CorrectionReevaluation_leaseUntil_idx" ON "CorrectionReevaluation"("leaseUntil");

-- CreateIndex
CREATE INDEX "UserAchievement_userId_status_idx" ON "UserAchievement"("userId", "status");

-- AddForeignKey
ALTER TABLE "UserAchievementTransition" ADD CONSTRAINT "UserAchievementTransition_userAchievementId_fkey" FOREIGN KEY ("userAchievementId") REFERENCES "UserAchievement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Conversao das retracoes de volume antigas (reconciliacao de 13/10/2026): o marcador em evidence passa a ser tambem o estado 'revoked'.
-- A data da retracao e' a registrada no proprio marcador (checkedAt); se ausente/invalida, usa a data da concessao.
UPDATE "UserAchievement"
SET "status" = 'revoked',
    "revokedReason" = 'volume_reconciliation_retracted',
    "revokedAt" = CASE WHEN ("evidence"->'_volumeReconciliation'->>'checkedAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
                       THEN (("evidence"->'_volumeReconciliation'->>'checkedAt')::timestamptz AT TIME ZONE 'UTC')
                       ELSE "unlockedAt" END,
    "statusChangedAt" = CASE WHEN ("evidence"->'_volumeReconciliation'->>'checkedAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
                             THEN (("evidence"->'_volumeReconciliation'->>'checkedAt')::timestamptz AT TIME ZONE 'UTC')
                             ELSE "unlockedAt" END
WHERE "status" = 'active'
  AND jsonb_typeof("evidence") = 'object'
  AND "evidence"->'_volumeReconciliation'->>'status' = 'retracted';

-- Historico correspondente (uma transicao 'revoked' por concessao convertida, uma unica vez).
INSERT INTO "UserAchievementTransition" ("id", "userAchievementId", "userId", "type", "at", "trigger", "reason", "cause", "before", "after", "ruleVersion")
SELECT gen_random_uuid()::text, ua."id", ua."userId", 'revoked', COALESCE(ua."revokedAt", ua."unlockedAt"),
       'migration_volume_retraction', 'volume_reconciliation_retracted',
       jsonb_build_object('source', 'volume_reconciliation', 'checkedAt', ua."evidence"->'_volumeReconciliation'->>'checkedAt'),
       jsonb_build_object('status', 'active', 'original', ua."evidence"->'_volumeReconciliation'->'original'),
       jsonb_build_object('status', 'revoked'),
       ua."ruleVersionAtUnlock"
FROM "UserAchievement" ua
WHERE ua."status" = 'revoked'
  AND ua."revokedReason" = 'volume_reconciliation_retracted'
  AND NOT EXISTS (SELECT 1 FROM "UserAchievementTransition" t WHERE t."userAchievementId" = ua."id" AND t."trigger" = 'migration_volume_retraction');
