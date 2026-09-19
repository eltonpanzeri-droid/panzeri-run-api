-- Historico comercial temporal (19/09/2026) — SOMENTE DADOS/INDICE, nenhuma coluna nova.
--
-- PARTE 1 — Ancora do estado comercial (baseline_snapshot)
-- Uma linha por aluno, event='baseline_snapshot', com o subscriptionStatus OBSERVADO neste instante
-- (timestamp = momento da migration). Isso e' um fato observado, nao historico inventado: define o
-- ponto a partir do qual o estado comercial de cada pessoa pode ser reconstruido com certeza
-- reprocessando as transicoes (event='status_changed') gravadas depois.
-- externalRef guarda se a pessoa JA tinha acesso alguma vez neste instante ('baseline:had_access' =
-- studentCode preenchido, atribuido na 1a ativacao) — necessario para distinguir "nunca foi assinante"
-- de "ex-assinante" quando o status e' canceled/pending.
-- Idempotente: NOT EXISTS impede duplicar a foto se a migration for reaplicada.
INSERT INTO "BillingEvent" ("id", "userId", "event", "prevStatus", "nextStatus", "timestamp", "externalRef")
SELECT
  gen_random_uuid()::text,
  u."id",
  'baseline_snapshot',
  NULL,
  u."subscriptionStatus",
  CURRENT_TIMESTAMP,
  CASE WHEN u."studentCode" IS NOT NULL THEN 'baseline:had_access' ELSE 'baseline:no_access' END
FROM "User" u
WHERE u."role" = 'student'
  AND NOT EXISTS (
    SELECT 1 FROM "BillingEvent" b
    WHERE b."userId" = u."id" AND b."event" = 'baseline_snapshot'
  );

-- PARTE 2 — Um pagamento confirmado so' conta UMA vez (idempotencia garantida pelo banco)
-- O Asaas manda PAYMENT_CONFIRMED e PAYMENT_RECEIVED para o mesmo pagamento, quase ao mesmo tempo (PIX):
-- duas requisicoes concorrentes podiam passar juntas pela checagem em codigo e duplicar a receita.
-- Primeiro remove duplicatas ja existentes (mantem a de menor id), depois cria o indice unico parcial.
-- NOTA: indice parcial nao e' expressavel no schema.prisma — existe so' aqui (migrate deploy o aplica;
-- nao alterar/remover sem migration explicita).
DELETE FROM "BillingEvent" a
USING "BillingEvent" b
WHERE a."event" = 'payment_confirmed'
  AND b."event" = 'payment_confirmed'
  AND a."externalRef" IS NOT NULL
  AND a."externalRef" = b."externalRef"
  AND a."id" > b."id";

CREATE UNIQUE INDEX IF NOT EXISTS "BillingEvent_payment_confirmed_externalRef_key"
  ON "BillingEvent" ("externalRef")
  WHERE "event" = 'payment_confirmed' AND "externalRef" IS NOT NULL;
