-- Fase 0: BillingEvent + campos de firstPaid + acquisitionAttribution (JSON)
-- Permite: LTV real, cohort analysis, churn rate, atribuição de aquisição multi-dimensão

-- BillingEvent: log imutável de cada transição de status de billing
CREATE TABLE "BillingEvent" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userId" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "prevStatus" TEXT,
  "nextStatus" TEXT,
  "value" DECIMAL(10, 2),
  "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "externalRef" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillingEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "BillingEvent_userId_idx" ON "BillingEvent"("userId");
CREATE INDEX "BillingEvent_event_idx" ON "BillingEvent"("event");
CREATE INDEX "BillingEvent_timestamp_idx" ON "BillingEvent"("timestamp");

-- BillingSubscription: adicionar campos para rastreio de primeiro pagamento
ALTER TABLE "BillingSubscription" ADD COLUMN "firstPaidAt" TIMESTAMP(3);
ALTER TABLE "BillingSubscription" ADD COLUMN "firstPaidPaymentId" TEXT;

-- Criar índice único em firstPaidPaymentId (permite deduplicação de webhook)
CREATE UNIQUE INDEX "BillingSubscription_firstPaidPaymentId_key" ON "BillingSubscription"("firstPaidPaymentId") WHERE "firstPaidPaymentId" IS NOT NULL;

-- User: atribuição de aquisição como JSON (journeyId, source, medium, campaign, content, referrer, fbclid, gclid)
ALTER TABLE "User" ADD COLUMN "acquisitionAttribution" JSONB;
