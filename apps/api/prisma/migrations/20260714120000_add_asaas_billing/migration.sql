ALTER TABLE "User" ADD COLUMN "cpf" TEXT;
CREATE UNIQUE INDEX "User_cpf_key" ON "User"("cpf");

ALTER TABLE "BillingSubscription" ADD COLUMN "externalCustomerId" TEXT;
ALTER TABLE "BillingSubscription" ALTER COLUMN "provider" SET DEFAULT 'asaas';
