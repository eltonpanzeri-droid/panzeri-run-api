-- Preferencia de divisao da musculacao por dia (16/11/2026). Coluna opcional e aditiva: nenhuma linha existente muda; sem resposta = a IA decide livremente, como sempre foi.
ALTER TABLE "WeeklyRoutineState" ADD COLUMN "strengthSplit" JSONB;
