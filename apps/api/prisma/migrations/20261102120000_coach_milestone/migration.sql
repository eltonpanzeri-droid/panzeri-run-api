-- Marcos ja avisados ao treinador (02/11/2026). Aditivo: tabela nova; nenhuma tabela existente e' alterada. Rollback: DROP TABLE "CoachMilestone".
-- CreateTable
CREATE TABLE "CoachMilestone" (
    "key" TEXT NOT NULL,
    "reachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "detail" JSONB,

    CONSTRAINT "CoachMilestone_pkey" PRIMARY KEY ("key")
);
