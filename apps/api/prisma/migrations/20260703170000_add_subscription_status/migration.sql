ALTER TABLE "User"
ADD COLUMN "subscriptionStatus" TEXT NOT NULL DEFAULT 'manual_active',
ADD COLUMN "subscriptionUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "User"
ALTER COLUMN "subscriptionStatus" SET DEFAULT 'pending';
