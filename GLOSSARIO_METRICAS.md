# Glossário canônico de métricas — Panzeri Run

> Fonte única de verdade para os conceitos usados no painel administrativo (Dashboard, Alunos,
> Financeiro, Funil, Treinamento). Código, API e UI devem usar esta mesma semântica. Quando um
> conceito muda de definição, atualizar aqui primeiro.
>
> Criado em 23/09/2026, a partir da auditoria pedida por Elton pra consolidar o painel. Cobre os
> conceitos que já têm implementação real; conceitos ainda não implementados (coortes, atribuição
> por origem, explorador de dados) ficam de fora até existirem.

---

## Grupos de pagamento (fonte: `apps/api/src/coach/subscription-groups.util.ts`)

Esta é a **única** função que decide em qual grupo visível um aluno cai. Antes de 23/09 essa mesma
conta (quantos são "pagantes") era recalculada de forma independente em três lugares diferentes
(`coach.service.ts` `finance()`, `dashboard()` e `dataBusinessSummary()`) — risco real de divergirem
silenciosamente. Consolidado num só arquivo.

| Grupo canônico | subscriptionStatus | Conta como pagamento real? |
|---|---|---|
| **Confirmado** | `active` ou `grace` | Sim |
| **Cortesia / liberação manual** | `manual_active` | **Não** — nunca entra em receita/MRR/"pagantes" |
| **Atrasado** | `overdue` | Não (mas ainda tem acesso liberado até cair) |
| **Pendente** | `pending` | Não — nem é "aluno" ainda, é Prospecto |
| **Cancelado** | `canceled` | Não — vira Ex-aluno |

**Regra de produto confirmada** (não é dedução técnica): cortesia nunca conta como pagamento em
nenhuma métrica financeira.

---

## Aluno / Aluno ativo

- **Aluno** (lista operacional "Alunos"): `role = student`, `subscriptionStatus` não é `pending` nem
  `canceled`, e `accountStatus != archived` (a menos que "mostrar arquivados" esteja ligado).
  Fonte: `coach.service.ts` `dashboard()`, `baseStudentWhere`.
- **Prospecto**: `role = student` com `subscriptionStatus = pending` — nunca pagou nem recebeu
  cortesia. Lista própria (`coach.service.ts` `prospects()`), fora da lista operacional principal.
- **Ex-aluno**: `subscriptionStatus = canceled`. Lista própria (`exStudents()`).
- **Aluno com programa ativo**: tem um `TrainingPlan` com `status = active` **e** `startDate` igual
  à semana corrente (`coachWeekStart(hoje)`). Um plano `active` de uma semana passada (aguardando a
  aluna gerar a próxima) não conta como "programa ativo desta semana" — ver histórico do bug real da
  aluna Eduarda (10/08).

---

## Receita — três conceitos que NUNCA devem ser confundidos

| Nome canônico | O que é | Fonte | Confiável? |
|---|---|---|---|
| **Receita recebida** | Dinheiro que já entrou de verdade, por mês | Soma de `BillingEvent.event = 'payment_confirmed'` (`.value`), só Asaas | Sim — é fato, não projeção |
| **Receita recorrente (MRR)** | `pagantes confirmados × R$ 19,90` | `estimatedMrrCents()`, calculado sobre o status **de hoje** | É projeção do valor mensal esperado, não confirma que o mês já foi cobrado |
| **Receita esperada** | *(ainda não implementada)* | — | — |

RevenueCat (compra pela loja, iOS/Android nativo) nunca entra em "receita recebida": não temos o
valor exato repassado pela Apple/Google, e nunca inventamos número.

---

## Treino — prescrito, realizado, ajustado, extra, não realizado

Fonte: `apps/api/src/coach/business-intelligence.service.ts` `getTrainingEvolution()`, que reaproveita
a mesma classificação já usada na Evolução por aluno (`evolution-metric.service.ts`), em vez de
reinventar uma segunda regra.

- **Prescrito**: `TrainingSession` cujo `structure` NÃO tem `{ source: 'student', type: 'extra' }`.
- **Extra**: `TrainingSession` com `structure = { source: 'student', type: 'extra' }` — sessão que a
  própria aluna criou, fora da prescrição da IA. Não entra em prescrito/elegível/aderência.
- **Elegível**: sessão prescrita cuja `scheduledDate` já passou. Sessão futura não é "perdida", ainda
  não chegou.
- **Realizado**: `WorkoutCompletion.status IN ('done', 'adjusted')`.
- **Ajustado**: `WorkoutCompletion.status = 'adjusted'` — subconjunto de "realizado" (feito, mas fora
  do combinado).
