-- Evolucao do acompanhamento menstrual (25/09/2026): calendario longitudinal real, nao so um
-- formulario. Tudo aditivo/nullable ou com DEFAULT — nenhuma coluna existente e' removida ou torna-se
-- obrigatoria sem default, nenhum dado historico e' reescrito.

-- MenstrualProfile: campos opcionais adicionais da configuracao inicial.
ALTER TABLE "MenstrualProfile" ADD COLUMN "cycleRegularity" TEXT;
ALTER TABLE "MenstrualProfile" ADD COLUMN "diuType" TEXT;
ALTER TABLE "MenstrualProfile" ADD COLUMN "menopauseStatus" TEXT;

-- MenstrualCycleLog: agora com fim do sangramento (alem do inicio) + intensidade de fluxo do dia 1.
ALTER TABLE "MenstrualCycleLog" ADD COLUMN "cycleEndDate" TIMESTAMP(3);
ALTER TABLE "MenstrualCycleLog" ADD COLUMN "flowIntensity" TEXT;
ALTER TABLE "MenstrualCycleLog" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- MenstrualDailyLog: um registro por dia (upsert), pra sintomas poderem ser acompanhados em
-- qualquer dia do ciclo — fonte canonica que alimenta o Observation Reader (Variable Registry).
CREATE TABLE "MenstrualDailyLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "crampsLevel" INTEGER,
    "energyLevel" INTEGER,
    "moodLevel" INTEGER,
    "flowIntensity" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenstrualDailyLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MenstrualDailyLog_userId_date_key" ON "MenstrualDailyLog"("userId", "date");
CREATE INDEX "MenstrualDailyLog_userId_date_idx" ON "MenstrualDailyLog"("userId", "date");

ALTER TABLE "MenstrualDailyLog" ADD CONSTRAINT "MenstrualDailyLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
