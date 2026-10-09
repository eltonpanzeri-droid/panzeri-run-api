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
