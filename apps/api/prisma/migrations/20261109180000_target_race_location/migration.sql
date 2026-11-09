-- Local e horario da prova alvo (09/11/2026, ordem do Elton): para o futuro indice de temperatura de bulbo umido (WBGT). Acrescimo simples e reversivel (DROP COLUMN city, state, startTime); nenhuma linha existente e alterada.
ALTER TABLE "TargetRace" ADD COLUMN "city" TEXT, ADD COLUMN "state" TEXT, ADD COLUMN "startTime" TEXT;