- **Não realizado**: sessão elegível sem `WorkoutCompletion` associado.
- **Ghost/fantasma de regeneração**: sessão de um `TrainingPlan` já `archived` (substituído por nova
  geração de semana) **sem** completion — não conta em nada, é artefato de regeneração repetida, não
  treino de verdade prescrito à aluna.

### Aderência

`aderência = realizado ÷ elegível`, sempre em percentual, sempre com o denominador explícito junto
(nunca um número solto). Cortesia e pagante entram na mesma fórmula — aderência não é métrica
financeira.

---

## Funil de cadastro — três implementações existentes (auditoria 23/09)

Existem três lugares que respondem "quantas pessoas passaram por tal etapa", com definições
ligeiramente diferentes — mantidos por enquanto porque medem coisas diferentes, mas com as
inconsistências abaixo corrigidas:

1. **`GET /analytics/funnel`** (`funnel.service.ts` `getReport()`) — o funil que aparece na tela
   "Funil de cadastro" do admin. Baseado em `FunnelEvent` (histórico de eventos do app/PWA).
2. **`GET /coach/funnel-report`** (`coach.service.ts` `signupFunnel()`) — conversão
   entrevista→pagamento baseada no **estado real** (`OnboardingInterview.completedAt`,
   `subscriptionStatus`), não em eventos. Não usado atualmente na UI do admin.
3. **`GET /coach/data/growth/funnel`** (Data Layer Fase 1) — contagem bruta de cada tipo de evento,
   sem noção de sessão/conversão.

### Bug real corrigido em 23/09 — "pessoa parada" não pode ser baseada só em evento

**Sintoma relatado**: a aluna Mariana já tinha pago e usava o app normalmente, mas continuava
aparecendo em "Pessoas paradas na entrevista".

**Causa raiz**: `stalledSessions` (função 1 acima) era calculado 100% a partir de `FunnelEvent` —
"teve `signup_completed` mas nunca teve `interview_completed`". Eventos representam o que aconteceu;
quando o evento de conclusão da entrevista não chegou a ser gravado (app antigo sem esse evento,
`sessionId` trocou por reinstalação, falha de rede no momento exato do disparo), a pessoa ficava
presa na lista **para sempre**, mesmo tendo terminado a entrevista e pago de verdade depois.

**Correção**: antes de considerar alguém "parada agora", o sistema reconcilia contra a fonte de
verdade (`OnboardingInterview.completedAt` / `subscriptionStatus` reais) — quem já avançou de
verdade sai da lista, mesmo que o evento correspondente esteja faltando no histórico. Sessões
anônimas (sem `userId` vinculado ainda) continuam confiando só no evento, único dado disponível para
elas. Ver `apps/api/src/funnel/funnel.service.ts`, função `getReport()`.

**Regra geral**: "estado atual" nunca pode vir só de `FunnelEvent`; sempre da tabela de verdade
correspondente (`User`, `OnboardingInterview`, `BillingSubscription`). `FunnelEvent` serve para
histórico, tempo entre etapas e origem — nunca para decidir onde alguém está *agora*.

---

## Evolução mensal de alunos por grupo de pagamento

Fonte: `business-intelligence.service.ts` `getMonthlyEvolution()`. Reaproveita deliberadamente o
motor determinístico de reconstrução de estado comercial já existente em
`apps/api/src/leo/commercial-state.ts` (Fundação Longitudinal, 19/09) — **não** foi criada uma
segunda lógica paralela de "estado no passado".

Para cada mês, reconstrói o `subscriptionStatus` de cada aluno no **fim daquele mês**, a partir do
log imutável de `BillingEvent` (`baseline_snapshot` + `status_changed`). Nunca usa o status de hoje
para reescrever o passado.

**Cobertura de dados**: o log de eventos (`baseline_snapshot`) começou em 16/09/2026. Meses
anteriores a essa data, para alunos sem histórico suficiente para reconstrução segura, aparecem
marcados com `coverage: 'partial'` ou `'insufficient'` — nunca como zero. "Sem dado" precisa
continuar significando "sem dado".

---

## Feedback individual de treino v2 (24/09/2026) — 16 perguntas

Reestruturação completa do questionário respondido pelo aluno em cada sessão de treino
(`WorkoutCompletion.feedbackVersion = 2`). Fonte: `apps/api/prisma/schema.prisma` (comentários
completos por campo) e `apps/api/src/workout-completions/workout-completions.service.ts`.

**Regra canônica de todas as escalas 1-5**: 5 = maior intensidade/quantidade/presença da variável
perguntada. Nunca invertida para "5 = sempre bom" — cansaço 5 é muito cansado, estresse 5 é muito
estresse, sono 5 é excelente (aqui a própria intensidade perguntada já é "bom").

