UPDATE "OnboardingInterview"
SET "completedAt" = NULL, "currentStep" = 0, "updatedAt" = CURRENT_TIMESTAMP
WHERE "completedAt" IS NOT NULL
  AND "answers" = '{}'::jsonb;