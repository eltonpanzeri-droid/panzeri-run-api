# 0013 — Datas, fusos e "qual é a semana atual": erro recorrente

> Aberto em 01/11/2026 (domingo, ~21h12 Brasília) após o relato de Elton: **no app do TestFlight, domingo à noite, não aparece nenhum botão para gerar o treino da semana seguinte; ao tocar em "Próxima" a tela pula uma semana (mostra 09/11 a 15/11)**. No PWA, segundo Elton, o botão está disponível.
> Este documento é **somente análise**. Nenhum código foi alterado. Marcações: **FATO** (lido no código ou medido), **INFERÊNCIA** (conclusão lógica a partir de fatos), **DESCONHECIDO** (não dá para provar sem rodar o app).

---

## 1. Resumo em linguagem simples

1. A regra "que semana é a atual" (principalmente aos domingos depois do meio-dia) existe **em vários lugares diferentes**, cada um lendo o relógio do seu jeito: no app (duas funções), no servidor (pelo menos três pontos) e no painel. Cada correção anterior consertou **um** desses lugares.
2. Pela simulação com o **código real do servidor**, entre domingo 12h e segunda 00h (Brasília) o servidor responde assim: "anterior" = semana 26/10, "atual" = semana 26/10, "próxima" = semana **09/11**. A semana **02/11 a 08/11 não é devolvida por nenhum deslocamento** (a não ser que o treino dela já exista). Ou seja: **o servidor tem um salto próprio, independente do app e do PWA**.
3. O botão de gerar só aparece em duas situações: na tela especial de domingo-à-tarde (que o app liga por uma conta feita no próprio aparelho) ou quando o servidor diz "não gerado". No horário do relato nenhuma das duas apareceu no aparelho do TestFlight.
4. Por que o PWA mostra o botão e o app nativo não: **ainda não sei provar** (ver seção 4). O mais provável é a diferença de como o motor do app nativo e o navegador calculam o fuso; a solução de fundo é **o servidor dizer ao app em que estado está a semana**, em vez de o app refazer a conta.

---

## 2. A regra que existe hoje (como foi desenhada)

Pedido do treinador (07/08/2026, comentários no código): a partir de **domingo 12h (Brasília)** ninguém deve ver o treino da semana que está acabando na tela principal; só o botão de gerar a próxima. Para rever aquela semana, usa-se "Anterior".

Para isso o sistema usa um "corte" `WEEKLY_RELEASE_HOUR = 12` e **repete a mesma regra em lugares diferentes**:

| # | Onde | Como lê o relógio | Para que usa |
|---|---|---|---|
| 1 | App `isSundayAfterNoon()` (App.tsx ~13261) | `Intl.DateTimeFormat('en-US', America/Sao_Paulo)` no aparelho | Liga a tela especial "Sua semana está liberada" + botão (deslocamento 0) |
| 2 | App `isBeforeWeeklyRelease()` (~13246) | mesma técnica | Decide a mensagem "Ainda não liberado" e o botão em telas sem plano |
| 3 | App `planStartsInFuture()` (`src/weekWindow.ts`) | `Intl` en-CA + "amanhã" em São Paulo | Distingue o plano velho do plano novo já gerado |
| 4 | App `upcomingWeekRangeLabel()` / `currentWeekRange()` | **getters locais do aparelho** (`getDate`, `setDate`) | Só texto das datas na tela especial |
| 5 | Servidor `getWeekByOffset` (training-plans.service.ts ~588) | `saoPauloWeekdayAndHour` (Intl) | Traduz "Anterior/Próxima" em semana de verdade |
| 6 | Servidor `current()` (~404) | `startOfWeek(new Date())` pelo dia de **São Paulo**, sem a regra do corte | Devolve o plano da "semana atual" (o do calendário; ou o da seguinte, se já existir) |
| 7 | Servidor geração (`pastWeeklyRelease`, `computeShouldRollToNextWeek`, ~965) | mesma técnica | Escolhe a semana-alvo ao gerar |
| 8 | Servidor ~1918 (`weekday === 0 && hour < WEEKLY_RELEASE_HOUR`) | mesma técnica | Outra checagem do corte |

**FATO:** são pelo menos 8 implementações da mesma pergunta ("já passou do corte de domingo?") em 2 programas diferentes. A pergunta nunca foi respondida **uma vez só** pelo servidor.

