# Etapa 1.2a — Resumo técnico para revisão independente (Astra)

Data: 09/10/2026 · Commits: `7842ecf` (etapa) e `e009384` (correção cosmética), ambos enviados à `main`. **Sem deploy em produção.**
Escopo: rastreabilidade determinística das prescrições. Não inclui 1.2b (`basis`/`intent`/`expected`) nem Etapa 2.

## 1. Objetivo e invariantes
- Toda semana gerada (e toda regeneração de dia) grava, **na mesma transação** da criação do programa, um pacote com o contexto efetivamente enviado à IA e as decisões resultantes.
- Prompts e modelos de IA **não foram alterados** (hashes dos prompts congelados em teste unitário).
- Registros existentes não são alterados (migration só adiciona).
- Se a gravação da trilha falhar, a geração é abortada (atomicidade deliberada: nenhuma prescrição sem registro).

## 2. Arquivos alterados (26; +1741/−38) — `apps/api`
Núcleo (novos): `src/training-plans/prescription-trace.ts` (puro: índice de evidências, hashes, decisões, retenção), `prescription-trace.service.ts` (persistência, consulta, retenção), `prescription-trace.controller.ts` (`GET /coach/students/:studentId/prescription-trace`, papéis coach/admin).
Integração: `training-plans.service.ts` (captura das chamadas à IA e persistência na transação; regeneração de dia), `prescription-agent.service.ts` (apenas registra prompt/modelo enviados; texto dos prompts intacto), `training-plans.module.ts`, `student-information-context.ts` e `student-profile.service.ts` (ids dos relatos/eventos entregues), `account-deletion.service.ts` (exclusão), `provider-data-deletion.service.ts` (redação por provedor).
Schema/config: `prisma/schema.prisma`, migration nova, `.env.example`, `package.json`, `jest*.config.ts`.
Testes: ver §5. Docs: `PRONTUARIO.md`.

## 3. Tabelas e migration
Migration `20261009120000_prescription_trace` — aditiva: 2 `CREATE TABLE`, 8 `CREATE INDEX`, 1 FK (decisão → pacote, `ON DELETE CASCADE`). Referências a User/Plan/Session são "soft" (sem FK), para a trilha não bloquear exclusões.
- `PrescriptionEvidencePackage`: `userId`, `planId`, `sessionId?`, `kind` (weekly|day_regeneration), `schemaVersion`, `methodologyVersion`, `modelIds[]`, `agentInputHash`, `evidence` (índice: cada item com `delivery` = delivered | delivered_unprocessed | absent e `storage` = complete | partial | reference_only, `provider?`, `redacted?`), `contextGaps`, `agentInput?` (prompt exato por chamada + hashes; teto 512 KB, acima disso fica nulo), `agentInputPurgedAt?`.
- `PrescriptionDecision`: `packageId`, `userId`, `planId`, `sessionId?`, `kind` (week|session), `weekday?`, `modality?`, `summary`, `changeFromPrevious?`, `rationale?`, `intent?`, `expected?`, `basis?` (os três últimos reservados à 1.2b), `traceStatus` (padrão `absent`).
A consulta devolve também o desfecho de cada sessão (executed, missed, objective_only, no_record, session_not_found), calculado na leitura.

## 4. Retenção, exclusão e backup
- **Retenção:** `PRESCRIPTION_TRACE_INPUT_RETENTION_MONTHS` (padrão 12; `off`/`0`/inválido desativa). Job diário (e uma execução 2 min após o boot) zera só `agentInput` expirado e marca `agentInputPurgedAt`; índice de evidências e decisões permanecem.
- **Desconectar provedor:** não toca na trilha.
- **Exclusão explícita de dados do provedor:** redige os itens de evidência daquele provedor nos pacotes do aluno (`redacted`).
- **Exclusão de conta:** `prescriptionDecision` e `prescriptionEvidencePackage` entram no início de `ACCOUNT_DELETE_ORDER`.
- **Backup:** tabelas incluídas (não estão em `BACKUP_EXCLUDED_TABLE_DATA`); testado com `pg_dump`/`pg_restore` reais, inclusive reaplicação de tombstone posterior ao snapshot.

## 5. Testes e resultados
- Unitário `test/prescription-trace.spec.ts`: 13/13.
- Integração (`npm run test:integration`, PostgreSQL 17.11 portátil, 127.0.0.1:55432, banco `panzeri_test`, dados sintéticos; trava recusa host não-loopback e banco sem sufixo `_test`): 16/16 em 4 arquivos — ambiente e migrations, backup/restauração, trilha (geração real com IA simulada, regeneração de dia, rollback atômico, retenção, desconectar vs excluir, exclusão de conta, app sem trilha legada), boot real do `AppModule`.
- Suíte antiga: 2 falhas já existentes antes da etapa; 3 testes de webhook/módulo de mensagens oscilam sob carga e passam isolados.
- Instruções: `apps/api/test/integration/README.md`.

