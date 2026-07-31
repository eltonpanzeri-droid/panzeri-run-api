-- CreateTable
CREATE TABLE "StudentProfileEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "summarizedAt" TIMESTAMP(3),

    CONSTRAINT "StudentProfileEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentProfile" (
    "userId" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "StudentProfileEvent_userId_summarizedAt_idx" ON "StudentProfileEvent"("userId", "summarizedAt");

-- AddForeignKey
ALTER TABLE "StudentProfileEvent" ADD CONSTRAINT "StudentProfileEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