---

## 3. Simulação (código real do servidor, não reescrito)

Importei `startOfWeek`, `addDays` e `saoPauloWeekdayAndHour` do `training-plans.service.ts` e reproduzi a conta de `getWeekByOffset` / `current()`.

| Instante (UTC) | Brasília | Anterior (-1) | Atual (0) | Próxima (+1) |
|---|---|---|---|---|
| 01/11 14:59 | domingo 11h59 | 19/10 | 26/10 | **02/11** |
| 01/11 15:01 | domingo 12h01 | 26/10 | 26/10 | **09/11** |
| 02/11 00:08 | **domingo 21h08** (o caso) | 26/10 | 26/10 | **09/11** |
| 02/11 02:59 | domingo 23h59 | 26/10 | 26/10 | **09/11** |
| 02/11 03:01 | segunda 00h01 | 26/10 | **02/11** | 09/11 |

**FATO:**
- Antes do corte, "Próxima" = 02/11 (certo).
- **Depois do corte, "Próxima" salta para 09/11**, e **nenhum deslocamento devolve 02/11** (sem treino gerado). Isso é exatamente a tela "09/11 a 15/11 — Ainda não liberado" do print.
- O deslocamento 0 e o -1 devolvem a **mesma** semana (26/10) depois do corte: é de propósito (o app deveria esconder o 0 com a tela especial), mas deixa a semana 02/11 **só alcançável pelo botão de gerar**.

---

## 4. O que explica o que o Elton viu

**FATO (prints):** (a) tela com o plano 26/10, "Gerado em 26/10", rodapé "A partir de domingo ao meio-dia, toque em 'Gerar treino da semana'…" (esse texto manda tocar num botão que **não está nessa tela**); (b) tela "09/11 a 15/11 — Ainda não liberado", "Anterior" ativo e "Próxima" apagado; horários 21h06–21h08 (= 00h06–00h08 UTC de segunda).

**FATO (código):** só se chega ao deslocamento +1 tocando em "Próxima" numa tela de deslocamento 0 que tenha "Próxima" ativo. A tela especial de domingo-à-tarde tem "Próxima" **permanentemente apagado**.

**INFERÊNCIA (cadeia lógica):**
1. Para o app ter ido a +1, a tela especial **não estava ativa** no deslocamento 0 (isso exige `isSundayAfterNoon()` falso ou `planStartsInFuture(plano)` verdadeiro).
2. O plano mostrado era o de 26/10 (então `planStartsInFuture` é falso, pois 26/10 não é futuro).
3. Logo, **`isSundayAfterNoon()` deu falso no aparelho** às 21h06, embora seja domingo depois do meio-dia em Brasília.
4. Com a tela especial desligada, o app mostrou a tela comum (plano 26/10, sem botão), "Próxima" ficou ativo, e o toque levou a +1, onde o servidor devolveu 09/11. O 02/11 foi pulado e o botão nunca apareceu.

**DESCONHECIDO:** por que `isSundayAfterNoon()` deu falso **no app nativo** e não no PWA. Hipóteses (não provadas):
- (H1, mais provável) O app nativo usa o motor Hermes; o PWA usa o do navegador. A regra depende de `Intl.DateTimeFormat(...).formatToParts` (peças `weekday` e `hour`), que não tem garantia de comportamento idêntico entre motores. Nenhum teste automático roda essa função no motor do celular.
- (H2) Estado do app (a tela estava aberta de antes, trocas de aba) — improvável, a função é recalculada a cada exibição.
- (H3) Diferença de versão: **descartada** como causa direta — a lógica de semana não mudou entre o build de 31/10 e hoje (`git diff 99dfe92..HEAD` só tocou a rotina e as atividades ignoradas).

**Como confirmar sem adivinhar (sem mudar o app):** pedir ao Elton, no TestFlight, domingo depois do meio-dia, "Treinos" → ver se aparece "Sua semana está liberada"; depois repetir no PWA. Se o nativo falhar de novo, é o motor (H1) e **a solução tem que tirar a conta do aparelho**.

---

## 5. Inventário: como as datas são tratadas hoje

