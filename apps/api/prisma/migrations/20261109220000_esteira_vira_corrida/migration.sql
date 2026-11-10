-- 09/11/2026 (ordem de Elton): so' existe CORRIDA. Todo dado antigo marcado como esteira passa a corrida. Idempotente (rodar de novo nao muda nada).
-- Nao ha rollback automatico (a distincao antiga esteira/corrida deixa de existir por decisao do produto); o backup do banco e' o caminho de volta.

-- 1) Rotina: modalities (esteira/treadmill -> corrida, sem repetir, mantendo a ordem) e duracoes (corrida informada ganha da duracao antiga de esteira).
UPDATE "WeeklyAvailability"
SET "modalities" = (
  SELECT COALESCE(array_agg(g.m ORDER BY g.first_ord), '{}')
  FROM (
    SELECT s.m, MIN(s.ord) AS first_ord
    FROM (
      SELECT CASE WHEN t.x IN ('esteira', 'treadmill') THEN 'corrida' ELSE t.x END AS m, t.ord
      FROM unnest("WeeklyAvailability"."modalities") WITH ORDINALITY AS t(x, ord)
    ) s
    GROUP BY s.m
  ) g
)
WHERE "modalities" && ARRAY['esteira', 'treadmill']::text[];

UPDATE "WeeklyAvailability"
SET "modalityDurations" = (("modalityDurations" - 'esteira' - 'treadmill') ||
  CASE WHEN "modalityDurations" ? 'corrida' THEN '{}'::jsonb
       ELSE jsonb_build_object('corrida', COALESCE("modalityDurations"->'esteira', "modalityDurations"->'treadmill')) END)
WHERE jsonb_typeof("modalityDurations") = 'object'
  AND ("modalityDurations" ? 'esteira' OR "modalityDurations" ? 'treadmill');

-- 2) Treinos ja gerados e registros derivados.
UPDATE "TrainingSession"
SET "modality" = 'corrida',
    "title" = CASE WHEN "title" = 'Corrida na esteira' THEN 'Corrida' ELSE "title" END
WHERE "modality" IN ('esteira', 'treadmill');

UPDATE "SessionExecutionAnalysis" SET "modality" = 'corrida' WHERE "modality" IN ('esteira', 'treadmill');
UPDATE "PrescriptionDecision" SET "modality" = 'corrida' WHERE "modality" IN ('esteira', 'treadmill');
UPDATE "UserAchievement" SET "modality" = 'corrida' WHERE "modality" IN ('esteira', 'treadmill');
