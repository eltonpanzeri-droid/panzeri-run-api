-- Sistema de Medalhas (30/09/2026, especificacao em SISTEMA_DE_MEDALHAS.md).
-- Achievement/UserAchievement ja existiam no schema, nunca usadas por nenhum codigo (tabelas
-- vazias) — extensao em vez de criar um sistema concorrente. Defaults abaixo existem so' por
-- seguranca (colunas NOT NULL numa tabela que ja deveria estar vazia), nao porque esperamos
-- linhas pre-existentes.

ALTER TABLE "Achievement"
  ADD COLUMN "category" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "grau" TEXT NOT NULL DEFAULT 'bronze',
  ADD COLUMN "threshold" DOUBLE PRECISION,
  ADD COLUMN "unit" TEXT,
  ADD COLUMN "ruleVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "Achievement_category_idx" ON "Achievement"("category");

ALTER TABLE "UserAchievement"
  ADD COLUMN "value" DOUBLE PRECISION,
  ADD COLUMN "periodStart" TIMESTAMP(3),
  ADD COLUMN "periodEnd" TIMESTAMP(3),
  ADD COLUMN "modality" TEXT,
  ADD COLUMN "evidence" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "ruleVersionAtUnlock" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX "UserAchievement_userId_achievementId_key" ON "UserAchievement"("userId", "achievementId");
CREATE INDEX "UserAchievement_userId_unlockedAt_idx" ON "UserAchievement"("userId", "unlockedAt");
-- Etapa 8 (inteligencia gerencial, ver SISTEMA_DE_MEDALHAS.md secao 18) — consulta "quantos
-- alunos ja conquistaram a medalha X" e' por achievementId sozinho, o indice composto acima nao
-- atende bem essa consulta.
CREATE INDEX "UserAchievement_achievementId_idx" ON "UserAchievement"("achievementId");
