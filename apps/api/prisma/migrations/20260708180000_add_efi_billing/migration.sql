CREATE TABLE "BillingProviderConfig" (
  "provider" TEXT NOT NULL,
  "externalPlanId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BillingProviderConfig_pkey" PRIMARY KEY ("provider")
);

CREATE TABLE "BillingSubscription" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'efi',
  "externalSubscriptionId" TEXT,
  "externalChargeId" TEXT,
  "checkoutUrl" TEXT,
  "providerStatus" TEXT NOT NULL DEFAULT 'new',
  "lastNotificationToken" TEXT,
  "nextChargeAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BillingSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BillingSubscription_userId_key" ON "BillingSubscription"("userId");
CREATE UNIQUE INDEX "BillingSubscription_externalSubscriptionId_key" ON "BillingSubscription"("externalSubscriptionId");
CREATE UNIQUE INDEX "BillingSubscription_externalChargeId_key" ON "BillingSubscription"("externalChargeId");
ALTER TABLE "BillingSubscription" ADD CONSTRAINT "BillingSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;