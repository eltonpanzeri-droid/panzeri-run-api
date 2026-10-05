-- Strava compliance (05/10/2026): OAuth com tentativa de uso unico, dedupe de webhook, retencao de 7 dias e limpeza de derivados.

CREATE TABLE "StravaOAuthAttempt" (
    "stateHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StravaOAuthAttempt_pkey" PRIMARY KEY ("stateHash")
);
CREATE INDEX "StravaOAuthAttempt_userId_idx" ON "StravaOAuthAttempt"("userId");
CREATE INDEX "StravaOAuthAttempt_expiresAt_idx" ON "StravaOAuthAttempt"("expiresAt");

CREATE TABLE "StravaWebhookEvent" (
    "dedupeKey" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StravaWebhookEvent_pkey" PRIMARY KEY ("dedupeKey")
);
CREATE INDEX "StravaWebhookEvent_receivedAt_idx" ON "StravaWebhookEvent"("receivedAt");

-- Retencao: o cache Strava vale 7 dias a partir da ultima busca. Linhas existentes nao tem essa data; usa-se createdAt
-- (conservador) e ja se elimina o que passou do prazo.
ALTER TABLE "StravaActivity" ADD COLUMN "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "StravaActivity" SET "fetchedAt" = "createdAt";
DELETE FROM "StravaActivity" WHERE "fetchedAt" < NOW() - INTERVAL '7 days';

-- Derivados de proveniencia Strava que nao podem mais existir: analises de IA, resumos de execucao calculados a partir de
-- atividades do Strava e os campos Strava gravados nos snapshots de geracao do programa de treino.
DELETE FROM "TrainingExecutionInsight";
UPDATE "StravaAnalysisCache" SET "analysis" = NULL, "lastActivityId" = NULL WHERE "analysis" IS NOT NULL OR "lastActivityId" IS NOT NULL;
UPDATE "TrainingPlan"
   SET "inputSnapshot" = (("inputSnapshot" #- '{methodology,stravaRunMinutes}') #- '{methodology,analysisAgent}') #- '{methodology,stravaAnalysis}'
 WHERE "inputSnapshot" #> '{methodology}' IS NOT NULL
   AND ("inputSnapshot" #> '{methodology}' ?| ARRAY['stravaRunMinutes', 'analysisAgent', 'stravaAnalysis']);

-- Relatorios de evolucao ja gerados: remove km/min do Strava, a secao "Dados do Strava" e a tendencia derivada do Strava.
UPDATE "CoachReport"
   SET "content" = jsonb_set(
         jsonb_set(
           (("content" #- '{metrics,stravaKm}') #- '{metrics,stravaMinutes}'),
           '{metrics,trend}', to_jsonb('sem tendencia calculada'::text), false),
         '{sections}',
         COALESCE((
           SELECT jsonb_agg(
                    CASE WHEN s->>'title' = 'Tendencia observada'
                         THEN jsonb_set(s, '{text}', to_jsonb('Sem tendencia automatica consolidada.'::text))
                         ELSE s END)
             FROM jsonb_array_elements("content"->'sections') s
            WHERE s->>'title' <> 'Dados do Strava'), '[]'::jsonb),
         false)
 WHERE "reportType" = 'evolution'
   AND jsonb_typeof("content"->'sections') = 'array'
   AND "content"::text LIKE '%Strava%';
