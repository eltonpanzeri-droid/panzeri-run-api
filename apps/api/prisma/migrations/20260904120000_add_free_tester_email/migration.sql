-- Lista de e-mails de testadores gratuitos gerenciada pelo treinador direto no admin, pra
-- createCheckout nunca cobrar de verdade um testador do teste fechado da Play Store (o build de
-- teste ainda nao tem a chave do RevenueCat). Ver comentario no schema.prisma.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'FreeTesterEmail'
  ) THEN
    CREATE TABLE "FreeTesterEmail" (
      "id" TEXT NOT NULL,
      "email" TEXT NOT NULL,
      "note" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "FreeTesterEmail_pkey" PRIMARY KEY ("id")
    );
    CREATE UNIQUE INDEX "FreeTesterEmail_email_key" ON "FreeTesterEmail"("email");
  END IF;
END $$;
