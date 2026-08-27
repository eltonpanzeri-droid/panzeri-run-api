-- Rastreamento real de entrega de e-mail (webhook da Resend) — correlaciona o log de envio com
-- os eventos delivered/bounced/complained/opened que chegam depois.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'MessageLog' AND column_name = 'resendEmailId'
  ) THEN
    ALTER TABLE "MessageLog" ADD COLUMN "resendEmailId" TEXT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'MessageLog' AND column_name = 'deliveryStatus'
  ) THEN
    ALTER TABLE "MessageLog" ADD COLUMN "deliveryStatus" TEXT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'MessageLog' AND column_name = 'deliveryUpdatedAt'
  ) THEN
    ALTER TABLE "MessageLog" ADD COLUMN "deliveryUpdatedAt" TIMESTAMP(3);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "MessageLog_resendEmailId_idx" ON "MessageLog"("resendEmailId");
