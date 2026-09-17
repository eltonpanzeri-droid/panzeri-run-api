# 0007 — Treino Extra: formulário sem perguntas de feedback

**Status:** RESOLVIDO (17/09/2026)

---

## Padrão de falha

Modal "Registrar Treino Extra" coletava apenas: motivo, modalidade, data, distância, tempo, nota e RPE. Não coletava nenhuma das 10 perguntas de feedback da sessão (sono, cansaço, estresse, motivação, satisfação com elaboração, satisfação com execução, sensação física, sensação emocional, dor, timing da dor).

Efeito prático: aluno precisava de dois passos para registrar um treino extra completo — registrar no modal (sem feedback), depois abrir o card da sessão para preencher o CompletionForm separado. Na prática ninguém faz o segundo passo, então os treinos extras nunca tinham dados de feedback. Isso afetava a evolução do atleta: a IA não tinha contexto sobre como o aluno se sentiu nos treinos adicionais.

---

## Histórico de rodadas

### Rodada 1 — 17/09/2026
**Diagnóstico:** `extraForm` state tinha apenas 7 campos. Modal terminava no RPE. `saveExtraSession()` não enviava campos de feedback. API `addStudentExtraSession` não os aceitava.
**Correção:**
- `extraForm` expandido com todos os campos: preSleepQuality, prePhysicalFatigue, preStressLevel, preMotivation, satisfactionElaboracao, satisfactionCapacidade, postWorkoutFeeling, postWorkoutMood, painFlag, painTiming
- Modal UI: adicionadas seções "Como voce chegou", "Como foi o treino", "Dor e observacoes" com ScaleStr, ScalePicker, OptionChips (reutilizando os mesmos componentes do CompletionForm)
- `saveExtraSession()`: passa todos os campos para a API
- Controller e service da API: aceitam e persistem todos os campos no WorkoutCompletion (postWorkoutMood vai para `details` por ser campo sem coluna própria no schema)
- `ScaleStr` e `OptionChips` movidos de local (dentro de CompletionForm) para nível de módulo
- `feedbackVersion: 1` marcado no WorkoutCompletion criado pelo extra
**Resultado:** RESOLVIDO

---

## Causa raiz

Feature de treino extra foi implementada antes do sistema de feedback v1 (11/09). Quando o feedback v1 foi adicionado, o modal de treino extra não recebeu os mesmos campos — só o CompletionForm foi atualizado.

---

## Aprendizado sistêmico

**Regra permanente:** Qualquer fluxo que cria um WorkoutCompletion deve coletar os mesmos campos de feedback que o CompletionForm principal. Ao adicionar novos campos de feedback, verificar todos os pontos de criação de WorkoutCompletion: `saveCompletion` (App.tsx), `addStudentExtraSession` (training-plans.service.ts), e qualquer outro endpoint que crie completions diretamente.

---

## Arquivos alterados

- `apps/mobile/App.tsx` — `extraForm` state expandido; `ScaleStr`/`OptionChips` movidos para nível de módulo; UI do modal com seções de feedback; `saveExtraSession()` com todos os campos; tipo `SessionStructure` com variante `'extra'`; `SessionPrescription` retorna null para extras
- `apps/api/src/training-plans/training-plans.controller.ts` — DTO com todos os campos de feedback
- `apps/api/src/training-plans/training-plans.service.ts` — input type + WorkoutCompletion.create com todos os campos
