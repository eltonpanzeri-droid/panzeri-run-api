-- 26/10/2026 — Separacao definitiva entre entrevista e rotina: estado/revisao da rotina e historico de alteracoes.
-- SO CRIA tabelas novas. Nenhuma linha existente e' alterada: alunos legados (com linhas em WeeklyAvailability e sem linha de estado) contam como "rotina cadastrada, revisao 0".

CREATE TABLE "WeeklyRoutineState" (
    "userId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "configuredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyRoutineState_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "WeeklyRoutineChange" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "actorId" TEXT,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklyRoutineChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WeeklyRoutineChange_userId_revision_idx" ON "WeeklyRoutineChange"("userId", "revision");

ALTER TABLE "WeeklyRoutineState" ADD CONSTRAINT "WeeklyRoutineState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WeeklyRoutineChange" ADD CONSTRAINT "WeeklyRoutineChange_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