## 6. Divergência na migration antiga `20260916164659_add_data_layer_phase_0` (0916)
- **Fato:** a versão original (commit `617788a`, 16/09) recriava a coluna `User.firstPaidAt`, que a migration `20260915120000` já criara → falha "already exists" ao aplicar em sequência. Foi corrigida em `db3bb6c` (a versão atual só cria `BillingEvent` e `acquisitionAttribution`). A original está guardada em `test/integration/fixtures/phase0-original-617788a.sql`; o teste prova que ela falha e que a atual passa.
- **Efeito:** a cadeia atual aplica do zero (88 migrations). Se produção aplicou a versão original, a migration teria falhado/sido marcada como não concluída; se aplicou a corrigida, o checksum no banco difere do arquivo atual só se o arquivo foi editado depois. **Desconhecido sem consulta em produção.**
- **Outras diferenças migrations × schema** (conhecidas, não corrigidas, travadas no teste): FK `MenstrualCycleLog_profileId_fk` só nas migrations; `BillingEvent.value` numeric(10,2) vs Decimal(65,30); alguns `DEFAULT` de `updatedAt`/`evidence`/`adjustmentReasons`; nome truncado de índice de `ActivityTimeSeriesPoint`. Corrigir exige migration nova e autorização.
- **Nada foi reescrito automaticamente.**

### Consulta SOMENTE LEITURA para produção (a ser executada por Elton)
```sql
SELECT migration_name, started_at, finished_at, rolled_back_at, applied_steps_count,
       left(checksum, 12) AS checksum_prefix, left(logs, 200) AS logs
FROM _prisma_migrations
WHERE migration_name IN ('20260915120000_add_funnel_journey_and_first_paid', '20260916164659_add_data_layer_phase_0')
   OR finished_at IS NULL OR rolled_back_at IS NOT NULL
ORDER BY started_at;
```
Interpretação: `finished_at` preenchido e `rolled_back_at` nulo para a 0916 = aplicada com sucesso (confirmar também `\d "BillingEvent"` existe); `finished_at` nulo ou `rolled_back_at` preenchido = migration falhou/foi revertida em produção e precisa de decisão antes de qualquer deploy. Qualquer linha retornada pelo filtro `finished_at IS NULL OR rolled_back_at IS NOT NULL` merece análise.
Nenhuma alteração foi executada em produção; só esta consulta de leitura é proposta.

## 7. Pendência antes do deploy: textos legais
Termos de Uso e Política de Privacidade ainda **não** mencionam: (a) o registro da prescrição com o texto enviado à IA; (b) retenção de até 12 meses da entrada completa (configurável); (c) exclusão junto com a conta e redação ao pedir exclusão de dados de um provedor. Atualizar e, idealmente, passar por revisão jurídica **antes** do deploy desta etapa.

## 8. Limitações conhecidas
- Revisão independente com contexto separado ainda não realizada (é este pedido).
- `basis`/`intent`/`expected` vazios até a 1.2b; itens de evidência por provedor ainda não existem (dados de dispositivo entram como variáveis agregadas).
- Pendências da 1.1 seguem abertas: precedência estruturada entre informação atual/antiga/resolvida, contexto matemático e check-in na regeneração de dia, critérios objetivos para bloquear vs prescrever com cautela.
- Escrita atômica: falha da trilha aborta a geração (decisão consciente; revisar se preferirem degradar).

---

# Correções após a revisão do Astra (10/10/2026) — pendências bloqueantes da 1.2a

Escopo: somente as pendências da 1.2a. Sem 1.2b, sem Etapa 2, sem alteração de prompts ou modelos de IA (hashes dos prompts congelados continuam passando), sem push e sem deploy.

## C1. Exclusão de dados de provedor alcança o texto enviado à IA e os derivados
- **Causa da falha apontada:** a redação atuava só em itens do índice com `provider` preenchido, e nenhum item nascia com `provider`; o texto enviado à IA (`agentInput`) nunca era tocado. Os dados de dispositivo entram no prompt como agregados (`activity.avgPaceSecondsKm`, `activity.cadenceAvg`).
- **Solução:** (a) o pacote passa a registrar a **proveniência** (`sourceProviders`: provedores com atividade na janela dos agregados, só quando o prompt tem agregado de atividade com dados); (b) itens agregados do índice carregam `providers`; (c) na exclusão explícita de um provedor, para cada pacote que o envolve: itens diretos e agregados viram marcador (`redacted:<provedor>`, sem valor, data nem referência) e os agregados `activity_objective` são removidos **do texto exato guardado** (variável, legenda, referências de domínio, avisos de comparabilidade), preservando todo o resto (relatos, diretrizes, entrevista, histórico, agregados de outras fontes); (d) marcador auditável em `agentInputRedactions` (provedor, instante, ids removidos, contagens; nunca o conteúdo); hash original mantido + hash do texto resultante. Pacote sem proveniência (anterior ao campo) é tratado de forma conservadora; prompt que não é JSON é removido por inteiro e marcado; pacote já expurgado pela retenção só tem o índice redigido. Idempotente; outro aluno e pacotes que não envolvem o provedor não são tocados; **desconectar continua não tocando na trilha**.
- **Limite honesto:** os agregados são médias sobre o conjunto de atividades; não é possível separar a parte de um provedor — saem **por inteiro** (inclusive a parte vinda de outro provedor). Valores de treino copiados pelo aluno no próprio feedback (já tratados pela exclusão existente) não são reprocessados dentro de pacotes antigos.
- **Provas:** unit `test/prescription-trace-hardening.spec.ts` (15) e integração `prescription-trace-hardening.int.spec.ts` (pacotes reais gerados com contexto realista; checa que valores `437.25`/`171.6`, ids e datas não sobram em lugar nenhum do pacote, que o resto permanece, marcador sem valores, idempotência, isolamento entre alunos/provedores, proveniência desconhecida, retenção, desconexão intacta).