### 5.1 Convenções de armazenamento
- **Dia do calendário** (plano, sessão): guardado como **meia-noite UTC do dia de São Paulo** (ex.: 26/10 = `2026-10-26T00:00:00Z`). Por isso o app lê com getters **UTC** (`formatDayMonthUtc`) — correto.
- **Instante real** (atividade do relógio, conclusão de treino, eventos): guardado como instante UTC, mais `utcOffsetMinutes` na atividade (pode faltar; nesse caso presume-se São Paulo, UTC-3).
- **Texto de data digitado** (extra, provas): `dd/mm/aaaa` no app, convertido na ida.

### 5.2 Padrões de risco, por programa (contagem em código de produção, sem testes)

| Padrão | API | Painel | App (App.tsx) | App (src/) |
|---|---|---|---|---|
| Fuso de São Paulo explícito (`America/Sao_Paulo`) | 36 | 10 | 4 | 1 |
| Getters **locais** (`getDay/getDate/setDate/setHours`) — dependem do fuso de quem roda | 4 | 10 | **21** | 6 |
| Getters UTC (`getUTC*`) | 69 | 14 | 9 | 2 |
| `toISOString().slice(0,10)` (dia **em UTC**) | **118** | 21 | 9 | 4 |
| "-3 horas" escrito fixo (`3*60*60*1000`, `-03:00`) | 7 | 1 | 6 | 0 |
| Formatação/Intl | 38 | 45 | 9 | 7 |

### 5.3 Itens concretos de risco (FATO: lidos no código)

**A) "Hoje" pegando o dia em UTC (errado de 21h00 a 23h59 em Brasília):**
- `apps/mobile/App.tsx:6725` — linha do tempo das provas (a "data de hoje")
- `apps/admin/app/student-calendar.tsx:173` — `todayGuess`: mês/semana padrão e destaque de "hoje" no calendário do treinador
- `apps/admin/app/page.tsx:2725` e `:9765`, `apps/admin/app/ti/studio.tsx:309`, `anonymous-export.ts:78`
- `apps/api/src/coach/student-health-recovery.service.ts:117` (`todayIso`) e `polar/polar-probe.service.ts:86`

**B) "-3 horas" escrito fixo** (hoje o Brasil não tem horário de verão, mas é uma suposição escondida): `evolution-metric.service.ts:30`, `leo.service.ts:65`, `ai-cost.service.ts:16` (meu, de hoje), `coach.service.ts:1480`, e no app/painel `App.tsx:4417, 5586, 10297, 10325, 10350`, `page.tsx:8546`.

**C) Getters locais no servidor (dependem do fuso do container; o Dockerfile não define `TZ`, então é UTC por omissão):** `coach.service.ts:2185` e `:2508`, `notifications.service.ts:198` (`setHours(0,0,0,0)` = meia-noite **UTC**, não de Brasília), `target-races.service.ts:224`.

**D) Getters locais no app (dependem do fuso **do celular**):** `App.tsx:4641, 4838, 4878` (`new Date().getDay()` para saber o dia da semana), `7917–7995` (calendário do mês), `13140`, `13232–13236` (`currentWeekRange`), `13280–13282` (`upcomingWeekRangeLabel`), `13363` (`todayDateInputValue`). Funciona para quem está no Brasil com o relógio certo; erra para quem viaja ou tem o fuso do aparelho diferente.

### 5.4 Funções duplicadas que respondem "qual é o começo da semana / que dia é hoje"
`weekStartOf` ×5 (correction-hooks, training-load, weekly-volume, observatory-core, medal helpers `mondayOf`), `mondayOf` ×3 (coach/student-calendar, medals, admin calendar), `addDays` ×7 (versões diferentes: uma em `Date` UTC, outras em texto), `startOfWeek` (training-plans), `activityLocalDate` ×2, `todayInSaoPaulo` ×2, `saoPauloDateString` (billing), `brtDay/brtMonthStart` (custo de IA), `currentWeekRange`/`saoPauloDateString` (app). **Não existe um módulo único de datas.**

