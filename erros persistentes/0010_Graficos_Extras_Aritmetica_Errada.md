# 0010 — Gráficos admin: extras calculados por aritmética em vez de source='student'

**Status:** RESOLVIDO (17/09/2026)

---

## Padrão de falha

Dois gráficos na aba Evolução usavam `completedSessions - prescribedSessions` (aderência) ou `completedKm - prescribedKm` (volume) para calcular sessões/km extras. Essa aritmética sempre retorna 0 quando o aluno completou menos sessões do que o prescrito — o caso mais comum. O resultado: a barra cyan de "Extras" nunca aparecia mesmo quando a aluna tinha treinos extras registrados.

---

## Histórico de rodadas

### Rodada 1 — 17/09/2026 (volume chart)
**Diagnóstico:** `extraKm = max(0, completedKm - prescribedKm)` → sempre 0 quando realizado < prescrito.
**Correção:** `extraKm` calculado de sessões com `structure.source === 'student'` em `allWeeks`. Barra verde vira `regularKm = completedKm - extraKm`.
**Resultado:** Volume chart corrigido.

### Rodada 2 — 17/09/2026 (aderência chart — mesma raiz, não verificado)
**Diagnóstico:** `extras = max(0, completedSessions - prescribedSessions)` — mesma lógica incorreta. Deveria ter sido corrigido junto com o volume, mas não foi verificado.
**Correção:** Adicionado `extraSessions` ao tipo `WeekData` e ao mapeamento `allWeeks` (conta sessões com `source === 'student'`). `LoadChartAderencia` usa `w.extraSessions`.
**Resultado:** RESOLVIDO.

---

## Causa raiz

Lógica de "extras = realizado - prescrito" não funciona quando extras co-existem com sessões prescritas não-feitas. A única fonte confiável é o campo `structure.source === 'student'` que identifica sessões adicionadas pela própria aluna.

---

## Aprendizado sistêmico

**Regra permanente:** Ao corrigir um bug de cálculo, verificar TODOS os outros gráficos/componentes que usam a mesma lógica antes de declarar concluído. Especialmente quando a causa raiz é um padrão de cálculo (não um bug pontual): buscar o padrão por toda a base de código.

---

## Arquivos alterados

- `apps/admin/app/page.tsx` — `WeekData` com `extraSessions`; `allWeeks` com `extraSessions`; `LoadChartAderencia` usa `w.extraSessions`; `LoadChartSemanal`: cor da barra compara com semana anterior com km > 0 (não a imediatamente anterior); tendência só com n ≥ 4
