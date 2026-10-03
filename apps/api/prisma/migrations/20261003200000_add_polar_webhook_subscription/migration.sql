-- Assinatura de webhook Polar (03/10/2026) — aditiva. Ver comentario do model em schema.prisma.
CREATE TABLE "PolarWebhookSubscription" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "polarWebhookId" TEXT,
    "signatureSecretEncrypted" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PolarWebhookSubscription_pkey" PRIMARY KEY ("id")
);
