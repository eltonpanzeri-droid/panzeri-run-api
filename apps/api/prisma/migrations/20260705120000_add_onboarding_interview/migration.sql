CREATE TABLE "OnboardingInterview" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "answers" JSONB NOT NULL DEFAULT '{}',
  "currentStep" INTEGER NOT NULL DEFAULT 0,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OnboardingInterview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OnboardingInterview_userId_key" ON "OnboardingInterview"("userId");

ALTER TABLE "OnboardingInterview"
ADD CONSTRAINT "OnboardingInterview_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "OnboardingInterview" ("id", "userId", "answers", "currentStep", "completedAt", "createdAt", "updatedAt")
SELECT md5(random()::text || clock_timestamp()::text || "id"), "id", '{}'::jsonb, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "User"
WHERE "role" = 'student';