| # | Pergunta | Status | Coluna (WorkoutCompletion) |
|---|---|---|---|
| 1 | Qualidade do sono | mantida | `preSleepQuality` |
| 2 | Duração do sono | nova (categórica, não é escala 1-5) | `sleepDurationCategory` + `sleepDurationHoursEstimate` |
| 3 | Irregularidade do horário de dormir | nova | `sleepScheduleIrregularity` |
| 4 | Interrupção do sono | nova | `sleepInterruption` |
| 5 | Dificuldade para dormir | nova | `sleepDifficulty` |
| 6 | Cansaço físico pré-treino | mantida | `prePhysicalFatigue` |
| 7 | Cansaço mental pré-treino | nova | `preMentalFatigue` |
| 8 | Nível de estresse | adaptada — mesma coluna, janela temporal mudou de "antes de começar" para "último dia" | `preStressLevel` |
| 9 | Vontade de treinar hoje | adaptada — mesma coluna, redação mais concreta | `preMotivation` |
| 10 | RPE (esforço percebido) | mantida (escala 1-10 preservada, nunca convertida para 1-5) | `perceivedEffort` |
| 11 | Avaliação da elaboração do treino | mantida (persistência igual; só o rótulo exibido mudou para "Péssima..Excelente") | `satisfactionElaboracao` |
| 12 | Execução em relação ao prescrito | substituída — escala nova mede direção do desvio (3 = como prescrito, referência, não "neutro"); incompatível com a antiga | `executionVsPrescribed` (nova coluna; `satisfactionCapacidade` preservada só para histórico v1) |
| 13 | Cansaço físico provocado pelo treino | substituída — escala antiga (`postWorkoutFeeling`) tinha direção oposta (5=cheio de energia); não reaproveitada para não inverter significado silenciosamente | `postPhysicalFatigue` (nova coluna; `postWorkoutFeeling` preservada só para histórico v1) |
| 14 | Cansaço mental provocado pelo treino | nova | `postMentalFatigue` |
| 15 | Experiência emocional durante o treino | substituída — antes vivia em `details.postWorkoutMood` (JSON, sem coluna própria); promovida a coluna real | `emotionalExperienceDuring` (nova coluna; `details.postWorkoutMood` preservado só para histórico v1) |
| 16 | Mudança mental pré→pós treino | nova | `mentalStateChangePrePost` |
| — | Dor/desconforto | mantida integralmente, sem mudança | sem mudança |
| — | Observação livre | mantida | sem mudança |

**Saíram como perguntas independentes** (substituídas pelas acima): "Como foi seu sono?" (virou
perguntas 1-5), "Estresse antes de começar" (virou pergunta 8), "Motivação para treinar" (virou
pergunta 9), "Execução do treino" (virou pergunta 12), "Corpo ao terminar" (virou pergunta 13),
"Terminou emocionalmente" (virou perguntas 15+16).

**Compatibilidade histórica**: nenhuma coluna v1 foi removida ou teve seu tipo alterado. Sessões
antigas (`feedbackVersion = 1`) continuam lidas corretamente em todo lugar (admin, mobile ao reabrir
feedback, prontuário da IA) — a leitura sempre prioriza o campo v2 quando presente e cai para o
campo v1 equivalente quando não.

**Onde a IA recebe essas respostas**: nunca em formato estruturado. O prompt de prescrição
(`prescription-agent.service.ts`) só recebe `historicoSemanal` (estatísticas agregadas por semana)
e `prontuarioDoAluno` (texto narrativo). As respostas individuais chegam à IA só via frase em texto
livre (`profileParts`, em `workout-completions.service.ts`), sempre com a direção da escala
explicitada por extenso para não exigir que a IA infira o sentido do número.

**Pendente, deliberadamente fora desta rodada**: índice dinâmico de Sono e de Prontidão (Elton
pediu explicitamente para não inventar fórmula agora — só garantir coleta correta e histórico), e
seções dedicadas de Sono/Prontidão na Evolução do aluno. O painel Admin (`page.tsx`, per-sessão) já
exibe todas as 16 variáveis individualmente, mas o índice composto `computeReadiness` existente
**não foi estendido** com as variáveis novas — e continua com uma inversão de escala pré-existente
(inverte cansaço/estresse pra compor o índice) que contraria a regra canônica acima. Não é uma
inversão introduzida nesta mudança; fica registrado aqui para revisão quando a Evolução for
atacada de verdade.

## O que ainda NÃO está implementado (pendente, fora desta rodada)

- Coortes por mês/origem de entrada.
- Atribuição de origem cruzada com pagamento/aderência (existe atribuição básica em
  `dataGrowthAttribution()`, mas sem cruzamento).
- Explorador de dados (métrica × dimensão × filtro livre).
- Filtro global de período compartilhado entre todas as áreas do painel.
- Receita esperada (previsão de cobrança do período).
- Indicadores automáticos de inconsistência de dados no próprio painel (seção "qualidade de dados").
