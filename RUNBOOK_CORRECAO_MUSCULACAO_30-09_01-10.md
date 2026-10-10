# Runbook — correção das duas musculações Polar (30/09 e 01/10/2026)

**Status:** preparado; NÃO executado. Executar só com autorização explícita do Elton e **depois do deploy** da correção de modalidades/vínculos.
**Escopo:** exatamente 2 atividades (`ActivityLog`) do aluno de teste. Nenhuma reconciliação geral do histórico. Nenhum registro é apagado; payloads (`RawExternalActivity`), IDs e evidências de identidade não são tocados.

| Dia | ActivityLog id | externalId | Duração |
|---|---|---|---|
| 30/09/2026 | `40c6cf43-fe1e-4790-b855-83da5baa93dd` | 511760127 | 52min00s |
| 01/10/2026 | `d5b42e54-d6ff-4817-9181-3725395085f3` | 511760120 | 57min41s |

Causa: importadas antes do normalizador, `sport = 'OTHER'` bruto (payload: `OTHER` + `STRENGTH_TRAINING`) → modalidade canônica `outra` → incompatível com a musculação prescrita → "Atividade alternativa". A regra de hoje já grava `forca` para esse payload.

## Etapa 0 — leitura (anotar o resultado: serve de rollback)
```sql
SELECT id, "externalId", sport, "executionClassification", "executionClassifiedBy", "executionClassifiedAt", "physicalIdentityStatus", "physicalEventId"
FROM "ActivityLog"
WHERE id IN ('40c6cf43-fe1e-4790-b855-83da5baa93dd','d5b42e54-d6ff-4817-9181-3725395085f3');

SELECT s.id, s."scheduledDate", s.modality, s."durationMin", s.origin, c.status AS feedback, c."perceivedEffort"
FROM "TrainingSession" s LEFT JOIN "WorkoutCompletion" c ON c."sessionId" = s.id
WHERE s."userId" = (SELECT "userId" FROM "ActivityLog" WHERE id = '40c6cf43-fe1e-4790-b855-83da5baa93dd')
  AND s."scheduledDate" IN ('2026-09-30','2026-10-01') ORDER BY s."scheduledDate";

SELECT id, "trainingSessionId", "activityLogId", status, origin, "matchMethod"
FROM "SessionExecutionLink"
WHERE "activityLogId" IN ('40c6cf43-fe1e-4790-b855-83da5baa93dd','d5b42e54-d6ff-4817-9181-3725395085f3');
```
**Só prosseguir se:** (a) as duas atividades estão com `sport = 'OTHER'`, `executionClassification = 'alternative'` e `executionClassifiedBy = 'automatic'` (se for `student`/`coach`, parar: é decisão humana e o plano muda); (b) há **exatamente uma** musculação prescrita (`forca`, origem `agent`) em cada dia; (c) nenhum vínculo ativo nessas sessões nem nessas atividades; (d) nenhuma sessão `device_extra` materializada para elas (a tela mostra "Registrar feedback", ou seja, não materializada).

## Etapa 1 — correção (uma transação; só confirma se os dois comandos afetarem 2 linhas)
```sql
BEGIN;
UPDATE "ActivityLog" SET sport = 'forca'
 WHERE id IN ('40c6cf43-fe1e-4790-b855-83da5baa93dd','d5b42e54-d6ff-4817-9181-3725395085f3')
   AND provider = 'polar' AND sport = 'OTHER' AND "externalId" IN ('511760127','511760120');          -- esperado: UPDATE 2
UPDATE "ActivityLog" SET "executionClassification" = NULL, "executionClassifiedAt" = NULL, "executionClassifiedBy" = NULL
 WHERE id IN ('40c6cf43-fe1e-4790-b855-83da5baa93dd','d5b42e54-d6ff-4817-9181-3725395085f3')
   AND "executionClassification" = 'alternative' AND "executionClassifiedBy" = 'automatic';            -- esperado: UPDATE 2
COMMIT;   -- se algum não for UPDATE 2: ROLLBACK;
```
`forca` é exatamente o que `normalizePolarModality` devolve para `OTHER` + `STRENGTH_TRAINING` (regra oficial já em produção para atividades novas).

## Etapa 2 — reconciliar somente as duas (painel admin, aba "Atividades externas")
Clicar **Reclassificar** em cada uma. Resultado esperado: `corresponding` e `activeLinkTrainingSessionId` = a musculação do dia. Se vier `ambiguous` ou `alternative`: parar e relatar (nada mais é alterado). **Não** usar "Reconciliar histórico" nem "Reavaliar identidade".

## Etapa 3 — verificação
```sql
SELECT a.id, a.sport, a."executionClassification", a."executionClassifiedBy", l."trainingSessionId", l.status, l."matchMethod"
FROM "ActivityLog" a LEFT JOIN "SessionExecutionLink" l ON l."activityLogId" = a.id AND l.status = 'active'
WHERE a.id IN ('40c6cf43-fe1e-4790-b855-83da5baa93dd','d5b42e54-d6ff-4817-9181-3725395085f3');
```
Esperado: `forca`, `corresponding`, `automatic`, vínculo ativo `automatic_single_candidate` com a musculação de cada dia. No app (Treinos): as duas deixam de aparecer como "Atividade alternativa" e as musculações passam a mostrar duração e FC do Polar; o feedback manual segue igual (a etapa não toca em `WorkoutCompletion`). Aderência/frequência não mudam (a sessão já contava como feita pelo feedback). O contador de "atividades adicionais" do check-in deixa de contar as duas. As análises de semanas já entregues (retratos) não mudam; as próximas gerações usam a duração/FC dessas sessões.

## Rollback (valores originais da Etapa 0; confirmar `executionClassifiedAt` anotado)
```sql
BEGIN;
UPDATE "SessionExecutionLink" SET status = 'revoked', "revokedAt" = now(), note = 'rollback_correcao_musculacao'
 WHERE "activityLogId" IN ('40c6cf43-fe1e-4790-b855-83da5baa93dd','d5b42e54-d6ff-4817-9181-3725395085f3') AND status = 'active' AND "matchMethod" = 'automatic_single_candidate';
UPDATE "ActivityLog" SET sport = 'OTHER', "executionClassification" = 'alternative', "executionClassifiedBy" = 'automatic', "executionClassifiedAt" = '<VALOR ANOTADO NA ETAPA 0>'
 WHERE id IN ('40c6cf43-fe1e-4790-b855-83da5baa93dd','d5b42e54-d6ff-4817-9181-3725395085f3');
COMMIT;
```
Reprodução em teste: `test/integration/activity-link-student.int.spec.ts` (último caso) executa exatamente esta sequência em PostgreSQL sintético.
