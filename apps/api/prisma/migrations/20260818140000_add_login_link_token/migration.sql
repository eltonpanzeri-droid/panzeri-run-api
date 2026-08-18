-- CreateTable
CREATE TABLE "LoginLinkToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginLinkToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LoginLinkToken_tokenHash_key" ON "LoginLinkToken"("tokenHash");

-- CreateIndex
CREATE INDEX "LoginLinkToken_userId_idx" ON "LoginLinkToken"("userId");

-- AddForeignKey
ALTER TABLE "LoginLinkToken" ADD CONSTRAINT "LoginLinkToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
