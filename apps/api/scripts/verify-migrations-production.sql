-- SOMENTE LEITURA. Nao altera nada. Gera UM json com o historico de migrations aplicado no banco, para ser comparado offline com o repositorio:
--   node scripts/verify-migration-checksums.cjs migrations-producao.json
--
-- Como executar (recomendado: sessao forcada a somente-leitura, para que nem um erro de digitacao consiga escrever):
--   PGOPTIONS="-c default_transaction_read_only=on" psql "<URL de producao>" -X -t -A -f scripts/verify-migrations-production.sql -o migrations-producao.json
-- (no EasyPanel: console do servico do banco; copie o arquivo gerado para a maquina que roda o verificador)
--
-- Observacoes: `checksum` e' o sha256 COMPLETO do migration.sql no momento em que foi aplicada; `logs` so existe quando a migration falhou.
-- Nenhum dado de aluno e' lido: apenas a tabela de controle do Prisma (_prisma_migrations).
SELECT json_agg(t ORDER BY t.migration_name)
FROM (
  SELECT migration_name,
         checksum,
         started_at,
         finished_at,
         rolled_back_at,
         applied_steps_count,
         left(coalesce(logs, ''), 300) AS logs
  FROM _prisma_migrations
) t;
