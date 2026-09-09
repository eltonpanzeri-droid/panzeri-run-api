-- Migration: add_training_session_evolution_index
-- Data: 2026-09-09
-- Motivo: queries de evolucao do atleta faziam full-scan em TrainingSession.
--         Com 2.778 sessoes hoje e crescimento semanal, o indice e necessario
--         antes de habilitar os endpoints de evolucao.
-- Risco: aditivo. Rollback: DROP INDEX abaixo.
-- Rollback: DROP INDEX IF EXISTS "TrainingSession_userId_scheduledDate_idx";

CREATE INDEX IF NOT EXISTS "TrainingSession_userId_scheduledDate_idx"
  ON "TrainingSession"("userId", "scheduledDate");
