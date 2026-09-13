# Erro Corrigido #0003 — Telegram falso "solicitou alteração de rotina" (Lucelane)

**Aluna:** Lucelane  
**Problema relatado:** 13/09/2026 — Telegram de "solicitou alteração de rotina" disparou quando a
aluna apenas navegou pela tela de rotina sem mudar nada.  
**Aberto em:** 13/09/2026  
**Status:** Corrigido na mesma sessão. Typecheck limpo. Aguardando push + deploy (API) e build EAS (mobile).

---

## Diagnóstico

**Causa raiz em duas camadas:**

**Camada 1 — Deriva silenciosa WA vs interview**: A `ORDEM EXECUTIVA 09/09` removeu o back-sync
`WeeklyAvailability → OnboardingInterview.answers`. Antes disso, qualquer mudança na WA era refletida
de volta nas respostas da entrevista, mantendo ambas sincronizadas. Com a remoção, a WA pode estar
diferente das respostas da entrevista sem que o aluno tenha feito nada.

**Camada 2 — `availabilityChanged()` não distingue "deriva silenciosa" de "mudança real"**: A função
compara JSON da WA atual com a rotina calculada das respostas da entrevista. Se as duas divergirem por
causa da deriva (e não por ação do aluno), ela devolve `true` da mesma forma.

**Resultado**: o aluno abre "Rotina de treinos" → clica "Alterar rotina" → GuidedInterview abre
pré-preenchida com respostas da entrevista → navega sem mudar nada → clica "Concluir" →
`POST /me/onboarding/complete-routine` → `syncAvailabilityFromInterview` → `availabilityChanged()=true`
(deriva) → Telegram "solicitou alteração de rotina" disparado.

---

## Correção aplicada (13/09/2026)

A correção foi feita no app (onde a intenção do aluno é observável), não no servidor.

**Arquivo: `apps/mobile/App.tsx`** — `GuidedInterview`, mode="routine":

1. `initialAnswersRef` declarado como `useRef<InterviewAnswers>({})`.
2. Quando mode="routine" e o load termina, `initialAnswersRef.current = { ...loadedAnswers }`.
3. Em `finishOrAdvance()`, antes do POST:
   ```typescript
   const routineBody = mode === 'routine'
     ? JSON.stringify({
         changesWereMade: JSON.stringify(answers) !== JSON.stringify(initialAnswersRef.current),
       })
     : undefined;
   ```
   O POST envia `changesWereMade: true/false` com `Content-Type: application/json`.

**Arquivo: `apps/api/src/me/me.controller.ts`** — endpoint `completeRoutine`:
```typescript
completeRoutine(
  @CurrentUser() user: CurrentUserPayload,
  @Body() body?: { changesWereMade?: boolean },
) {
  return this.meService.completeRoutineFromInterview(user.sub, body?.changesWereMade);
}
```

**Arquivo: `apps/api/src/me/me.service.ts`**:
- `completeRoutineFromInterview(userId, changesWereMade?)`: passa `changesWereMade ?? true` para
  `syncAvailabilityFromInterview` (default conservador: app antigo sem o campo não perde notificações).
- `syncAvailabilityFromInterview(userId, notifyAsStudentRequest, changesWereMade = true)`:
  Telegram gate muda de `if (notifyAsStudentRequest)` para `if (notifyAsStudentRequest && changesWereMade)`.

---

## Comportamento esperado após a correção

| Cenário | changesWereMade enviado | Telegram |
|---------|------------------------|----------|
| Aluno muda pelo menos 1 resposta e conclui | `true` | dispara |
| Aluno navega sem mudar nada e conclui | `false` | não dispara |
| App antigo (sem o campo no body) | `undefined → true` | dispara (conservador) |
| Treinador usa botão de reparo no painel | `notifyAsStudentRequest=false` | não dispara (independente) |

---

## Lição

A `availabilityChanged()` detecta divergência entre WA e respostas da entrevista — o que é correto para
seu propósito. Mas ela não sabe se a divergência veio de uma ação do aluno ou de deriva silenciosa do
sistema. A decisão de notificar precisa levar em conta a intenção do aluno, que só o app conhece.

Sempre que remover um mecanismo de sincronização bidirecional, mapear todos os consumidores que dependiam
dessa sincronização para saber o que muda na prática (ver [[data-dependency-path-rule]]).
