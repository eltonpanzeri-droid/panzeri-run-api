# Dicionário de métricas do admin — Fase 1 (auditoria só de leitura)

**Status:** parcial, feito em 15/10/2026 lendo o código (nenhum dado de produção foi consultado, nenhum código alterado).
**Legenda:** FATO = lido no código. INFERÊNCIA = conclusão provável que precisa de dado de produção para confirmar.

## 1. Por que os números divergem entre telas

| Métrica | Visão geral | Financeiro / resumo de negócio |
|---|---|---|
| Quem entra na conta | alunas **sem** contas arquivadas, e sem `pending` e `canceled` | **todas** as alunas, **inclusive arquivadas** (nenhum filtro de `accountStatus`) |
| Pagantes | `active` + `grace` | `active` + `grace` |
| Cortesia | `manual_active` | `manual_active` |
| Atrasado | `overdue` | `overdue` |
| Prospectos | `pending` | `pending` |

- **FATO:** os grupos de pagamento vêm de uma fonte única (`subscription-groups.util.ts`), então a definição de cada grupo é a mesma nas duas telas.
- **FATO:** a única diferença de população é o filtro de contas arquivadas: `dashboard()` exclui arquivadas, `finance()` e `dataBusinessSummary()` não.
- **INFERÊNCIA (alta confiança):** as diferenças vistas em 14/10/2026 (cortesia 9 contra 10, atrasadas 10 contra 12, prospectos 24 contra 26) são contas arquivadas. Pagantes (25) não diverge porque não há arquivada pagante. Para confirmar: contar arquivadas por `subscriptionStatus` no banco.
- **FATO:** os cartões da Visão geral também mudam se houver texto na busca ou se "Mostrar arquivados" estiver marcado, porque usam o mesmo filtro da lista.
- **Atenção a nomes parecidos:** "Alunos 44" (Visão geral) = pagantes + cortesia + atrasadas, sem pendentes e cancelados. "Planos ativos 35" (Financeiro) = pagantes + cortesia, sem atrasadas. São contas diferentes com nomes parecidos.

## 2. Por que o Funil de cadastro não fecha

- **FATO:** cada etapa conta **sessões únicas** (`sessionId`) que tiveram aquele evento nos últimos 30 dias. Não é um funil de pessoas nem de coorte: cada etapa é uma contagem independente. Por isso "Completou entrevista" (5) pode ser maior que "Iniciou entrevista" (0).
- **FATO:** o rótulo "170 pessoas" na tela conta sessões, não pessoas. Uma pessoa com dois aparelhos ou duas aberturas vira duas.
- **"Pagou: 0" (FATO):** o evento `payment_completed` é disparado pelo app **só se a aluna estiver com a tela de assinatura aberta e o status mudar de não-ativo para ativo naquela mesma abertura** (`App.tsx`, `loadBilling`). Pagamento pelo link, confirmado pelo Asaas depois, não dispara. O pagamento real está em `BillingEvent` (`payment_confirmed`), que não é usado no funil.
- **"Iniciou entrevista: 0" (INFERÊNCIA):** o evento só dispara se a primeira resposta for no passo 0 e no modo `onboarding` (`App.tsx`). Depois da entrevista rápida de 18/08, é provável que o fluxo atual não passe por essa condição. Confirmar abrindo o fluxo.
- **Consequência:** as etapas "Iniciou entrevista" e "Pagou" não são confiáveis hoje. "Abriu o app", "Começou conta" e "Criou conta" parecem consistentes, mas contam sessões.
- **Alternativa confiável (FATO):** `signupFunnel()` (usado em outra rota) conta pelo banco: nunca iniciou entrevista, entrevista sem pagamento, pagou (sem cortesia). Essa é a base para refazer o funil.

## 3. Definições por métrica (versão inicial)

| Número na tela | Definição | Fonte | Confiável? |
|---|---|---|---|
| Alunos | role aluna, status fora de `pending`/`canceled`, sem arquivadas | `User` | sim |
| Pagamento em dia | `active` ou `grace`, sem arquivadas | `User.subscriptionStatus` | sim |
| Cortesia / liberação manual | `manual_active`, sem arquivadas | `User.subscriptionStatus` | sim |
| Pagamento atrasado | `overdue`, sem arquivadas | `User.subscriptionStatus` | sim |
| Prospectos | `pending`, sem arquivadas | `User.subscriptionStatus` | sim |
| Planos ativos / Pagantes / Cortesias / Atrasados (Financeiro) | mesmos grupos, **com arquivadas** | `User` | sim, mas população diferente |
| Receita recorrente (MRR) | pagantes × R$ 19,90 | calculado | projeção, não valor recebido |
| Receita recebida no mês | soma de `payment_confirmed` do Asaas | `BillingEvent` | só Asaas; histórico confiável só a partir de 16/09/2026 |
| Funil: abriu, começou conta, criou conta | sessões únicas com o evento | `FunnelEvent` | parcial (sessões, não pessoas) |
| Funil: iniciou entrevista, pagou | sessões únicas com o evento | `FunnelEvent` | **não confiável** (ver seção 2) |

## 4. Decisões de Elton (15/10/2026)

1. **População padrão:** todos os números sem contas arquivadas. **Feito** em `finance()` e `dataBusinessSummary()` (constante `STUDENT_METRICS_POPULATION`, teste `metrics-population-archived.spec.ts`). Arquivadas à parte: ainda não mostradas em nenhuma tela.
2. **Funil:** refazer pelas contas no banco (pessoas, com datas), em vez de contar sessões. As etapas de evento ficam como apoio para a parte anônima antes do cadastro. **A fazer** na Fase 5 (visões Marketing e Empresário).
3. **Nomes:** um nome só por conceito, com a definição junto do número. **Iniciado:** "Planos ativos" (Financeiro) virou "Com acesso em dia" (pagantes + cortesias, sem atrasadas), para não se confundir com "Alunos" (inclui atrasadas). Demais nomes: revisar ao refazer cada tela.

## 5. O que falta nesta auditoria

- Contar arquivadas por status no banco para confirmar a seção 1 (precisa de acesso de leitura; não foi feito).
- Reconciliar receita recebida contra o Asaas.
- Revisar `dataBusinessSummary()` e os endpoints `/coach/data/*`.
- Verificar o fluxo atual da entrevista para confirmar `interview_started`.
