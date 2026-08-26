-- Marca quem controla o subscriptionStatus de cada aluna: 'asaas' (site/PWA) ou 'revenuecat'
-- (assinatura comprada dentro do app nativo, Apple IAP / Google Play Billing). Todo mundo que ja
-- existe hoje assina pelo Asaas, entao o default cobre a base inteira sem precisar de backfill.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'User' AND column_name = 'subscriptionProvider'
  ) THEN
    ALTER TABLE "User" ADD COLUMN "subscriptionProvider" TEXT NOT NULL DEFAULT 'asaas';
  END IF;
END $$;
