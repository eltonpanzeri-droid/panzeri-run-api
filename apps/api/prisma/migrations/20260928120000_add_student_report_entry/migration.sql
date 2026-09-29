-- Agente Relator + Linha do Tempo de Relatos (28/09/2026) — tabela nova, nada destrutivo.
-- Preserva o texto original do aluno pra sempre; a analise da IA (facts/perception/themes/...)
-- e' preenchida depois, de forma assincrona e melhor-esforco (analyzedAt nulo = pendente/falhou).

CREATE TABLE "StudentReportEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "promptQuestion" TEXT,
    "relatedLabel" TEXT,
    "originalText" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "analyzedAt" TIMESTAMP(3),
    "facts" TEXT,
    "perception" TEXT,
    "themes" TEXT[],
    "temporality" TEXT,
    "longitudinalNote" TEXT,
    "hypotheses" TEXT[],
    "relevance" TEXT,
    "analysisError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentReportEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StudentReportEntry_userId_createdAt_idx" ON "StudentReportEntry"("userId", "createdAt");
CREATE INDEX "StudentReportEntry_userId_sourceType_idx" ON "StudentReportEntry"("userId", "sourceType");
CREATE INDEX "StudentReportEntry_userId_analyzedAt_idx" ON "StudentReportEntry"("userId", "analyzedAt");

ALTER TABLE "StudentReportEntry" ADD CONSTRAINT "StudentReportEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
