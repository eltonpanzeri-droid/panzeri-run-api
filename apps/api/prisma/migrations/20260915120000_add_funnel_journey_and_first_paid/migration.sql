ALTER TABLE "FunnelEvent"
ADD COLUMN "journeyId" TEXT,
ADD COLUMN "dedupeKey" TEXT;

CREATE UNIQUE INDEX "FunnelEvent_dedupeKey_key" ON "FunnelEvent"("dedupeKey");
CREATE INDEX "FunnelEvent_journeyId_idx" ON "FunnelEvent"("journeyId");

ALTER TABLE "BillingSubscription"
ADD COLUMN "firstPaidPaymentId" TEXT,
ADD COLUMN "firstPaidAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "BillingSubscription_firstPaidPaymentId_key"
ON "BillingSubscription"("firstPaidPaymentId");
