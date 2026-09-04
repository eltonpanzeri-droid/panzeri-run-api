-- Indice composto pros filtros mais usados no painel do treinador, prospectos e nos crons diarios
-- (role + subscriptionStatus + accountStatus juntos ou em subconjunto). Barato de manter, evita
-- degradacao conforme a base de alunos crescer alem de algumas centenas/milhares de linhas.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'User_role_subscriptionStatus_accountStatus_idx'
  ) THEN
    CREATE INDEX "User_role_subscriptionStatus_accountStatus_idx" ON "User"("role", "subscriptionStatus", "accountStatus");
  END IF;
END $$;
