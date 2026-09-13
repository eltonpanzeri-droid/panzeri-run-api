# Erro Corrigido #0002 — Sessões indevidas no domingo (Tiago)

**Aluno:** Tiago  
**Problema relatado:** 13/09/2026 — programa semanal com Seg/Ter/Qua/Sex sem treino ("Sem treino") e Dom com 2 sessões indevidas (Corrida + Fortalecimento), mesmo Dom estando marcado como "Não treina" na rotina.  
**Aberto em:** 13/09/2026  
**Status:** Corrigido na mesma sessão. Typecheck limpo. Aguardando push + deploy.

---

## Diagnóstico

**Causa raiz:** `weekDates` em `generateWeek()` (`training-plans.service.ts`) usava array fixo `[0,1,2,3,4,5,6]` para construir as datas enviadas ao agente de IA — todos os 7 dias da semana, sem filtrar pelos dias que o aluno realmente treina (`availableDays`).

O banco já devolve `WeeklyAvailability` filtrado por `noTraining: false` (linha 474), mas esse filtro não chegava até o `weekDates` da IA. A IA recebia Dom 13/09 como uma data futura válida, prescrevia sessões para ela, e essas sessões entravam pelo caminho `extraRunSessions` (sobras de `runDecisionsByWeekday`) sem nenhuma verificação de `noTraining`.

**Por que Seg/Ter/Qua/Sex aparecem vazias:** o programa foi gerado em algum momento anterior ao domingo (provavelmente sábado 12/09). Esses dias eram passados naquele momento — filtrados corretamente pelo filtro de datas. Apenas Sab (hoje quando gerado) e Dom (futuro) passaram.

**Contexto adicional:** Tiago já tinha tido um problema anterior na geração (entrevista pulou a experiência dele com corrida), então o programa vinha com histórico ruim. A combinação de semana incompleta + Dom indevido piorou a percepção do aluno sobre o produto.

---

## Correção aplicada (13/09/2026)

**Arquivo:** `apps/api/src/training-plans/training-plans.service.ts`

**1. `trainingWeekdays` Set criado após `availableDays`:**
```typescript
const trainingWeekdays = new Set(availableDays.map((d) => d.weekday));
```

**2. `weekDates` filtrado:**
```typescript
weekDates: [0, 1, 2, 3, 4, 5, 6]
  .filter((weekday) => trainingWeekdays.has(weekday))
  .map((weekday) => ({
    weekday,
    date: addDays(weekStart, weekdayOffsetFromMonday(weekday)).toISOString().slice(0, 10),
  })),
```

**3. Guard defensivo em `extraRunSessions`:**
```typescript
if (!trainingWeekdays.has(weekday)) {
  this.logger.warn(`IA prescreveu sessao de corrida extra para weekday ${weekday} que nao faz parte da rotina do aluno — descartado.`);
  return [];
}
```

---

## Bug associado ainda não corrigido

`shouldRollToNextWeek` tem um bug separado: se alguém gerar o treino **no domingo antes das 12h** com Dom=NÃO na rotina, o sistema não rola para a semana seguinte (porque `!activePlanBeforeAdjustment || pastWeeklyRelease` é falso para quem já tem plano e ainda não chegou às 12h). Resultado: semana atual sem nenhum dia de treino disponível.

**Esse bug não causou o problema do Tiago** (geração foi em outro dia). Está documentado para correção futura com aprovação.

---

## Lição

A IA não filtra por "dias que o aluno treina" — ela confia nos dados que recebe. Se um dia com `noTraining=true` chegar em `weekDates`, ela vai prescrever treino para ele. A fonte de verdade (`availableDays`) precisa ser a mesma usada para construir o contexto da IA, não só para filtrar sessões depois da geração.

**Regra derivada:** toda construção de contexto para a IA (dias, datas, janelas) deve usar `availableDays` (já filtrado por `noTraining: false`) como única fonte — nunca um array fixo de dias da semana.
