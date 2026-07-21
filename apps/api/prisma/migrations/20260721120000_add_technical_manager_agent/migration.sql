-- CreateTable
CREATE TABLE "StudentDirective" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentDirective_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachChatMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoachChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudentDirective_userId_active_idx" ON "StudentDirective"("userId", "active");

-- CreateIndex
CREATE INDEX "CoachChatMessage_userId_createdAt_idx" ON "CoachChatMessage"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "StudentDirective" ADD CONSTRAINT "StudentDirective_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachChatMessage" ADD CONSTRAINT "CoachChatMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
