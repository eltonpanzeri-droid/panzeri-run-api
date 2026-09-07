# Prontuário do Aluno — Arquitetura e funcionamento

**Status:** `active`  
**Data:** 2026-09-07  
**Escopo:** documentação de arquitetura — não altera código

---

## O que é

O prontuário é a memória longitudinal do aluno dentro do sistema. Em vez de o agente de prescrição reler todo o histórico bruto de treinos, feedbacks e dirizes a cada geração, ele lê um **resumo condensado e continuamente atualizado** sobre aquele aluno.

Analogia: é o que um treinador experiente sabe de cor sobre o atleta — não a ficha clínica completa, mas o essencial: padrões, lesões passadas, o que funcionou, o que preocupa.

---

## Arquitetura em duas camadas

```
┌─────────────────────────────────────────────────────────────────────┐
│  CAMADA 1 — Eventos brutos (StudentProfileEvent)                    │
│  Zero custo de IA. Gerado por código puro em cada ação real.        │
│  Acumula silenciosamente. Índice: (userId, summarizedAt).           │
└─────────────────────────┬───────────────────────────────────────────┘
                          │  antes de cada geração de semana
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│  refreshProfile() — Agente de condensação (Claude Sonnet)           │
│  Só chama IA se houver eventos com summarizedAt = null.             │
│  Lê: resumo atual + eventos novos. Devolve: resumo atualizado.      │
│  Marca eventos processados com summarizedAt = now().                │
└─────────────────────────┬───────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│  CAMADA 2 — Resumo condensado (StudentProfile.summary)              │
│  Texto em prosa ou tópicos. Limite hard: 6.000 caracteres.          │
│  Lido pelo agente de prescrição como campo prontuarioDoAluno.       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Tabelas no banco

### `StudentProfileEvent` — eventos brutos

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | uuid | PK |
| `userId` | String | FK → User |
| `code` | String | Código do tipo de evento (ver seção abaixo) |
| `content` | String | Texto descritivo gerado por código, sem IA |
| `createdAt` | DateTime | Quando o evento ocorreu |
| `summarizedAt` | DateTime? | Null = ainda não foi condensado no resumo |

Índice: `(userId, summarizedAt)` — usado para buscar eficientemente os eventos pendentes de condensação.

### `StudentProfile` — resumo condensado

| Campo | Tipo | Descrição |
|---|---|---|
| `userId` | String | PK = FK → User (um por aluno) |
| `summary` | String | Texto condensado pelo agente |
| `updatedAt` | DateTime | Atualizado automaticamente pelo Prisma |

---

## Códigos de evento

Definidos em `student-profile.service.ts:ProfileEventCode`.

| Código | Disparado por | Onde no código |
|---|---|---|
| `ONBOARDING_COMPLETED` | Conclusão da entrevista inicial | `me.service.ts` |
| `WEEK_GENERATED` | Geração de semana de treino | `training-plans.service.ts` |
| `WORKOUT_COMPLETED` | Registro de treino pelo aluno (com todo o feedback estruturado) | `workout-completions.service.ts` |
| `DIRECTIVE_ADDED` | Treinador adiciona diretriz via Gerente Técnico | `technical-manager-agent.service.ts` |
| `STUDENT_OBSERVATION` | Observação livre do aluno (campo da entrevista ou aba de observações) | `me.service.ts`, `observations.service.ts` |
| `PAIN_REPORT` | Relato de dor pelo aluno | `pain-reports.service.ts` |
| `REASSESSMENT_COMPLETED` | Reavaliação concluída | `reassessment.service.ts` |

**Regra invariante:** `recordEvent()` é sempre fire-and-forget (`.catch(() => undefined)`) — falha aqui nunca bloqueia o fluxo principal.

---

## Fluxo de geração de semana

```
doGenerateCurrentWeekOnDemand()
    │
    ├── Busca dados estruturados (dirizes, observações, histórico, strava...)
    │
    ├── studentProfile.refreshProfile(userId)
    │       ├── busca eventos com summarizedAt = null
    │       ├── se vazio → retorna resumo atual sem chamar IA (zero custo)
    │       └── se há eventos novos → chama Claude Sonnet, atualiza summary,
    │               marca eventos como summarizedAt = now()
    │
    └── Passa studentProfileSummary para o agente de prescrição
            como campo prontuarioDoAluno no JSON de entrada
