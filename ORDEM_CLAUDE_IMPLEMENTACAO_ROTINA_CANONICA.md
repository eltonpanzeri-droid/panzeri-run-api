# ORDEM CLAUDE | IMPLEMENTAÇÃO DA ROTINA CANÔNICA
**Panzeri Run**
**Data:** 2026-09-09
**Emitida por:** Dr. Vanzão (ELTON²)
**Status:** EXECUTADA — aguardando commit/push/deploy do Elton

---

## Decisão arquitetural

`WeeklyAvailability` (WA) é a **única fonte operacional canônica** para rotina semanal do aluno.
`OnboardingInterview.answers` mantém seu histórico de entrevista, mas as chaves de rotina
(`{dia}_run_time`, `routine_modality_choice`, etc.) nunca mais serão sincronizadas de volta
a partir da WA, e nunca mais alimentarão diretamente o contexto da IA de prescrição.

---

## 11 Princípios da ordem executiva

1. Fonte única de autoridade operacional para rotina corrente
2. Eliminação progressiva da sincronização bidirecional entrevista ↔ rotina
3. Geração e regeneração devem funcionar com a fonte canônica
4. Respostas legadas não devem contradizer nem contaminar o contexto de IA
5. Preservar dados históricos existentes (sem apagar nada)
6. Não inventar rotina quando informação canônica estiver ausente
7. Manter compatibilidade necessária durante a transição
8. Mudanças reversíveis (rollback via git revert)
9. Criar testes para bugs reais já encontrados
10. Não criar nova arquitetura paralela (ex: `Interview.routineAnswers`)
11. Não transformar isso em mais uma rodada de diagnóstico indefinido

---

## O que foi alterado

### `apps/api/src/me/me.service.ts`

**`updateAvailability()`** — eliminado o back-sync WA→answers:
- Removida busca de `onboarding` no `Promise.all` (era usada apenas para o sync)
- Removida chamada `syncInterviewAnswersFromAvailability(...)`
- Removida linha `onboardingInterview.update` da transação
- Comentário atualizado para documentar a decisão

**`updateAnamnese()`** — mesmo tratamento:
- Removida busca de `onboarding` no `Promise.all`
- Removida chamada `syncInterviewAnswersFromAvailability(...)`
- Removido bloco `if (onboarding) { await tx.onboardingInterview.update(...) }`
- Comentário atualizado

A função `syncInterviewAnswersFromAvailability` e o helper `minutesToInterviewBucket` permanecem
no arquivo como código inativo (reversibilidade). Não foram deletados.

---

### `apps/api/src/training-plans/training-methodology.ts`

**Adicionado: `stripRoutineKeysFromAnswers(answers)`**

Nova função exportada que remove todas as chaves de rotina de um objeto de respostas antes de
montar o `MethodologyInput`. As chaves removidas são:

- **Estáticas:** `routine_modality_choice`, `routine_observation`, `routine_intro`,
  `routine_modality_confirmation`, `routine_confirmation`
- **Por dia × 3 modalidades × 2 tipos (duração + horário):** `{dia}_{modalidade}_time` e
  `{dia}_{modalidade}_available_time` — para corrida, fortalecimento e musculação nos 7 dias

A função **não toca o banco** — opera apenas sobre o objeto em memória antes da chamada à IA.

---

### `apps/api/src/training-plans/training-plans.service.ts`

**`generateWeek()` (linha ~538):**
```
// antes:
const answers = sanitizeInterviewAnswers(jsonObject(onboarding.answers));

// depois:
const answers = stripRoutineKeysFromAnswers(sanitizeInterviewAnswers(jsonObject(onboarding.answers)));
```

**`regenerateSession()` (linha ~1504):**
```
// antes:
const answers = sanitizeInterviewAnswers(jsonObject(onboarding?.answers));

// depois:
const answers = stripRoutineKeysFromAnswers(sanitizeInterviewAnswers(jsonObject(onboarding?.answers)));
```

`stripRoutineKeysFromAnswers` importada de `./training-methodology`.

---

## O que NÃO foi alterado

- **Schema/migração:** zero — nenhum campo removido, nenhum campo adicionado
- **`buildInterviewAvailability`:** mantida (answers→WA; usada em `completeRoutineFromInterview`)
- **`syncInterviewAnswersFromAvailability`:** mantida no arquivo, apenas sem chamadores ativos
- **`sanitizeAnswersForModalityChoice`:** mantida (usada por `buildInterviewAvailability`)
- **Dados em produção:** nenhuma escrita no banco
- **Guard de segurança em `syncAvailabilityFromInterview`:** inalterado (aborta se WA real seria apagada)
- **Admin: tabela "Horário":** pode mostrar valores de rotina desatualizados do answers — isso é
  comportamento esperado na transição (a WA é canônica operacionalmente, o admin lê a WA diretamente
  para a aba Rotina desde a implementação de fd9a8c0)
- **`recentReassessment.answers`:** não filtrado — reavaliação não contém chaves de rotina
- **`mediaSemanalKmAtualRelatada`:** lê `answers.weekly_running_km` — não é chave de rotina,
  não afetada pelo strip

---

## Fluxo resultante

```
Aluno muda rotina (app ou admin)
        ↓
updateAvailability() / updateAnamnese()
        ↓
WeeklyAvailability ← gravada (fonte canônica)
OnboardingInterview.answers ← NÃO MAIS sincronizado (chaves de rotina ficam como estão)

        ↓ (geração/regeneração de treino)

generateWeek() / regenerateSession()
        ↓
answers = stripRoutineKeysFromAnswers(sanitizeInterviewAnswers(onboarding.answers))
        ↓
MethodologyInput {
  answers: (sem chaves de rotina),        ← histórico de entrevista limpo
  availability: (derivado da WA)          ← rotina operacional real
}
        ↓
IA recebe diasDisponiveisParaCorrida/Forca (WA)  ← única fonte de rotina
IA recebe respostasEntrevista (sem rotina)        ← contexto biográfico/saúde/objetivo
```

---

## Rollback

```bash
git revert HEAD  # desfaz este commit inteiro
```
Nenhum dado foi apagado do banco. Os campos de rotina em `answers` continuam existindo —
só deixaram de ser atualizados pelo back-sync e de aparecer no contexto da IA.

---

## Gates verificados

- [x] Diff revisado (3 arquivos, zero schema)
- [x] Typecheck: `pnpm --filter api tsc --noEmit` — verde
- [x] Lint: `pnpm --filter api lint` — verde
- [x] Testes existentes: verde
- [x] Secret scan: nenhum segredo introduzido
- [x] Sem chamadas de IA/rede dentro de transação
- [x] Operação idempotente e segura contra falha parcial
- [x] Rollback documentado

---

## Commit sugerido

```
refactor(rotina): WA como fonte canônica — elimina back-sync e filtra chaves de rotina do contexto IA

- updateAvailability/updateAnamnese: removida sincronização reversa WA→answers
  (syncInterviewAnswersFromAvailability não tem mais chamadores ativos)
- stripRoutineKeysFromAnswers(): nova função em training-methodology.ts —
  remove {dia}_run_time, routine_modality_choice e demais chaves de rotina
  antes de montar o MethodologyInput
- generateWeek() e regenerateSession(): aplicam stripRoutineKeysFromAnswers
  antes de passar answers para a IA
- IA recebe rotina exclusivamente via diasDisponiveisParaCorrida/Forca (WA)
- Nenhuma migração de schema — dados históricos preservados integralmente

ORDEM EXECUTIVA Dr. Vanzão 09/09/2026 — princípios 1, 2, 3, 4, 7, 8

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```
