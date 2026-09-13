# Erro Persistente #0004 — Programa invisível (Lucelane)

**Aluna:** Lucelane  
**Problema relatado:** 12/09/2026 — aluna ativa não consegue ver seu programa de treino no app.  
**Aberto em:** 12/09/2026  
**Status:** ABERTO em 13/09/2026 (3 tentativas, nenhuma confirmada como solução)

---

## Sintoma

Lucelane, aluna ativa com programa gerado e histórico de treinos, não consegue acessar o programa
no app — nem no iOS nem no Android.

- **12/09 (primeiro relato)**: tela de pagamento ("Seu acesso está quase pronto" com CPF e "Ativar
  minha assinatura"). Isso acontece quando `!plan && !hasSubscriptionAccess`.
- **13/09 (após deploys)**: iOS mostrando "Ainda não liberado"; Android mostrando tela de pagamento
  (ou vice-versa — não confirmado com precisão). Indica que a API está retornando `notGenerated: true`.

---

## Linha do tempo das tentativas

### Tentativa 1 — 12/09/2026 (diagnóstico, sem code fix)

**Diagnóstico tentativo:**
- Hipótese A: ela está logando com um e-mail diferente do e-mail de aluna (conta de testadora sem
  assinatura).
- Hipótese B: `subscriptionStatus` da conta dela está como `'pending'` — falha de sync do cron de
  billing.

**Ação:** nenhuma correção de código. Aguardava verificação no painel admin para confirmar a causa.

**Resultado:** não verificado antes do próximo commit mudar o comportamento.

---

### Tentativa 2 — 12/09/2026 (commit `6215363` — introdução de `isDetailedPlan`)

**Contexto:** na mesma sessão em que a aba Rotina foi adicionada ao admin, foi introduzida a função
`isDetailedPlan()` em `loadPlan()` de `App.tsx`. A intenção era distinguir "planos em formato antigo"
(sem `structure.type`) de planos normais — para evitar que planos antigos caíssem na tela de pagamento.

**O que `isDetailedPlan` fazia:**
```typescript
function isDetailedPlan(plan: WeekPlan) {
  return plan.sessions.every(
    (session) => session.structure?.type === 'run'
      || session.structure?.type === 'strength'
      || session.structure?.type === 'aerobic'
  );
}
```

**Bug introduzido:** `isDetailedPlan` retornava `false` para planos válidos, porque:
- O backend **nunca cria** `structure.type === 'aerobic'` — apenas `'run'` e `'strength'`
- `'aerobic'` existe como tipo TypeScript mas nunca aparece em dados reais de produção
- Qualquer sessão com `structure.type` diferente desses 3 valores retornava `false` da função

Resultado: `loadPlan()` caia no ramo de `notGenerated`, exibindo "Ainda não liberado" ou tela de
pagamento, mesmo com plano válido no banco.

**Resultado:** CAUSOU a regressão. Este commit introduziu o problema, não o resolveu.

---

### Tentativa 3 — 13/09/2026 (commit `0202873` — filtro de sessões de aluno)

**Teoria:** Lucelane tinha adicionado uma sessão extra pelo app (via `addStudentExtraSession`), que
criaria uma sessão com `structure.type === 'extra'`. Essa sessão quebraria o `isDetailedPlan`.

**Fix aplicado:**
```typescript
function isDetailedPlan(plan: WeekPlan) {
  return plan.sessions
    .filter((session) => (session.structure as { source?: string })?.source !== 'student')
    .every(
      (session) => session.structure?.type === 'run'
        || session.structure?.type === 'strength'
        || session.structure?.type === 'aerobic'
    );
}
```

**Por que estava errada:** Elton confirmou que Lucelane não adicionou nenhum treino extra. A teoria
estava incorreta. O filtro não ajudou porque o problema não era sessão extra.

**Resultado:** Não resolveu.

---

### Tentativa 4 — 13/09/2026 (commit `be1ec20` — remoção de `isDetailedPlan`)

**Diagnóstico atualizado:** o `isDetailedPlan` era proteção desnecessária — a API (`current()`) já
valida o plano antes de devolvê-lo. Se o plano chegou no frontend, é porque é válido. Não existe
"plano em formato antigo" sendo devolvido por `current()` em produção.

**Fix aplicado:** remoção completa de `isDetailedPlan()` de `loadPlan()` e `generatePlan()`.
Comportamento: se a API devolveu um plano, exibe o plano. Ponto.

**Deploy:** realizado por Elton na mesma sessão.

**Resultado:** AINDA não resolveu. Lucelane continua sem ver o programa no Android e no iPhone.

---

## Estado atual e hipóteses abertas

A remoção de `isDetailedPlan` corrigiu o erro de código, mas a Lucelane continua sem ver o plano.
Isso significa que o problema NÃO é o `isDetailedPlan` — é outra coisa.

**O fluxo atual de `loadPlan()` (pós-`be1ec20`):**
```
GET /training-plans/current
  → 200 com { notGenerated: true, ... }  → "Ainda não liberado" / tela de pagamento
  → 200 com plano                         → exibe o plano ✓
  → !response.ok                          → setPlanLoadError(true)
```

**Para a Lucelane ver a tela de erro de código, a API precisa devolver `notGenerated: true`.**

**Por que `current()` devolveria `notGenerated: true` para uma aluna ativa?**

```typescript
// training-plans.service.ts, current():
const weekStart = startOfWeek(new Date());
// ...
this.prisma.trainingPlan.findFirst({
  where: { userId, status: 'active', startDate: { in: [weekStart, addDays(weekStart, 7)] } },
})
// se null → return { notGenerated: true, hasSubscriptionAccess: ... }
```

Causas possíveis:
1. **`status` não é `'active'`**: o plano existe mas foi arquivado, ou está em outro status.
2. **`startDate` não bate**: o plano tem `startDate` diferente do `startOfWeek(new Date())` e do
   `startOfWeek(new Date()) + 7 dias`.
3. **Nenhum plano existe**: ela nunca teve um plano gerado para essa semana.
4. **`subscriptionStatus` bloqueia antes**: `current()` checa `onboarding.completedAt` — se vazio,
   retorna `onboardingRequiredPlan(...)` antes de chegar ao plano.
5. **Conta errada**: ela está logando com a conta de testadora (sem assinatura), não a conta de aluna.

**Atenção de data**: hoje é domingo (13/09/2026). `startOfWeek(new Date())` retorna o domingo da
semana atual = 2026-09-13. Um plano com `startDate = 2026-09-07` (segunda-feira da semana passada)
NÃO seria encontrado pela query `startDate IN [2026-09-13, 2026-09-20]`. Se o plano dela foi gerado
com `startDate = 2026-09-07`, ele estaria invisível — mas isso só aconteceria se `generateWeek()`
usar uma lógica de `weekStart` diferente de `current()`, o que não deveria ser o caso.

---

## Diagnóstico necessário antes de qualquer nova tentativa

1. **Painel admin**: qual é o `subscriptionStatus` da conta da Lucelane?
2. **Painel admin (aba Treinos)**: ela tem um `TrainingPlan` com `status: 'active'`? Para qual
   `startDate`? O `startDate` é 2026-09-13 (domingo) ou 2026-09-07 (segunda)?
3. **Qual e-mail ela está usando** no app? É o mesmo da conta de aluna cadastrada no painel?
4. Se o plano existe e é `active`: qual é o retorno real de `GET /training-plans/current` para ela?
   (verificar nos logs do EasyPanel ou adicionar log temporário)

---

## Aprendizado sistêmico

- **Proteção no frontend nunca substitui clareza no backend**: `isDetailedPlan` tentou proteger
  contra "planos antigos" no frontend, mas o lugar certo dessa lógica é o backend — que já valida
  o plano antes de devolvê-lo.
- **Regressão invisível**: a `isDetailedPlan` foi introduzida como detalhe menor dentro de um commit
  grande (aba Rotina + várias correções). Esse tipo de mudança pequena em código de exibição que
  toca o caminho crítico (mostrar o plano vs mostrar tela de pagamento) precisa de teste real antes
  de deploy.
- **Diagnóstico antes de código**: tentativas 2 e 3 foram feitas sem confirmar os dados do banco.
  A tentativa 4 foi o fix certo de código, mas revelou que o problema original (antes do commit
  6215363) pode nunca ter sido o `isDetailedPlan`. O problema real ainda está aberto.