```

**Arquivo:** `training-plans.service.ts` linha ~616–661.

---

## Regras do agente de condensação

O system prompt em `student-profile.service.ts:buildSystemPrompt()` define as regras que o Claude segue ao atualizar o resumo:

### 1. Nunca apaga fatos

Ausência de relato novo ≠ resolução. Se o aluno relatou dor no pé e depois parou de mencionar, o resumo continua dizendo que houve esse relato, com algo como "sem relatos recentes sobre isso desde [período]". O agente **nunca** conclui que a dor acabou por falta de menção.

### 2. Tópicos recorrentes viram linha do tempo

Um segundo relato do mesmo assunto reforça que ainda está presente. Relatos seguidos indicam persistência. Melhora relatada é uma continuação da linha — nunca substitui o histórico.

Exemplo correto:
> "Relatou dores recorrentes no joelho entre março e maio, com melhora relatada desde então"

Exemplo errado:
> "Sem dores no joelho" ← apagaria que a dor existiu e foi relevante

### 3. Dirizes e observações do treinador têm prioridade máxima

Conteúdo com código `DIRECTIVE_ADDED` ou `STUDENT_OBSERVATION` é preservado quase literalmente no resumo, mesmo que isso deixe essa seção mais longa que o resto. Parafrasear demais pode perder um detalhe que muda a prescrição.

### 4. Feedback de treino

- Feedback curto → mantém como está
- Feedback longo → condensa na frase essencial (incomodo relatado, dificuldade, sensação geral)

### 5. Compactação por recência

Com o tempo, tópicos antigos claramente resolvidos e inativos podem ser comprimidos em menos palavras — nunca apagados. Tópicos dos últimos ~2 meses recebem mais detalhe. Exemplo de compactação aceitável um ano depois:

> "Teve episódio de dor no joelho em 2026, resolvido" (em vez do parágrafo original)

### 6. Tom e formato

Prosa ou tópicos curtos, o que for mais compacto. Cobre:
1. Perfil básico e histórico relevante
2. Dirizes ativas do treinador
3. Observações recentes
4. Linha do tempo de dores/desconfortos
5. Padrões de consistência e evolução

**Limite hard:** 6.000 caracteres (`PROFILE_SUMMARY_HARD_LIMIT`). Aplicado por truncagem após parsear — nunca rejeita uma resposta boa por causa desse limite.

---

## Como o agente de prescrição usa o prontuário

O campo `prontuarioDoAluno` chega no JSON de entrada do agente de prescrição (junto com histórico semanal, dirizes, check-in etc.). O prompt instrui o agente a usar o prontuário como "o que o treinador já sabe de cor sobre esse aluno" — complemento dos dados estruturados, não substituto.

**O prontuário não decide treino.** A decisão é sempre do agente de prescrição. O prontuário fornece contexto longitudinal que seria caro e impreciso rededuzir toda semana a partir dos dados brutos.

---

## O que o prontuário NÃO é

- **Não é o histórico completo** — é um resumo. O histórico bruto (`StudentProfileEvent`) continua no banco e pode ser relido quando necessário.
- **Não substitui dirizes** — dirizes ativas são passadas separadamente e têm precedência sobre qualquer inferência do prontuário.
- **Não é output de IA para o aluno** — o aluno nunca lê o prontuário. É exclusivamente para consumo interno pelos agentes.
- **Não é prescritivo** — o agente de condensação organiza e preserva fatos, não decide treino nem interpreta como um treinador faria.

---

## Pontos de extensão conhecidos (não implementados)

- **Recuperação contextual seletiva:** hoje o prontuário é passado inteiro para o agente de prescrição. Uma camada de recuperação poderia identificar quais seções são relevantes para a semana atual (ex: só trazer dores recentes se houver flag de dor ativa; só trazer histórico de prova-alvo se houver prova próxima) — reduzindo tokens e ruído.
- **Acesso direto aos eventos brutos:** hoje o agente de prescrição nunca lê `StudentProfileEvent` diretamente. Uma ferramenta de busca seletiva no histórico poderia complementar o resumo em situações específicas (ex: "quanto o aluno correu em semanas de viagem?").
- **Resumo estruturado vs. prosa:** hoje é texto livre. Um schema com campos (dores, dirizes, padrões, objetivos) permitiria recuperação seletiva mais precisa.

---

## Arquivos relevantes

| Arquivo | Responsabilidade |
|---|---|
| `apps/api/src/training-plans/student-profile.service.ts` | `recordEvent()`, `refreshProfile()`, `getSummary()`, system prompt do agente de condensação |
| `apps/api/prisma/schema.prisma` | Modelos `StudentProfileEvent` e `StudentProfile` |
| `apps/api/src/training-plans/training-plans.service.ts` | Chama `refreshProfile()` antes de cada geração; passa `studentProfileSummary` para o agente |
| `apps/api/src/training-plans/training-methodology.ts` | Tipo `WeeklyDecisionInput.studentProfileSummary` |
| `apps/api/src/training-plans/prescription-agent.service.ts` | Campo `prontuarioDoAluno` no JSON de entrada do agente de prescrição |
| `apps/api/src/me/me.service.ts` | `ONBOARDING_COMPLETED` + `STUDENT_OBSERVATION` (rotina) |
| `apps/api/src/workout-completions/workout-completions.service.ts` | `WORKOUT_COMPLETED` |
| `apps/api/src/technical-manager/technical-manager-agent.service.ts` | `DIRECTIVE_ADDED` |
| `apps/api/src/observations/observations.service.ts` | `STUDENT_OBSERVATION` |
| `apps/api/src/pain-reports/pain-reports.service.ts` | `PAIN_REPORT` |
| `apps/api/src/reassessment/reassessment.service.ts` | `REASSESSMENT_COMPLETED` |
