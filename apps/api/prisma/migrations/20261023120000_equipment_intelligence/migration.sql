-- Equipamentos (23/10/2026). Aditiva: uma coluna nova opcional em "Shoe" e tres tabelas novas; nenhum dado existente e alterado ou apagado.
ALTER TABLE "Shoe" ADD COLUMN "version" TEXT;

CREATE TABLE "ShoeEvent" (
    "id" TEXT NOT NULL,
    "shoeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShoeEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShoePhoto" (
    "shoeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShoePhoto_pkey" PRIMARY KEY ("shoeId")
);

CREATE TABLE "UserDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceProvider" TEXT NOT NULL,
    "sourceDetail" TEXT NOT NULL DEFAULT '',
    "deviceKey" TEXT NOT NULL DEFAULT '',
    "observedManufacturer" TEXT,
    "observedModel" TEXT,
    "observedName" TEXT,
    "deviceType" TEXT,
    "manufacturerBasis" TEXT,
    "firstSeenAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "activityCount" INTEGER NOT NULL DEFAULT 0,
    "manualManufacturer" TEXT,
    "manualModel" TEXT,
    "manualUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserDevice_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ShoeEvent_shoeId_occurredAt_idx" ON "ShoeEvent"("shoeId", "occurredAt");
CREATE INDEX "ShoeEvent_userId_idx" ON "ShoeEvent"("userId");
CREATE INDEX "ShoeEvent_type_occurredAt_idx" ON "ShoeEvent"("type", "occurredAt");
CREATE INDEX "ShoePhoto_userId_idx" ON "ShoePhoto"("userId");
CREATE UNIQUE INDEX "UserDevice_userId_sourceProvider_sourceDetail_deviceKey_key" ON "UserDevice"("userId", "sourceProvider", "sourceDetail", "deviceKey");
CREATE INDEX "UserDevice_userId_idx" ON "UserDevice"("userId");
CREATE INDEX "UserDevice_sourceProvider_idx" ON "UserDevice"("sourceProvider");

ALTER TABLE "ShoeEvent" ADD CONSTRAINT "ShoeEvent_shoeId_fkey" FOREIGN KEY ("shoeId") REFERENCES "Shoe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShoeEvent" ADD CONSTRAINT "ShoeEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserDevice" ADD CONSTRAINT "UserDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Historia dos tenis ja cadastrados: um 'registered' na data do cadastro e, para os aposentados, um 'retired' na data de aposentadoria que ja existia. Nada alem disso e inventado.
INSERT INTO "ShoeEvent" ("id", "shoeId", "userId", "type", "occurredAt", "details")
SELECT gen_random_uuid()::text, s."id", s."userId", 'registered', s."createdAt", jsonb_build_object('backfilled', true, 'startedUsingAt', s."startedUsingAt")
FROM "Shoe" s;

INSERT INTO "ShoeEvent" ("id", "shoeId", "userId", "type", "occurredAt", "details")
SELECT gen_random_uuid()::text, s."id", s."userId", 'retired', s."retiredAt", jsonb_build_object('backfilled', true)
FROM "Shoe" s
WHERE s."status" = 'retired' AND s."retiredAt" IS NOT NULL;
