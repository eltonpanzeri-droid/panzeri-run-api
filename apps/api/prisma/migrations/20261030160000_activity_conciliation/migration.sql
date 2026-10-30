-- Conciliacao de atividades (30/10/2026). Aditivo: nenhuma coluna ou tabela existente perde dado; linhas antigas ficam com NULL (= comportamento anterior).
ALTER TABLE "ActivityLog" ADD COLUMN "studentLabel" TEXT;
ALTER TABLE "SessionExecutionLink" ADD COLUMN "role" TEXT;

CREATE TABLE "WorkoutFeedbackVersion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkoutFeedbackVersion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkoutFeedbackVersion_userId_sessionId_idx" ON "WorkoutFeedbackVersion"("userId", "sessionId");
