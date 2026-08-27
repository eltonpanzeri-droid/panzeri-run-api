-- Marca quando a propria aluna pediu cancelamento (nunca e' tocado por nenhum sync automatico,
-- diferente de billingSubscription.providerStatus). Sem backfill: ninguem sabe retroativamente
-- quem pediu vs quem caiu sozinho antes de hoje, entao fica null pra base existente de proposito.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'User' AND column_name = 'subscriptionCancelRequestedAt'
  ) THEN
    ALTER TABLE "User" ADD COLUMN "subscriptionCancelRequestedAt" TIMESTAMP(3);
  END IF;
END $$;
