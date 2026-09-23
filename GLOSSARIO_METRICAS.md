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

## O que ainda NÃO está implementado (pendente, fora desta rodada)

- Coortes por mês/origem de entrada.
- Atribuição de origem cruzada com pagamento/aderência (existe atribuição básica em
  `dataGrowthAttribution()`, mas sem cruzamento).
- Explorador de dados (métrica × dimensão × filtro livre).
- Filtro global de período compartilhado entre todas as áreas do painel.
- Receita esperada (previsão de cobrança do período).
- Indicadores automáticos de inconsistência de dados no próprio painel (seção "qualidade de dados").
