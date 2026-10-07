-- Alinha o banco de producao ao model WorkoutDelivery. A migration 20261002120000_add_workout_delivery foi EDITADA depois de criada (commit
-- b3ebfff, 12 min apos o 5c53a1b) para acrescentar deliveredAt e canceledAt; como o banco de producao ja' tinha aplicado a versao original,
-- essas duas colunas nunca foram criadas la' e o Prisma passou a falhar com "The column WorkoutDelivery.deliveredAt does not exist"
-- (HTTP 500 em qualquer leitura de WorkoutDelivery). O arquivo da migration antiga foi restaurado ao conteudo ja' aplicado (checksum) e as
-- colunas faltantes entram aqui. Aditiva, sem recriar tabela e sem tocar em dados; IF NOT EXISTS torna a migration segura em bancos que
-- ja' criaram as colunas pela versao editada (ambientes novos).
-- deliveredAt: so' preenchido quando o provider confirma recebimento real no dispositivo. canceledAt: cancelamento deliberado da tentativa.
ALTER TABLE "WorkoutDelivery" ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP(3);
ALTER TABLE "WorkoutDelivery" ADD COLUMN IF NOT EXISTS "canceledAt" TIMESTAMP(3);
