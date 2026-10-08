-- Wahoo leitura de atividades (08/10/2026, Etapa 5). Migration ADITIVA: so adiciona 2 colunas anulaveis a tabela criada em 20261008200000_wahoo_oauth
-- (que nao foi alterada). Nenhum dado existente muda.
ALTER TABLE "WahooConnection" ADD COLUMN "collectFrom" TIMESTAMP(3),
ADD COLUMN "lastSyncCompletedAt" TIMESTAMP(3);
