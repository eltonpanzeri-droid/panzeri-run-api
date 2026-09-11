-- 11/09: Rastreamento de ciclo menstrual para correlacao com aderencia/dor/desempenho.
-- Dois modelos separados: MenstrualProfile (perfil estatico, 1 por aluna) e
-- MenstrualCycleLog (1 por ciclo registrado, com data do dia 1 + sintomas opcionais).

CREATE TABLE "MenstrualProfile" (
  "id"                        TEXT NOT NULL PRIMARY KEY,
  "userId"                    TEXT NOT NULL UNIQUE,
  "hasActiveCycle"            BOOLEAN,
  "usesHormonalContraceptive" BOOLEAN,
  "contraceptiveType"         TEXT,
  "cycleLengthDays"           INTEGER,
  "periodLengthDays"          INTEGER,
  "createdAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MenstrualProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "MenstrualCycleLog" (
  "id"             TEXT NOT NULL PRIMARY KEY,
  "userId"         TEXT NOT NULL,
  "cycleStartDate" TIMESTAMP(3) NOT NULL,
  "crampsLevel"    INTEGER,
  "energyLevel"    INTEGER,
  "moodLevel"      INTEGER,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MenstrualCycleLog_userId_fkey"  FOREIGN KEY ("userId")  REFERENCES "User"("id")             ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MenstrualCycleLog_profileId_fk" FOREIGN KEY ("userId") REFERENCES "MenstrualProfile"("userId") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "MenstrualCycleLog_userId_cycleStartDate_idx" ON "MenstrualCycleLog"("userId", "cycleStartDate");