## C2. Versões das sessões regeneradas
- **Causa:** a regeneração reescrevia a sessão no lugar; a trilha só guardava um resumo da anterior e o resultado era lido do estado atual da sessão (atribuição retroativa à prescrição errada).
- **Solução:** cada decisão de sessão guarda o **estado completo** da sessão naquele momento (`sessionSnapshot` + hash canônico). A regeneração lê o estado anterior **na mesma transação** (com a linha da sessão travada) e o grava por inteiro (`previousSnapshot`, `previousDecisionId`, e `untracedChangeSincePreviousVersion` quando houve mudança fora da trilha, p. ex. edição manual do treinador). `getTrace` devolve `sessions[].versions[]` com vigência (`validFrom`→`validUntil`) e o resultado **de cada versão**: atividade objetiva pertence à versão vigente quando **começou**; o registro do aluno pertence à **última** versão, por invariante (sessão registrada não pode ser regenerada — verificado na transação, que agora relê o registro com a sessão travada). Versão anterior sem trilha (sessão antiga) é reconstruída do estado preservado e marcada `traced:false`. Edições do treinador após o registro (`prescriptionHistory`) são sinalizadas.
- **Provas (integração):** regenerada antes e depois de atividades objetivas e antes do registro (v1 preservada por inteiro, cada resultado na sua versão, decisões mostram só o resultado da própria vigência); registro do aluno **durante** a geração da IA (nada reescrito, nenhuma trilha); edição manual entre versões; sessão sem trilha anterior.
- **Limite honesto:** `WorkoutCompletion` não tem instante de criação confiável (`completedAt` é escolhido pelo aluno/dispositivo); por isso o registro é atribuído pela invariante, não por horário.

## C3. Rastreabilidade obrigatória
`PrescriptionTraceService` deixou de ser opcional (sem `@Optional()`): sem ele o Nest nem sobe. Além disso, `requireTrace()` recusa a geração semanal e a regeneração de dia **antes de qualquer chamada de IA** se o serviço estiver ausente ou incompleto (nenhum custo de IA, nenhum plano, nenhuma sessão alterada). A gravação continua dentro da transação do programa (rollback comprovado). Os testes antigos que construíam o serviço sem a trilha foram atualizados (`test/helpers/trace-stub.ts`).

## C4. Migration 0916 — verificação somente leitura
`VERIFICACAO_MIGRATIONS_PRODUCAO.md` + `apps/api/scripts/verify-migrations-production.sql` (consulta, sessão forçada a somente-leitura) + `apps/api/scripts/verify-migration-checksums.cjs` (comparação **offline** dos checksums completos com todas as versões do git; não acessa banco). Cobre as cinco migrations que tiveram o arquivo editado. **Não executado em produção.**

## C5. Textos legais
`RASCUNHO_TEXTOS_LEGAIS_RASTREABILIDADE.md`: parágrafos propostos (IA, retenção de até 12 meses, desconexão × exclusão, exclusão de conta, termos), tabela do que é guardado e quando é apagado, e pontos para o advogado. **Nada publicado** (`legal-content.ts` intacto).

## Migration nova
`20261010120000_prescription_trace_hardening` — aditiva: 4 colunas anuláveis (`sourceProviders`, `agentInputRedactions` no pacote; `sessionSnapshot`, `sessionSnapshotSha256` na decisão). Pacotes existentes ficam com `sourceProviders = NULL` (tratado como "pode conter qualquer provedor"). A migration anterior (`20261009120000`, já enviada) **não foi alterada**.

---

# Carga semanal (weekly_training_load) — implementação das decisões D1-D4 (10/10/2026)
Detalhes técnicos e testes em `PROPOSTA_WEEKLY_TRAINING_LOAD_EXCLUSAO_PROVEDOR.md` (seção 8). Resumo: a exclusão explícita de dados de um provedor invalida (sem recalcular) os agregados de carga semanal que dependem dele — extras do relógio, valores copiados do relógio em sessões prescritas (mesmo sem edição) e o ACWR quando qualquer componente da janela depende do provedor — preservando volume prescrito, treinos prescritos e registros independentes do aluno, com marcador auditável sem valores. Aviso sobre invalidação de indicadores históricos incluído no rascunho da Política (item 2.4). Sem migration, sem alteração de prompts/modelos.
