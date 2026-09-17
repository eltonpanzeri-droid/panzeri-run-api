# 0005 — Data errada em sessões extras criadas pela aluna

**Status:** CORRIGIDO em 17/09/2026

## Sintoma
A data exibida no banner "Feito em [data]" e no campo "Data realizada" aparecia
um dia a menos do que a data real (ex: aluna criou sessão extra em 17/09,
mas o app mostrava "Feito em 16/09/2026").

## Histórico de tentativas
- **Rodada 1 (antes de 17/09):** investigado mas descartado como "correto" —
  diagnóstico errado, julgou-se que a aluna tinha feito o treino no dia anterior.
- **Rodada 2 (17/09/2026):** causa raiz identificada e corrigida.

## Causa raiz confirmada
`addStudentExtraSession` (training-plans.service.ts, linha 1799) salvava
`completedAt: scheduledDate`, onde `scheduledDate = new Date(Date.UTC(year, month-1, day))`
= **meia-noite UTC**. No Brasil (UTC-3), meia-noite UTC equivale a 21h00 do dia
**anterior**. Quando o app lia de volta com `new Date(iso).getDate()` (hora local),
obtinha o dia errado.

Exemplo: aluna cria extra em 17/09 → `scheduledDate = 2026-09-17T00:00:00Z`
→ em BRT = 2026-09-16T21:00:00-03:00 → `getDate()` = 16 → exibe "16/09". Errado.

## Correção aplicada (commit e51e58b, 17/09/2026)
1. **API** (`training-plans.service.ts`): `completedAt` mudou de `scheduledDate`
   (meia-noite UTC) para `new Date(Date.UTC(year, month-1, day, 12, 0, 0))` (meio-dia UTC).
2. **App** (`App.tsx`, `isoDateToInputValue`): mudou de `getDate/getMonth/getFullYear`
   (hora local) para `getUTCDate/getUTCMonth/getUTCFullYear` (UTC). Protege também
   dados já gravados com meia-noite UTC no banco.

## Aprendizado sistêmico
Datas armazenadas como meia-noite UTC são ambíguas no fuso BRT (UTC-3): o mesmo
timestamp `T00:00:00Z` pode representar o dia anterior no horário local.
**Regra permanente:** qualquer `completedAt` definido pelo servidor sem input do
usuário deve usar **meio-dia UTC** (hora 12). A leitura no app deve usar
`getUTCDate()`, não `getDate()`.