### 5.5 Para onde as datas vão (fluxos principais)
- **Geração do programa:** `startOfWeek` (dia de São Paulo) → `TrainingPlan.startDate` → `TrainingSession.scheduledDate` → app (`planWeekRange`, UTC) e painel.
- **Escolha da semana ao gerar:** corte de domingo (itens 7 e 8 da tabela) → plano da semana atual **ou** da seguinte.
- **Navegação do app:** deslocamento do botão → servidor (`getWeekByOffset`) → semana. É aqui que o corte vira "salto".
- **Atividades do relógio:** instante UTC + `utcOffsetMinutes` → `activityLocalDate` → dia local → vínculos, volume, carga, relatório da semana (a regra do "dia local" tem versões em `common/local-date.ts` e `coach/training-load-rows.ts`).
- **IA:** `hoje`, `dataDeCadaDiaDaSemanaSendoGerada` e o histórico por semana saem dos mesmos helpers; um dia errado aqui vira texto errado no treino ("ontem" para algo de 2 dias antes — já aconteceu, 08/09).
- **Cobrança/avisos:** vencimentos e mensagens usam `saoPauloDateTime` e `saoPauloDateString` (billing) — versões próprias.

---

## 6. Histórico do mesmo problema (já corrigido em partes)
| Data | Sintoma | Correção |
|---|---|---|
| 08/08 e 10/08 | semana antiga escondia o botão (Eduarda) | filtro por semana em `current()` |
| 16/08 | gerar no domingo à tarde "não aparecia" (várias alunas) | `current()` busca plano da semana atual **e** da seguinte |
| 16/08 | "Anterior" não alcançava a semana que acabou (Vanessa) | removido o deslocamento duplo no cliente; servidor passou a aplicar o corte |
| 20/09 | de domingo 21h a 23h59 o plano novo sumia | `weekWindow.ts` (dia em São Paulo) |
| 27/10 | "fuso com corte" no volume realizado | unificação do dia local |
| **01/11 (este)** | de domingo 12h a 00h: sem botão e "Próxima" pulando | **em aberto** |

**Aprendizado sistêmico:** cada correção resolveu o **lugar** que quebrou, não a **regra**. Enquanto a pergunta "em que estado está a semana agora?" for respondida por conta própria pelo app e por vários trechos do servidor, o próximo horário-limite (virada de mês, fim de semana de feriado, fuso do aparelho) tende a produzir um novo caso.

---

## 7. Opções de correção (nada aplicado — decisão de Elton)

**Antes de qualquer mudança em `current()`/`getWeekByOffset` (fonte compartilhada), listar leitores:** `training-plans.controller.ts:26` e `:67` (únicos chamadores diretos) + o espelho em `coach.service.ts:~1118` (painel, mesma conta) + a checagem `checkPlanFreshness`. Nenhum outro módulo chama `current()`.

- **Opção A (recomendada, resolve para PWA e app nativo sem novo build):** no servidor, **depois do corte de domingo, `current()` devolve o plano da semana que vem (se já existir) ou "não gerado" para a semana que vem — nunca a semana velha.** A semana velha continua em "Anterior" (já funciona). Assim, mesmo que a conta do aparelho falhe, a tela cai no ramo "sem plano" que já tem o botão. Complemento: o servidor devolve `podeIrParaProxima: false` depois do corte e o `+1` deixa de apontar para a semana depois da próxima. Risco: muda o que `current()` devolve aos domingos à tarde — precisa de testes de borda (11h59, 12h01, 21h08, 23h59, 00h01) e conferir o painel do treinador.
- **Opção B (de fundo, exige novo build):** o servidor passa a devolver um bloco `contextoDeSemana` (hoje em São Paulo, se já rolou, semana atual/próxima/anterior, o que cada botão significa). O app **para de calcular datas de semana** (somem `isSundayAfterNoon`, `isBeforeWeeklyRelease` e os getters locais da tela de treino). Uma regra, um lugar.
- **Opção C (higiene):** criar **um** módulo de datas por programa (servidor, app, painel) e trocar os padrões das seções 5.3-A/B/D por ele; teste automático que roda a mesma bateria de horários nos três.

Recomendação: **A agora** (corrige o relato hoje, no servidor), **B** no próximo build, **C** em lotes pequenos depois.

---

## 8. Pendências desta investigação
- Confirmar H1 (motor do app nativo) com o teste de 2 minutos descrito na seção 4.
- Decidir A/B/C com Elton antes de editar (fonte compartilhada, alto impacto).
- Quando houver correção: registrar neste dossiê a rodada, o resultado e o teste de regressão (bateria de horários).
