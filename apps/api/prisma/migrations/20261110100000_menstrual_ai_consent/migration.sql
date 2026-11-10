-- 10/11/2026: aceite explicito da aluna para o ciclo menstrual alimentar a IA (versao + hash do texto + data; retirada independente).
-- Tabela nova e vazia: nada existente muda. Sem aceite vigente, o ciclo NAO chega a IA (filtro em MenstrualCycleService.getAgentContext).
-- Rollback: DROP TABLE "MenstrualAiConsent";
CREATE TABLE "MenstrualAiConsent" (
    "userId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "textHash" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MenstrualAiConsent_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "MenstrualAiConsent" ADD CONSTRAINT "MenstrualAiConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
