-- Condicoes flexiveis de cupom e estado do resgate (30/10/2026). Aditivo: colunas novas com padrao; cupons e resgates existentes mantem o comportamento (percentual, todas as mensalidades, sem limite, resgate 'applied').
ALTER TABLE "Coupon" ADD COLUMN "discountType" TEXT NOT NULL DEFAULT 'percent';
ALTER TABLE "Coupon" ADD COLUMN "discountAmountCents" INTEGER;
ALTER TABLE "Coupon" ADD COLUMN "durationMonths" INTEGER;
ALTER TABLE "Coupon" ADD COLUMN "maxRedemptions" INTEGER;
ALTER TABLE "Coupon" ADD COLUMN "validFrom" TIMESTAMP(3);
ALTER TABLE "Coupon" ADD COLUMN "validUntil" TIMESTAMP(3);

ALTER TABLE "CouponRedemption" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'applied';
ALTER TABLE "CouponRedemption" ADD COLUMN "appliedAt" TIMESTAMP(3);
ALTER TABLE "CouponRedemption" ADD COLUMN "appliedValueCents" INTEGER;
ALTER TABLE "CouponRedemption" ADD COLUMN "appliedSubscriptionId" TEXT;
