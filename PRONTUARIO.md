# Prontuário do Panzeri Run

Este documento existe para qualquer pessoa (inclusive uma IA numa sessão nova, sem memória das
conversas anteriores) entender rapidamente **o que é o app, como ele é construído e o que vem
acontecendo com ele** — sem precisar ler centenas de commits ou reconstruir o histórico do zero.

Não é extenso de propósito. A ideia é atualizar este arquivo a cada 1–2 semanas (ou depois de um
incidente importante), acrescentando um novo bloco em "Diário" e ajustando as seções acima se algo
estrutural mudou. Não é um changelog técnico completo — para isso existe o histórico do git.

**08/09/2026**: este documento absorveu o `MEMORIA_DO_PROJETO_PANZERI_RUN.md`, que ficou desatualizado
em vários pontos (teste de 3km, processador de pagamento) e foi descontinuado. A partir de agora este
é o único documento de referência geral do projeto.

---

## Referência rápida (instalação, acessos, comandos)

Link de produção real que as alunas usam: `https://panzerirun.eltonpanzeripersonal.com.br` (domínio
próprio, configurado em 19/08; o link antigo do EasyPanel continua ativo em paralelo, mas não é o que
se divulga).

Como a aluna instala o PWA na tela principal:

- iPhone: abrir o link pelo Safari → botão de compartilhar → "Adicionar à Tela de Início" → confirmar.
- Android: abrir o link pelo Chrome → três pontinhos → "Adicionar à tela inicial" ou "Instalar app" →
  confirmar.

Scripts locais úteis (raiz do repositório):

- `abrir-painel-admin-estavel.bat` — abre o painel do treinador local (`http://127.0.0.1:3000`).
- `abrir-mobile-preview.bat` / `abrir-mobile-navegador.bat` / `abrir-mobile-expo.bat` — abrem o app
  mobile local de formas diferentes.
- `atualizar-github-panzeri-run.bat` — **DESCONTINUADO** (ver CLAUDE.md, "Workflow de deploy"). Não há mais
  sincronização por `.bat`: o desenvolvimento acontece direto neste checkout canônico.
- `gerar-app-android.bat` / `gerar-app-android-producao.bat` — geram build Android (preview/produção).

Cuidados: nunca registrar senha, token, secret ou chave privada neste documento nem em nenhum outro
arquivo de texto do repositório. Dados sensíveis ficam no EasyPanel, em variáveis de ambiente, ou em
`secrets/` (fora do git).

---

## O que é o Panzeri Run

App de assessoria de corrida do treinador Elton Panzeri. Um aluno faz uma entrevista inicial, o
sistema monta um plano de treino semanal (corrida + força/fortalecimento), o aluno registra o que
fez, e o plano é reavaliado e ajustado ao longo do tempo — tudo isso pensado para funcionar mesmo
com Elton sendo o único responsável não-técnico do produto (ele não programa; toda mudança de
código passa por uma sessão de IA como esta).

## Como é construído

Monorepo com três apps:

- `apps/api` — NestJS + Prisma + PostgreSQL. O cérebro: entrevista, planos de treino, Strava,
  pagamentos (Asaas), mensageria (Telegram para o treinador, e-mail via Resend — hoje sem domínio
  configurado em produção, então e-mail fica sem efeito prático por enquanto).
- `apps/admin` — Next.js. Painel do treinador: ver/editar alunos, treinos, conversar com o
  "Gerente Técnico" (agente de IA), relatórios.
- `apps/mobile` — Expo/React Native, rodando como PWA. App do aluno.

Deploy em produção via EasyPanel. O código é desenvolvido diretamente neste checkout canônico
(`C:\Users\elton\OneDrive\Documentos\GitHub\panzeri-run-api`), sem sincronização por `.bat`; push e
deploy só acontecem sob ordem explícita do treinador, nunca automaticamente pela sessão de IA.

## Regra central do motor de treino: só IA decide, nunca uma fórmula fixa

Desde meados de 2026-07, todo o raciocínio de prescrição (pace, estrutura de intervalado, exercícios
de força, volume, o que fazer diante de dor ou de uma diretriz do treinador) é decidido por chamadas
reais à IA (Claude), não por fórmulas determinísticas no código. Isso é uma decisão explícita do
treinador, não um detalhe técnico — várias vezes ao longo do projeto uma "regra fixa escondida" foi
identificada e removida porque produzia resultados ruins que a IA, com contexto real do aluno,
evitaria. O código só monta a exibição, valida consistência matemática (a estrutura bate com a
duração?) e confere se os campos aprovados foram usados (ex: exercícios só do catálogo aprovado) —
nunca decide o treino em si.

Isso tem uma implicação prática importante: **texto livre gerado pela IA em campos diferentes da
mesma resposta pode contradizer os campos estruturados**, porque nada além do prompt garante
consistência semântica entre eles (Zod só valida tipo, não significado). Isso já causou bugs reais
(ver Diário) e a lição registrada é: sempre que um campo de texto livre for adicionado, o prompt
precisa dizer explicitamente o que ele NÃO pode fazer (inventar números diferentes dos campos
estruturados, por exemplo), com um exemplo concreto do erro a evitar.

## Onde vive cada dado importante

- **Rotina/disponibilidade real (dias, modalidade, duração)** — tabela `WeeklyAvailability`. Fonte
  canônica única da rotina operacional (ORDEM EXECUTIVA Dr. Vanzão, 09/09/2026). É a ÚNICA fonte
  usada para decidir quais dias/modalidades o agente de IA gera. Gravada por: `completeRoutineFromInterview`
  (tela de Rotina do onboarding), `updateAvailability` (aluno muda rotina pelo app), `updateAnamnese`
  (treinador edita pelo painel admin). Nunca mais é sobrescrita por `completeOnboarding` (entrevista
  principal) nem tem back-sync a partir da entrevista.
- **Respostas da entrevista inicial** (`OnboardingInterview.answers`, JSON livre) — usadas para: (a)
  popular perfil/saúde/preferências do aluno quando a entrevista é concluída; (b) estimar pace de
  fallback quando não há teste; (c) contexto biográfico/saúde/objetivo para o agente de prescrição
  (as chaves de rotina — `{dia}_run_time`, `routine_modality_choice` etc. — são filtradas por
  `stripRoutineKeysFromAnswers` antes de chegar à IA); (d) exibição no painel admin; (e) mapeamento
  de perguntas equivalentes na reavaliação periódica. As chaves de rotina em `answers` são preservadas
  historicamente mas nunca mais atualizadas quando a rotina muda.
- **Plano de treino ativo** (`TrainingPlan` + `TrainingSession`) — gerado por
  `TrainingPlansService.generateWeek()`. Guarda um `inputSnapshot` (teste usado, disponibilidade
  usada, versão do motor) para detectar quando está desatualizado.

## Regra adotada em 2026-07-28: abrir uma tela nunca gera treino novo sozinho

Até essa data, `TrainingPlansService.current()` — chamado toda vez que o aluno abre o app OU o
treinador abre a página de um aluno no painel — podia, silenciosamente, decidir que o plano estava
desatualizado e chamar a IA para gerar a semana de novo. Isso gastava tokens sem necessidade (cada
reabertura de tela podia custar uma chamada real de IA) e, se a geração falhasse, derrubava a tela
inteira.

Desde 2026-07-28: `current()` é **só leitura** — nunca gera nada. A detecção de plano desatualizado
foi extraída para `checkPlanFreshness()` — também só leitura, zero chamada de IA — chamada quando o
treinador abre a página do aluno no painel, mostrando um aviso ("este aluno precisa de atualização")
com o motivo. Não existe nenhum cron/rotina automática rodando isso sozinho: o treinador decidiu
explicitamente que prefere ser avisado e clicar em "Refazer nova semana" quando quiser, a ter
qualquer processo automático gerando (ou só verificando) coisas sozinho em segundo plano. Qualquer
ação que precise gerar um treino na hora (concluir entrevista, mudar rotina, sincronizar
disponibilidade pelo painel) chama `generateWeek()` explicitamente no próprio ponto da ação. Um
relato de dor grave ainda dispara um alerta por Telegram na hora (limitado a 1 vez a cada 12h por
aluno, pra não spammar), mas só quando alguém efetivamente abre a tela daquele aluno — não existe
verificação em segundo plano para alunos que ninguém está olhando. Gerar uma notificação para o
aluno avisando que o treino foi atualizado não tem custo de IA (é só um registro no banco).

## Regra adotada em 2026-09-04: dossiê de erros persistentes

Quando um problema relatado pelo Elton sobrevive a **3 rodadas de correção sem resolução
confirmada**, a **4ª correção** passa a gerar (ou atualizar) um dossiê dedicado na pasta
`erros persistentes/`, nomeado `NNNN_Nome_da_Pessoa.md` (número sequencial de identificação +
nome). O dossiê registra a linha do tempo completa de cada rodada (diagnóstico, correção aplicada,
resultado) e um "aprendizado sistêmico" explícito extraído do padrão de falha — não é só um
histórico, é pra identificar POR QUE a mesma classe de problema resistiu a correções isoladas.

Motivo: alguns bugs (ver `erros persistentes/0001_Silvia_Mendes_Leal.md`, o primeiro caso) têm
várias causas raiz diferentes escondidas atrás do mesmo sintoma relatado ("trava na entrevista") —
corrigir uma de cada vez, sem esse registro formal, faz parecer que "nada resolve" quando na
verdade cada correção resolveu um problema real, só não o que causava o sintoma específico daquele
relato. O dossiê existe pra tornar esse padrão visível e extrair a lição estrutural (ex.: "mensagem
de erro genérica esconde causa raiz" ou "marcar como respondido antes de confirmar salvamento é a
suspeita nº 1 quando um campo obrigatório fica sem resposta").

---

## Panzeri Data Layer — Regras semânticas de ausência de dados

> Vigora a partir de 16/09/2026. Requisito de toda análise longitudinal e de todos os endpoints
> da Data Layer (`/coach/data/*`).

**Princípio geral**: `valor observado ≠ não respondido ≠ não coletado historicamente ≠ não aplicável`

### Regras

**`0` só representa zero quando zero pertence ao domínio válido da variável.**
- Escalas 1–5 e 1–10 (perceivedEffort, preSleepQuality, etc.): domínio começa em 1. `null` = não
  respondido. Nunca converter `null` em `0` antes de calcular média — isso colapsa "sem dado" em
  "esforço/qualidade zero" e distorce qualquer análise longitudinal.
- Para somas acumulativas neutras (ex: distância total = soma de km), `?? 0` é aceitável porque a
  ausência do valor é semanticamente equivalente a "não houve" naquele eixo (não é uma resposta
  a uma pergunta).

**`null` não pode ser automaticamente convertido em zero.**
- `value ?? 0` e `Number(value) || 0` são proibidos quando o campo representa uma resposta subjetiva
  a uma pergunta (esforço, satisfação, dor, humor, sono, fadiga, estresse, motivação).
- Bug corrigido: `perceivedEffort ?? 0` em `buildEvolutionReportContent` (16/09/2026) — usava null
  como 0 no denominador da média.

**Ausência histórica ≠ ausência do fenômeno.**
Variáveis adicionadas ao longo do tempo têm `null` legítimo para todos os registros anteriores à
sua introdução. Não inferir que "o atleta não sentiu dor" a partir de `painFlag = null` em
registros de antes de 22/07/2026.

| Variável | Existe desde |
|---|---|
| `perceivedEffort` | 18/06/2026 (schema inicial) |
| `satisfaction` (dimensão fazer) | 15/07/2026 |
| `painFlag` | 22/07/2026 |
| `satisfactionElaboracao`, `satisfactionCapacidade`, `satisfactionCarga` | 19/08/2026 |
| `WeeklyCheckIn` (estrutura básica) | 31/08/2026 |
| `preSleepQuality`, `prePhysicalFatigue`, `preStressLevel`, `preMotivation`, `postWorkoutFeeling`, `painTiming`, `feedbackVersion` | 11/09/2026 |
| `postWorkoutMood`, `walkingReasons` (em `details` JSON) | 12/09/2026 |
| `WeeklyCheckIn` v2 (campos de bloco 1/2/3) | 11/09/2026 |

**Sentinels legados — WeeklyCheckIn.**
- Registros v1 de 31/08/2026 a ~11/09/2026: `elaborationSatisfaction = 0` significa "pulou" (sentinel),
  **não** a resposta "zero na escala". Escala real começa em 1.
- A partir de 11/09/2026 (v2): skip indicado por `checkinSkipped = true`; campos de resposta = `null`.
- Regra: qualquer análise de `elaborationSatisfaction` deve excluir linhas onde
  `elaborationSatisfaction = 0` **ou** `checkinSkipped = true` antes de tratar como observação real.
- Ponto de normalização recomendado: criar método `WeeklyCheckInService.isSkipped(record)` que
  unifica a lógica v1+v2. **Não implementado ainda** — aguarda demanda real da Data Layer.

---

## Panzeri Data Layer — Cadeia de atribuição de aquisição

> Implementada em 16/09/2026. Vigora a partir desta data para novos cadastros.
> Os 65 alunos anteriores têm `User.acquisitionAttribution = null` — irrecuperável.

### Fluxo completo

```
Landing (script.ts)
  → captura UTMs da URL → appenda ao CHECKOUT_URL como query params
  → usuário clica CTA → navega para PWA com ?utm_source=...&utm_medium=...&fbclid=...

PWA (App.tsx) — primeiro carregamento
  → captureAndStoreAttribution() lê window.location.search
  → normaliza: utm_source→source, utm_medium→medium, utm_campaign→campaign,
               utm_content→content, utm_term→term, fbclid, gclid, document.referrer
  → persiste em AsyncStorage['panzeri-run-funnel-attribution'] (first-touch)
  → NÃO sobrescreve nas navegações seguintes dentro do PWA

FunnelEvent 'app_opened'
  → metadata inclui atribuição normalizada + journeyId = funnelSessionId
  → permite analisar aquisição mesmo de visitantes que não chegam ao cadastro

Cadastro (/auth/register)
  → App.tsx carrega atribuição persistida + journeyId = funnelSessionId
  → envia attribution: { source, medium, campaign, content, term, referrer, fbclid, gclid, journeyId }
  → RegisterDto valida campos explicitamente (sem Record<string, unknown> livre)
  → auth.service.ts grava em User.acquisitionAttribution somente quando attribution tem ao menos um campo preenchido
  → quando não há atribuição: User.acquisitionAttribution = null (direto/sem campanha)
```

### Semântica de sessionId vs journeyId (IMPORTANTE — evita criar terceiro identificador)

- **`FunnelEvent.sessionId`** — UUID gerado na primeira abertura do PWA, persistido em `AsyncStorage['panzeri-run-funnel-session']`. É o identificador operacional e canônico: vincula todos os eventos de funil de um mesmo dispositivo/instalação. **Usado para vincular User.acquisitionAttribution aos FunnelEvents.**
- **`FunnelEvent.journeyId`** — campo adicionado na migration `20260915120000` com intenção de ser um identificador cross-device criado na landing antes do PWA (conceito diferente do sessionId). **Nunca foi implementado por nenhum cliente — sempre null.** Mantido no schema por compatibilidade. Tratamento futuro: se o conceito de jornada cross-device for retomado, este campo recebe a implementação real. Se não, pode ser dropado via migration no futuro. Não criar um terceiro ID concorrente.
- **`User.acquisitionAttribution.sessionId`** — armazena o `funnelSessionId` (= `FunnelEvent.sessionId`) do momento do cadastro. Permite cruzar `User.acquisitionAttribution` com os `FunnelEvent` da mesma jornada via `WHERE "FunnelEvent"."sessionId" = "User"."acquisitionAttribution"->>'sessionId'`. **Não confundir com `FunnelEvent.journeyId` (conceito diferente, nunca implementado).**
- **Regra permanente**: identificador canônico de jornada = `FunnelEvent.sessionId`. Não criar novo ID concorrente sem implementar os dois lados (landing + PWA) da distinção cross-device que `journeyId` pretendia resolver.

### Comportamento por cenário

| Cenário | acquisitionAttribution | FunnelEvent metadata |
|---|---|---|
| Chegou via landing com UTMs | `{ source, medium, campaign, ..., sessionId }` | `{ source, ..., sessionId }` no app_opened |
| Chegou diretamente sem UTMs | `null` | `{}` no app_opened (sem metadata de atribuição) |
| Chegou via referrer sem UTMs | `{ referrer: '...', sessionId }` | `{ referrer, sessionId }` no app_opened |
| Aluno dos 65 anteriores | `null` (irrecuperável) | FunnelEvents existem mas sem UTM no metadata |

### Arquivos alterados

- `apps/mobile/App.tsx` — `FUNNEL_ATTRIBUTION_KEY`, `AcquisitionAttribution`, `captureAndStoreAttribution()`, `getStoredAttribution()`, modificado useEffect de `app_opened`, modificado `submit()` de registro
- `apps/api/src/auth/dto/register.dto.ts` — `AcquisitionAttributionDto` (campos explícitos), `attribution?` em `RegisterDto`
- `apps/api/src/auth/auth.service.ts` — `hasAnyAttributionField()`, escreve `acquisitionAttribution` no `prisma.user.create()`
- **Nenhuma migration** — `User.acquisitionAttribution Json?` existia desde Fase 0 (16/09/2026)

---

## Diário

**2026-07-28** — Sessão longa e cheia de incidentes reais reportados por alunas de verdade
(Roberta, Duda/Eduarda). Nesta única sessão:
- Implementado prompt caching (Anthropic) nos 7 pontos de chamada de IA.
- Corrigido bug real do Strava (token exchange precisa ser form-urlencoded, não JSON).
- Corrigido dropdown invisível no admin (CSS de `font-size:0` vazando para um `<select>`).
- Implementada regeneração automática + limite de 1 mudança de rotina por mês pelo próprio aluno.
- Achado e corrigido bug sério: o campo de texto `recommendations` inventava uma estrutura de
  treino diferente da estrutura real (`intervalStructure`) — corrigido no prompt, sem nenhuma regra
  fixa no código; unificada a exibição de `notes`+`recommendations` como um texto só.
- Achado e corrigido: reabrir a entrevista inicial (ação legítima, "Corrigir entrevista inicial")
  fazia o app mostrar o cartão de "Ativar assinatura" mesmo para aluna já paga — a tela de
  entrevista pendente nunca checava se o aluno já tinha acesso pago. Corrigido; também foi
  adicionada uma confirmação antes de reabrir (não existia nenhuma antes).
- Achado e corrigido, mesma raiz: `completeOnboarding()` arquivava manualmente o plano ativo antes
  de gerar um novo — o mesmo padrão de bug já documentado ("nunca arquivar antes de chamar
  generateWeek") reaparecendo num lugar novo. Isso significa que toda vez que uma aluna já ativa
  refizesse a entrevista, sessões já feitas daquela semana podiam ser perdidas.
- Teste de 3km escondido do app do aluno a pedido do treinador (reversível — nada apagado no
  backend); confirmado por auditoria que não existe regra fixa dependendo dele.
- Mudança arquitetural do dia: `current()` virou somente-leitura (ver seção acima) — geração de
  treino nunca mais acontece só por alguém abrir uma tela.

**Continuação no mesmo dia (2026-07-28, segunda parte)** — o treinador pediu para substituir até o
cron de 2h por algo que só avisa (sem nenhuma rotina automática rodando sozinha) e trouxe duas
observações estruturais importantes:
- Achado um bug grave de exibição: o painel mostrava "Atenção: gerado pelo motor padrão (IA não foi
  usada)" em **100% dos planos**, mesmo os gerados pela IA de verdade — um campo (`decisionSource`)
  que nunca é preenchido desde que o motor determinístico antigo foi removido, sempre `undefined`,
  sempre avaliando como "falso". Confirmado que o motor antigo está mesmo fora (nenhum fallback
  determinístico existe em `generateWeek()` — se a IA falha, o sistema lança erro e avisa o
  treinador, nunca usa uma regra fixa). Corrigido para sempre mostrar "Gerado pelo agente de IA".
  Isso explica por que o treinador achava que "aquela porcaria do motor de treino" continuava ativa.
- Confirmado e corrigido: a rotina real (`WeeklyAvailability`) mudava pela tela de treino/anamnese,
  mas as respostas antigas da entrevista sobre dias/duração nunca eram atualizadas — e essas
  respostas antigas ainda alimentavam a linha "Horário" do painel admin E o contexto que os agentes
  de IA recebem. Agora `updateAvailability`/`updateAnamnese` sincronizam automaticamente as duas
  fontes sempre que a rotina muda permanentemente.
- `checkPlanFreshness()` substituiu o cron: só detecta e mostra um aviso no painel do aluno, sem
  nenhuma geração automática. Alerta de dor grave por Telegram continua na hora, mas só quando
  alguém efetivamente abre a tela daquele aluno (sem verificação em segundo plano), limitado a 1x/12h.

**2026-07-29** — Continuação direta do incidente da Roberta:
- Achada a causa exata de "respeitou distância mas não pace" numa diretriz: a regra matemática que
  amarra a estrutura do treino ao pace da semana toda empurrava o cálculo pro pace geral, ignorando
  o pace especifico que uma diretriz pedia pra um dia. Corrigido no prompt (diretriz de pace/
  modalidade de recuperação agora vale exatamente pra aquele dia). Achado tambem, possivel causa
  raiz: o Gerente Tecnico tinha limite de tokens baixo demais pra mensagens longas descrevendo
  varios dias — podia cortar no meio e NUNCA salvar a diretriz, sem avisar o treinador disso.
  Aumentado o limite e a mensagem de erro agora avisa quando isso acontece.
- O treinador pediu, de forma bem enfatica: **zero regra matematica calculando ou validando o
  treino**, nem mesmo "so uma conferencia de consistencia". Removida a checagem que conferia se a
  estrutura do intervalado bate com a duracao (prompt E codigo, nos dois pontos onde existia:
  geracao semanal e regeneracao de um dia avulso). Removida tambem a instrucao de calcular duracao
  a partir de distancia-alvo de uma diretriz. Mantido, como unica excecao aprovada: o piso de
  8:30/km no pace facil (fato biomecanico, nao formula de conteudo).
- Achado um SEGUNDO bug do mesmo tipo do "motor padrao" (ver acima): o painel mostrava "Meta de
  intensidade: 80% baixa / 20% alta" pra TODO plano, sempre igual — um numero (0.8) escrito direto
  no codigo, nunca vindo de uma decisao real da IA (o schema nem pede isso a IA). Removido
  completamente, sem numero nenhum no lugar.
- Confirmado funcionando: a sincronizacao reversa rotina→entrevista (do item anterior) — o painel
  agora mostra os horarios reais e atualizados da aluna Roberta.
- Nova falha real encontrada no log: geracao de semana falhando com "Unterminated string in JSON" —
  o "pensamento" (thinking) do modelo consumindo quase todo o orcamento de tokens antes de sobrar
  espaco pra escrever a resposta inteira, pra alunos com contexto mais denso (muitas diretivas
  acumuladas). Ja tinha acontecido antes (16000→24000); aumentado de novo pra 32000.
- Levantada uma duvida arquitetural pelo treinador: o Gerente Tecnico (agente de chat) e o agente de
  prescricao semanal sao dois agentes separados que so se comunicam via texto salvo no banco
  (StudentDirective) — isso pode ser fragil. Analise: os bugs encontrados foram defeitos concretos
  e corrigiveis (limite de token, instrucao faltando), nao uma confusao fundamental de ter dois
  agentes — mas o canal de comunicacao (um agente escreve texto, outro le e interpreta) e mesmo o
  ponto mais fragil do design, vale ficar de olho.

**2026-07-29, incidente critico separado (aluna nova travada na entrevista)** — uma aluna nova
relatou a tela de "Concluir" da entrevista carregando sem avancar, sem conseguir NEM CHEGAR na
tela de pagamento. Causa: os `generateWeek()` adicionados mais cedo no mesmo dia (em
`completeOnboarding`, `updateAvailability`, `updateAnamnese`, `syncAvailabilityFromInterview`)
estavam todos com `await` — como uma chamada de IA pode levar 30s+ (pensamento adaptativo, ate
32000 tokens), isso travava a resposta HTTP inteira por esse tempo. Corrigido: nenhum desses
quatro pontos espera mais a geracao terminar — ela roda em segundo plano (`void ... .catch(...)`)
e o aluno segue pro pagamento na hora. Textos do app ajustados pra dizer "sendo atualizado" em vez
de "já foi criado", ja que a geracao pode ainda estar rodando quando a mensagem aparece. Esse
mesmo erro (await bloqueando uma resposta por causa de uma chamada de IA lenta) foi cometido tres
vezes no mesmo dia antes de ser pego — vale muita atencao a isso em qualquer codigo futuro que
chame um agente de IA dentro de uma acao que precisa parecer instantanea (salvar, concluir, etc).

**Pontos em aberto / para acompanhar depois desta sessão:**
- Sem nenhuma verificação em segundo plano, um aluno com dor elevada que ninguém olha no painel só
  é notado quando alguém abrir a tela dele — aceito deliberadamente pelo treinador, mas vale
  reavaliar se isso é rápido o suficiente na prática.
- A reabertura de entrevista pelo lado do TREINADOR (painel admin) ainda não tem confirmação —
  só o lado do aluno recebeu o aviso nesta sessão.
- Existe um template de disponibilidade fixo (`rawAvailableDays`, em
  `training-plans.service.ts`) usado SOMENTE se `WeeklyAvailability` estiver genuinamente vazia
  para um aluno — não devia acontecer no fluxo normal, mas se acontecer, o aluno recebe uma rotina
  genérica sem nenhum aviso a ninguém. Vale considerar alertar o treinador se esse caso disparar.
- O campo `decisionSource` (sempre `undefined` hoje) ficou como código morto/vestigial no schema e
  no `inputSnapshot` — inofensivo agora que nada mais condiciona exibição nele, mas vale limpar num
  passe de faxina futuro.

**2026-07-30** — Reescrita completa do motor de prescrição, a pedido explícito do treinador, após
falha real de geração (aluna Roberta) e revisão de todas as regras que existiam em cima do
raciocínio da IA:
- Abolida a categoria de sessão (`sessionType`: easy_run/quality_run/long_run/walk_run) que a IA
  tinha que escolher antes de decidir o treino — confirmado no código que nunca aparecia pro
  aluno/treinador, era só um detalhe interno meu que forçava um formato de resposta rígido. A IA
  agora descreve o treino livre, preenchendo só os campos que fizerem sentido pro dia (distância+
  pace direto, série com recuperação, ou alternância caminhada-corrida).
- Removidas regras de código que eu tinha inventado sem pedido do treinador: teto de 180min por
  sessão, bloqueio automático de sessão intensa por sinal de dor, e a instrução "soma da semana
  nunca cai muito abaixo do km relatado". Única regra física que sobrevive em todo o sistema: pace
  de corrida nunca mais lento que 8:30/km.
- Diretriz individual do treinador agora pode sobrepor também disponibilidade de dia (dia extra ou
  2 sessões de corrida no mesmo dia) e o catálogo de exercícios de força (exercício fora do
  catálogo aparece pro aluno só como texto, sem vídeo).
- Novo mecanismo de reparo por dia isolado: se só 1-2 dias específicos violarem o piso de 8:30/km,
  o sistema pede pra IA refazer só aqueles dias, em vez de descartar a semana inteira — corrige a
  causa raiz exata da falha da Roberta (um único dia ruim jogava fora os outros 6 que estavam
  certos).
- Achado e corrigido um bug real de desconexão texto/estrutura (sessão da aluna Karla): a
  estrutura numérica do treino e o texto explicativo (`notes`/`recommendations`) citavam números
  diferentes um do outro. Causa: a regra de consistência interna tinha sido encurtada demais na
  reescrita acima. Corrigida com uma explicação mais rica (não uma proibição): os campos de texto
  são a "voz do treinador" narrando a mesma prescrição que já está nos números, nunca uma segunda
  versão inventada.
- Achados e corrigidos 4 textos remanescentes mencionando o teste de 3km (removido do fluxo do
  aluno em 28/07, mas o texto não tinha sido totalmente varrido): tela de login/marketing, uma
  pergunta da entrevista, a notificação automática de "sem plano ainda", e — o mais provável
  causador da confusão real da aluna Mariana — a própria tela de checkout, que dizia "com base na
  sua entrevista e no teste de 3km" mesmo pra quem nunca fez teste nenhum.
- Atualizada a biblioteca de exercícios de fortalecimento para corredores (`runner-strength-
  library.ts`) com descrições completas fornecidas pelo treinador para as 43 entradas (41
  existentes + 2 novas: "Saltito abre e fecha no step" e "Subir no step 1,2,3,4").
- Confirmado: o deploy no EasyPanel está automático a cada push (verificado no histórico de
  implantações) — nenhuma suspeita de versão desatualizada em produção nesta sessão.
- Investigado e não resolvido: 401 do Strava ao criar webhook automático. Client ID/secret no
  EasyPanel conferem exatamente com o que a página do Strava mostra hoje — descartada a hipótese
  de segredo desatualizado. Suspeita restante (não verificável por mim): espaço/caractere invisível
  copiado numa das duas pontas. Sugerido ao treinador gerar um novo client secret e recolar direto
  do Strava pra eliminar essa possibilidade.

**2026-07-30 (2)** — Construído o "prontuário do aluno", a pedido do treinador, para reduzir o
custo/latência da geração semanal sem perder contexto real sobre o aluno:
- Dois modelos novos no Prisma: `StudentProfileEvent` (log de eventos, append-only — timestamp,
  código, texto) e `StudentProfile` (resumo condensado atual, um por aluno). Toda gravação de
  evento é puro código (zero custo de IA): conclusão de entrevista, geração de semana (cópia em
  texto da prescrição numérica), registro de treino feito/ajustado/não feito, diretriz salva pelo
  Gerente Técnico, observação do aluno, relato de dor, reavaliação concluída.
- Um agente pequeno e barato (`StudentProfileService.refreshProfile`, Sonnet 5, thinking
  desligado, ~1800 tokens de saída) condensa (resumo atual + eventos novos) num resumo atualizado.
  Só roda se houver evento novo acumulado — sem evento novo, zero chamada de IA. Disparado logo
  antes da geração da próxima semana, nunca por evento isolado.
- Conteúdo vindo de observação do aluno ou diretriz do treinador é preservado quase literal no
  resumo (mesma prioridade quase absoluta que já tinham no agente principal); feedback de treino só
  é resumido pelo agente quando for longo, senão passa direto.
- O agente principal de prescrição semanal agora recebe esse resumo (`prontuarioDoAluno`) como mais
  uma fonte de contexto, complementar ao histórico bruto/diretrizes/observações que já existiam (não
  os substitui).
- `recommendations` de cada sessão de corrida ficou bem mais curto ("poucas linhas", limite de
  exibição caiu de 600 para 350 caracteres) — deixou de tentar repetir tudo que já está em `notes`.
  Aquecimento/resfriamento saiu do que a IA escreve: virou um texto fixo padrão
  (`STANDARD_WARMUP_COOLDOWN_TEXT`), apendado por código a toda sessão de corrida.
- Módulo isolado (`StudentProfileModule`, sem depender de `TrainingPlansModule`) para não criar
  dependência circular — vários módulos que disparam eventos (pain-reports, observations,
  reassessment, workout-completions) já são importados por `TrainingPlansModule`.
- Build e typecheck completos rodados sem erro após a mudança; não testado em produção ainda (sem
  histórico real acumulado nenhum aluno pra exercitar o agente de resumo de fato).

**2026-07-31** — Correções reais de bugs encontrados em produção (Sônia), remoção da modalidade
bike, código de identificação do aluno, e um ajuste importante de confiança/comunicação:
- **Bug real de custo**: geração da semana da Sônia gastou 26 cents em duas tentativas que foram
  descartadas inteiras — a IA devolveu 0 sessões de força quando 3 eram esperadas. Corrigido com um
  reparo isolado só para os dias de força (reaproveita a corrida que já tinha saído boa em vez de
  descartar a resposta toda), e reforçada a instrução no prompt.
- **Bug real, mais grave**: o `title`/`notes` que a IA escreve para cada dia de força/musculação
  nunca era usado — a sessão final sempre mostrava um texto genérico fixo do código. Ou seja, a IA
  gerava e o sistema pagava por um texto que nunca chegava a aparecer pro aluno ou pro treinador,
  toda semana, em toda sessão de força. Corrigido tanto na geração semanal quanto no "Refazer"
  avulso de um dia de força.
- A pedido do treinador, removida a chamada extra de reparo do piso de 8:30/km (ficou só a
  instrução no prompt, sem custo adicional) — situação diferente do reparo de força acima, que foi
  mantido.
- **Modalidade "bike" removida por completo**: existia uma função (`aerobicPrescription`) que
  montava o treino de bike inteiramente por fórmula de código, sem IA nenhuma — único resquício
  real de "motor de regra fixa" que ainda restava no sistema, encontrado só agora ao reconferir com
  mais rigor a pedido do treinador. Removida do backend e de toda a interface (app do aluno e
  painel); não montamos mais treino de bike.
- **Código sequencial de 7 dígitos por aluno** (`User.studentCode`, gerado por sequence do próprio
  banco, nunca por lógica da aplicação — sem risco de colisão mesmo com dois cadastros
  simultâneos), aparecendo no painel (lista e ficha do aluno) e em toda mensagem de Telegram junto
  com o nome.
- Nova notificação no Telegram quando o aluno muda a própria rotina (a regeneração automática já
  existia; só faltava avisar).
- Nota de comunicação: usei a palavra "motor" pra descrever a IA decidindo o treino, o que o
  treinador interpretou (com razão) como indício de que ainda existisse um sistema de regras fixas
  por trás — não existia (fora o caso do bike acima, já corrigido). Lição registrada: evitar esse
  termo, chamar sempre de "a IA" ou "o agente de IA" explicitamente.

**2026-08-17/18** — Sessão longa, focada em preparar o app pra virar produto real (domínio de
e-mail, tratamento de quem nunca virou aluno de fato, reestruturação do onboarding e base legal),
motivada pela perspectiva de publicação nas lojas:

- **Domínio de e-mail (Resend) ativado em produção**: DNS configurado no Hostinger, variáveis de
  ambiente atualizadas no EasyPanel, teste real de envio confirmado — os e-mails automáticos, que
  existiam no código mas ficavam sem efeito prático por falta de domínio, agora saem de verdade.
  Ver [[pending_email_domain_setup]] (memória anterior, agora resolvida).
- **Auditoria completa dos e-mails automáticos**: removido o gatilho do teste de 3km (já tinha
  sido escondido do app em 28/07, mas o e-mail de lembrete continuava agendado); e-mail de
  cobrança reescrito para diferenciar pendente de atrasado, com link de pagamento real em vez de
  texto genérico.
- **Incidente real (aluna "Daiana")**: alguém que só abriu o app e nunca respondeu nem uma
  pergunta da entrevista apareceu na lista de alunos como aluno de verdade, com código sequencial
  permanente atribuído. Decisão do treinador: `studentCode` só é atribuído no primeiro pagamento
  real (`BillingService.assignStudentCodeIfNeeded`, via sequence do banco, chamado nos 3 pontos
  onde o acesso pago é liberado: cortesia manual, webhook Asaas, sincronização manual). Quem nunca
  pagou não aparece mais na lista de "Alunos" — vai para uma página separada "Prospectos", com
  nível de interesse calculado (frio/morno/quente, `computeProspectLevel()`) a partir de quanto da
  entrevista/checkout a pessoa já percorreu.
- **Sequência de e-mails de recuperação de prospecto** (`ProspectNurtureService`, cron de hora em
  hora): 4 disparos automáticos (8h, 24h, 7 dias, 30 dias depois do cadastro) para quem ficou como
  prospecto, cada um com um "link mágico" de login de uso único (mesmo padrão de segurança do
  link de redefinição de senha: token bruto só existe no e-mail, banco guarda hash, expira, single-
  use) para retomar de onde parou sem precisar logar de novo. Só POST troca o token por sessão
  (nunca GET) — proposital, pra scanners de segurança de e-mail não gastarem o token sozinhos
  visitando o link antes do usuário clicar.
- **Reestruturação do onboarding ("Bloco 2")**: em vez de uma entrevista completa antes de
  qualquer coisa, agora são 5 perguntas rápidas (objetivo, nível, maior dificuldade, expectativa,
  frequência) → assinatura → entrevista completa (saúde, histórico, condicionamento) → rotina →
  liberar geração do treino. Implementado reaproveitando o componente `GuidedInterview` já
  existente (4º modo `quickIntake`), com `quickIntakeCompletedAt` separado de `completedAt` no
  `OnboardingInterview`. Cada fase ganhou um texto curto explicando por que aquela etapa existe,
  pra aluna perceber que o treino é personalizado desde o início e não um modelo genérico —
  testado ao vivo pelo próprio treinador com uma conta de teste, confirmado funcionando.
- **Reforço legal/LGPD**: páginas públicas `/termos-de-uso` e `/politica-privacidade` servidas
  direto pela API (mesmo padrão HTML estático da página de redefinição de senha), necessárias
  tanto pra LGPD quanto porque Google Play/App Store exigem link de política de privacidade pra
  apps que coletam dado de saúde. Declaração de responsabilidade por exercício físico reforçada em
  3 lugares (cadastro, tela de aceite, páginas legais) deixando explícito: atendimento a distância
  sem supervisão em tempo real, orientação de acionar 192/SAMU em caso de mal-estar, e que o
  Panzeri Run não pode intervir fisicamente. Texto legal ainda não passou por revisão de advogado —
  o treinador está ciente e vai revisar de novo antes de considerar definitivo.
- **`/me` passou a expor `subscriptionStatus`** especificamente pra o app decidir, no login, se
  mostra as 5 perguntas rápidas (nunca pagou) ou a entrevista completa (já pagou) — protege contas
  antigas que estavam no meio do fluxo anterior de serem jogadas de volta pro início.
- Corrigido, encontrado durante essa revisão: a mensagem de "pagamento confirmado" (Telegram +
  e-mail) ainda instruía "toque em Rotina de treinos", texto órfão de uma versão antiga do fluxo.

**Continuação no mesmo dia (2026-08-18, segunda parte)** — revisão dos pendentes levantados acima,
um a um, com o treinador:
- **Revisão jurídica dos termos**: fica adiada por enquanto (decisão dele), mas ele pediu
  explicitamente para eu continuar lembrando disso de forma ativa, não só deixar registrado —
  criada uma memória dedicada só para isso.
- **Teste ponta a ponta do Bloco 2 com pagamento real**: ele decidiu confiar, sem exigir esse teste
  agora.
- **Metodologia**: múltiplos objetivos (corrida+trilha vs. saúde geral) descartado da lista de
  pendências — o app só trabalha com objetivos de corrida por distância específica, não é uma
  decisão real do produto hoje. Tom de comunicação do agente com o aluno foi definido ("amigável,
  firme, direto e objetivo, incentivador, sem puxa-saco, sem se perder em explicação técnica") e
  implementado como instrução explícita no prompt do `PrescriptionAgentService`, especificamente no
  campo `recommendation` (o único texto que o aluno lê direto na tela, como "Orientação da semana"
  — `notes`/`rationale` continuam sendo execução pura/interno). Ainda falta elicitar como pesar
  idade/histórico de saúde mais amplo — ele pediu que a próxima rodada venha com perguntas
  objetivas/fechadas, não uma pergunta aberta.
- **"Investigador de dor" guiado, aprimorado**: o relato de dor já era bem mais estruturado do que
  eu lembrava (região, intensidade 1-10, quando aparece, como se comporta, status de dores
  anteriores — tudo por opção, sem texto livre). Faltavam duas perguntas específicas que o próprio
  treinador tinha listado como parte da régua de decisão dele: a dor está piorando/estável/
  melhorando ao longo dos treinos, e ela atrapalha o dia a dia fora do treino. Adicionadas as duas
  (`PainReport.worseningTrend`, `PainReport.dailyLifeImpact`) — sem nenhum cálculo novo em cima
  (mesma regra de sempre: zero fórmula decidindo o treino), só mais contexto real anexado ao motivo
  que já vai pro agente de IA julgar.
- **Faxina do campo morto `decisionSource`**: removido de ponta a ponta (schema/inputSnapshot,
  `coach.service.ts`, tipos do admin) — o campo sempre valia `'ai'` desde que o motor determinístico
  foi removido em 30/07, então a ramificação "Motor determinístico" no relatório técnico era código
  morto/inalcançável. Simplificado para o rótulo fixo único que sempre foi a realidade.
- **Idade e histórico de saúde na metodologia**: última pendência da elicitação de metodologia
  fechada, via perguntas objetivas. Duas instruções novas no prompt estável do
  `PrescriptionAgentService`: idade só pesa combinada com outro sinal (sedentarismo, pouca força,
  condição de saúde); condição crônica declarada (cardíaco, pressão alta) nunca proíbe zona/
  modalidade, só deixa o ritmo mais gradual (mais tempo em intensidade baixa, progressão mais
  lenta, mais recuperação entre estímulos).

**Continuação (2026-08-19)** — link bonito pro app do aluno:
- **Domínio customizado configurado**: `https://panzerirun.eltonpanzeripersonal.com.br` (CNAME no
  Hostinger, domínio + SSL adicionados no serviço `panzeri-run-app` do EasyPanel, marcado como
  primário). O link antigo do EasyPanel continua ativo em paralelo — ninguém que já usa o app
  precisa fazer nada, confirmado funcionando via teste direto no domínio novo. Ver
  `DEPLOY_APP_ALUNO.md` pro registro completo, incluindo a variável `STUDENT_APP_URL` que o
  treinador ainda precisa configurar no EasyPanel pra mensagens automáticas linkarem pro domínio
  novo.
- De passagem, mapeados os domínios reais que o treinador tem: `eltonpanzeripersonal.com.br`
  (Hostinger), `eltonpanzeripersonal.com` e `personaleltonpanzeri.com.br` (HostGator, mesma
  hospedagem). Também existe `xn--imersoamaisdaautoestima-b7b.com.br` (HostGator) — landing page
  de um curso antigo que não vingou, sem relação com o Panzeri Run, deixado como está.
- Percebido de passagem: a VPS Hostinger já tem registros DNS reais pra `evolution`/`n8n`/`painel`/
  `webhook`, mais avançado do que o registrado antes ("nada configurado ainda") — vale reconferir
  o estado real dessa integração quando ela for retomada.
- **Landing page de divulgação criada e publicada** em `https://eltonpanzeripersonal.com.br`
  (raiz do domínio, via registro ALIAS/CNAME no Hostinger apontando pro serviço `panzeri-run-api`
  no EasyPanel — precisou apagar um registro A pré-existente na raiz antes do ALIAS ser aceito).
  Servida direto pela API (`apps/api/src/landing-page.ts`, rota `GET /` em `app.controller.ts`),
  mesmo padrão das páginas legais — HTML autossuficiente com fontes embutidas (Big Shoulders
  Display, Public Sans, JetBrains Mono), sem chamada externa nenhuma.
  - **Processo de conteúdo real**: a primeira versão explicava o produto/a IA e comparava com apps
    genéricos — o treinador rejeitou de forma contundente ("você está criando uma página pra
    justificar a IA. Isso o aluno não quer saber"), trazendo um texto próprio extenso sobre medos
    reais de quem corre (medo de se machucar, de descobrir que não consegue, de parecer ridículo,
    de não pertencer, de fracassar depois de começar, de perder liberdade, entre outros) e pedindo
    que a página evocasse a sensação de "alguém vai cuidar disso pra mim", sem virar checklist.
    Reescrita como página curta (4 blocos: abertura "Você não precisa saber o que fazer", o treino
    muda toda semana, credibilidade citando o Elton, preço + chamada final) — o treinador também
    corrigiu um erro de posicionamento meu ("Elton acompanha você" prometeria atenção pessoal que
    não existe): quem cuida/nota/ajusta é o **app**; o Elton dá legitimidade e rosto, não presença
    contínua. O treinador vai buscar feedback de alunos reais antes de revisar mais a fundo.
  - Logo usado por enquanto é o ícone simples já existente no código (`apps/mobile/public/icon.svg`)
    — o logo mais trabalhado que o treinador tem hoje só existe como imagem colada no chat, não
    virou arquivo utilizável; falta ele mandar o arquivo de verdade.
- **Incidente de tarefas em segundo plano**: um `Bash` de sincronização ficou preso rodando por
  2h37min sem eu perceber (parado, sem gastar crédito de IA, mas sem eu ter confirmado o término).
  Encontrado e finalizado só depois do treinador notar no painel "Tarefas em segundo plano" e
  reportar como cobrança inesperada — o gasto real veio do uso normal da sessão longa passar da
  janela de 5h incluída no plano, não da tarefa presa em si, mas o hábito de nunca deixar algo
  em segundo plano sem confirmar o fim ficou reforçado. Combinado com o treinador: avisar sempre
  que alguma tarefa ficar em segundo plano, pra ele decidir se deixa ou interrompe.

**2026-08-20** — satisfação em 4 dimensões + bug real de backup nunca ter funcionado:
- **Satisfação do treino virou 4 perguntas específicas**, a pedido do treinador ("pergunta vaga
  = aluno perdido, igual comando vago pra IA"): elaboração do treino, fazer o treino (reaproveita
  a coluna `satisfaction` já existente), como conseguiu fazer, e carga/adequação do esforço. As 3
  primeiras usam escala Amei→Detestei (1 a 5); a de carga usa escala própria em torno de zero
  (muito leve=-2 ... muito pesada=+2), porque "na medida" é o alvo, não um extremo — nunca "quanto
  maior, melhor". Sem nenhuma fórmula decidindo ou validando o treino em cima disso (mesma regra
  de sempre) — é só quantificação pra enxergar padrão ao longo do tempo, exibida agora no detalhe
  da sessão e no relatório de evolução do painel do treinador.
- **Bug real, sério, encontrado no primeiro deploy do dia**: o backup diário automático do banco
  (`BackupService`, já existia em código há tempos, e-mail com dump via Resend) **nunca funcionou
  de verdade em produção** — faltava a variável `BACKUP_EMAIL_TO` (fácil) E o binário `pg_dump`
  nunca foi instalado na imagem Docker real usada pelo EasyPanel (grave). Achado um `Dockerfile`
  duplicado e não usado em `apps/api/Dockerfile` que já tinha `postgresql-client` — alguém (ou uma
  sessão anterior) já tinha tentado consertar isso antes, só que no arquivo errado, que o
  `README.md` já documentava como não sendo o usado pela API (`Dockerfile` da raiz é o real).
  Duplicata removida; `pg_dump` instalado no Dockerfile certo, versão 16 pinada via repositório
  oficial da PostgreSQL (bate com `postgres:16` do banco — cliente mais antigo que o servidor não
  é garantido pelo Postgres). De brinde, o `Dockerfile` da raiz nunca tinha entrado no script de
  sincronização — corrigido, senão essa correção não teria ido pra lugar nenhum.
- **Deploy do dia teve 2 tentativas extras falhando** por um motivo totalmente à parte do `pg_dump`:
  minha mudança no Dockerfile invalidou o cache do Docker numa camada anterior à instalação dos
  pacotes Node, forçando reinstalar do zero — nessa reinstalação, o `corepack` baixou uma versão
  mais nova do `pnpm` (11.22.0) que passou a bloquear por padrão os scripts de instalação do
  Prisma/NestJS. Primeira tentativa de correção (`pnpm.onlyBuiltDependencies` no `package.json`)
  não funcionou porque o pnpm novo não lê mais essa chave dali — achada a configuração já certa
  (`onlyBuiltDependencies`/`allowBuilds`) no `pnpm-workspace.yaml` da raiz do monorepo, só que esse
  arquivo nunca é copiado pro Dockerfile isolado da API; criado o mesmo arquivo dentro de
  `apps/api` e ajustado o Dockerfile pra copiá-lo. Build seguinte avançou bem mais longe, mas
  parou em `nest build` por faltar copiar `tsconfig.build.json` — **deixado pra depois**, sem
  urgência (o deploy anterior, que já tinha o `pg_dump` funcionando, tinha subido com sucesso
  antes disso, então produção não ficou quebrada em nenhum momento).
- **Timeout de geração de treino subiu de 300s pra 600s (10 minutos)**, a pedido do treinador —
  confirmado que isso não aumenta custo de token nenhum (o timeout só decide quando o servidor
  desiste de *esperar*, a chamada pra IA continua rodando de qualquer jeito). Atualizados juntos,
  pra manter a mesma lógica: `GENERATION_ATTEMPT_COOLDOWN_MS` (precisa ser >= o timeout, senão o
  aluno tentaria de novo antes da 1ª tentativa ter chance de terminar) e o polling do app mobile
  (`MAX_POLLS`, de 40 pra 80 tentativas). Textos pro aluno atualizados em 6 lugares no `App.tsx`
  pra dizer "até 10 minutos" em vez de "instantes"/"alguns minutos"/"5 minutos".
- **Tamanho dos textos gerados pela IA aumentado**: `recommendation` (orientação geral da semana)
  +10% (1200→1320 caracteres); `notes` de cada sessão (corrida e força) +30% (900→1170), incluindo
  a orientação no prompt de "4 a 6 frases" pra "5 a 8 frases". Estimativa de custo: uns 15-20% a
  mais de tokens de saída por geração semanal — poucos centavos a mais, não um salto grande.

**2026-08-21** — bug real reportado por uma aluna de verdade (Lucelane): o app passou a bloquear a
tela dela com "Entrevista inicial pendente", e um e-mail automático mandou "sua entrevista está
incompleta" — apesar dela ter plano ativo e histórico real de treinos rodando. Causa: a conta dela
tem `OnboardingInterview.completedAt` vazio no banco (provavelmente criada antes desse campo
existir, ou direto pelo painel, sem passar pela tela formal de entrevista) — e o redirecionamento
do Bloco 2 (`apps/mobile/App.tsx`, adicionado 18/08) e o e-mail automático de entrevista incompleta
(`checkInterviewIncomplete`) usavam só esse campo pra decidir, sem considerar que a aluna já tinha
rotina configurada de verdade. **Nada foi perdido** — o plano dela sempre esteve intacto no banco,
era só a tela errada aparecendo por cima. Corrigido nos dois lugares: agora só força a tela de
entrevista (ou manda o e-mail) se, além de `completedAt` vazio, a aluna também nunca configurou
nenhuma rotina (`WeeklyAvailability` vazia) — sinal forte de que realmente nunca foi onboarded.
- **Backup continuava quebrado mesmo depois da correção de ontem, com motivo diferente**: instalei
  `postgresql-client-16` presumindo que a versão de produção era Postgres 16 (copiando do
  `docker-compose.yml` LOCAL), sem verificar a versão real do banco do EasyPanel — que na verdade
  é Postgres 17.10. `pg_dump` não lê dump de servidor mais novo que ele mesmo, então falhava com
  "server version mismatch". Corrigido pra `postgresql-client-17` (confirmado direto no erro real
  de produção, não presumido). De brinde, corrigido também o `docker-compose.yml` local (que
  também estava em Postgres 16, E ainda apontava pro `Dockerfile` duplicado que foi removido) —
  e ele nunca tinha entrado no script de sincronização, mesmo padrão de falha de hoje cedo.
- **Registrado, mas ainda não implementado**: com 5+ incidentes desse exato tipo em 2 dias (arquivo
  só existe de um lado, nunca no script de sincronização), fica cada vez mais claro que vale a pena
  um diff determinístico entre a pasta de origem e o espelho do GitHub antes de cada sincronização
  — ver `PROPOSTA_HARNESS_AGENTES.md` pra esse e outros pontos em aberto da discussão de harness.

**2026-08-27/28** — Investigação real de cobrança (aluna/aluno Rodrigo), infraestrutura de acesso
permanente pra mim, rastreio de entrega de e-mail, e correção de bug de logout no painel:
- **Bug real de cobrança, dois defeitos distintos na mesma função**: Rodrigo apareceu como
  "atrasado" no dia do vencimento mesmo pagando pontualmente todo mês. Causa raiz nº1:
  `isFuturePending` em `billing.service.ts` comparava timestamp bruto (`new Date(dueDate)` vs
  `new Date()`) em vez de comparar por dia de calendário no fuso de São Paulo — corrigido com um
  helper `saoPauloDateString()`. Causa raiz nº2: quando o Asaas deixa uma cobrança antiga travada
  no status literal `'pending'` por semanas sem nunca virar `'overdue'` de verdade, o sistema não
  tinha branch pra esse caso — adicionado `hasEverPaid` (olha se o aluno já teve qualquer pagamento
  confirmado antes) pra resolver esse status como `'overdue'` corretamente em vez de sumir a aluna
  da lista. Durante a investigação, cometi um erro sério e corrigido a tempo: tentei trocar o
  filtro de "quem é aluno de verdade" de `subscriptionStatus` para `studentCode` presumindo que
  fosse mais confiável — isso reintroduziu contas fantasmas antigas (Daiana, Cláudio) na lista real
  de alunos, porque elas tinham `studentCode` de antes da regra de 18/08 mudar. Revertido nos 5
  lugares que eu tinha alterado assim que o treinador percebeu ("Você fez todo mundo voltar a ser
  alunos... Preste atenção!!!!"). Também errei uma conclusão sobre "o pagamento de julho demorou um
  mês" — era o campo errado do Asaas (`paymentDate`, data de repasse ao lojista, não data real do
  pagamento); corrigido com o campo certo (`clientPaymentDate`/`confirmedDate`).
- **Acesso de leitura permanente à API de produção pra mim**: até aqui, qualquer investigação real
  exigia o treinador extrair e colar um token de sessão manualmente. Criado `CLAUDE_TOOLING_API_KEY`
  (header `x-tooling-key`, comparação a prova de timing attack) protegendo um controller novo
  (`coach-tools`) que expõe só rotas de LEITURA sem nenhum efeito colateral (dashboard, histórico de
  cobrança, prospectos, ex-alunos, log de mensagens) — deliberadamente NÃO expõe a ficha completa de
  um aluno (essa rota dispara sincronização do Strava, que tem custo/efeito colateral).
- **Rastreio real de entrega de e-mail**: até aqui o sistema só sabia se o `POST` pro Resend tinha
  sido aceito, não se o e-mail realmente chegou. Implementado webhook do Resend
  (`POST /messaging/resend/webhook`, verificação manual de assinatura Svix/HMAC — sem depender de
  nenhuma lib nova) que atualiza `MessageLog.deliveryStatus` (delivered/opened/clicked/bounced/
  complained) conforme os eventos chegam. Usado pra confirmar de verdade que os e-mails de recuperação
  de prospecto estavam sendo entregues, e pra mandar (com autorização explícita do treinador) um
  e-mail avulso real pra uma prospect (Patrícia) sobre treino remoto — entrega confirmada pelo
  próprio webhook.
- **Bug real: painel do treinador deslogava sozinho ao recarregar a página**. Causa: o backend guarda
  só UM refresh token válido por usuário por vez (o mais recente sempre invalida o anterior) — e o
  React StrictMode do Next.js (dev mode) disparava o `useEffect` de restauração de sessão duas vezes
  no mesmo carregamento, cada chamada tentando renovar o token e derrubando a outra no meio. Corrigido
  com deduplicação da chamada de refresh (`useRef` guardando a promise em andamento) + só renovar se
  o access token salvo já não for mais válido (decodifica o `exp` do JWT direto, sem chamar a API) +
  estendido o tratamento de sessão expirada (401 → tenta renovar 1x → desloga só se falhar de novo)
  pras outras 5 telas do painel que ainda não tinham isso.

**2026-08-28** — configuração de build Android nativo do zero, na máquina real do treinador
(Windows, sem privilégio de administrador):
- Instalados JDK 17, Android SDK (cmdline-tools, platform-tools, platform 34, emulator, imagem de
  sistema x86_64), criado um emulador de teste (Pixel 6, Android 14) — tudo via `winget --scope user`
  (o escopo padrão de admin falhava pela sandbox), com um passo (aceitar licenças do SDK) que só
  funcionou rodado pelo próprio treinador num terminal de verdade dele (a ferramenta de terminal
  desta sessão não tem entrada interativa real).
- **Bug real de build corrigido**: o plugin Gradle do React Native não conseguia resolver o pacote
  `react-native` através dos links simbólicos que o pnpm usa por padrão em monorepos — corrigido com
  `node-linker=hoisted` num `.npmrc` na raiz (recomendação oficial do Expo pra esse cenário),
  documentado com comentário explicando o porquê.
- **App nativo travava ao abrir, dois bugs reais e sérios, achados e corrigidos em sequência**: o
  app tem uma proteção "tela de erro" (`ErrorBoundary`) que avisa o treinador via Telegram sempre que
  algo quebra — foi exatamente essa proteção que expôs os dois problemas. Causa raiz dos dois: código
  que rodava sem checagem em `window.location` (usado pra ler parâmetros de URL no fluxo web/PWA) —
  no app nativo React Native, `window` existe como objeto global (então `typeof window === 'undefined'`
  engana, parece "seguro"), mas `window.location` não existe de verdade, então `window.location.search`
  quebrava com "Cannot read property 'search' of undefined". Um dos dois pontos
  (`initialAuthMode()`) rodava como inicializador de estado, ANTES de qualquer `.catch()` poder
  proteger — por isso o primeiro sintoma foi a tela travando pra sempre em "Abrindo aplicativo...",
  sem nenhum erro visível. Corrigido nos dois pontos com guarda por `Platform.OS !== 'web'` (mais
  robusto que checar cada propriedade de `window` uma por uma), mais uma rede de segurança
  (`.catch()`) em toda a cadeia de restauração de sessão pra garantir que qualquer erro futuro
  parecido sempre leve à tela de login em vez de travar pra sempre.
- **Otimização de token de sessão**: o app não sabia que o access token salvo (válido por 12h) ainda
  estava bom, e gastava o único refresh token válido toda vez que abria — corrigido decodificando o
  `exp` do JWT localmente (decodificador base64 escrito à mão, sem depender de `atob`, que não é
  garantido existir no motor JS nativo/Hermes) tanto na restauração de sessão quanto no timer
  periódico de 12 em 12 minutos.
- **Primeiro boot nativo do Panzeri Run bem-sucedido** (Android, emulador) — login, navegação e
  registro de treino confirmados funcionando de ponta a ponta pela primeira vez fora do navegador.

**2026-08-28/29** — RevenueCat (compra dentro do app nas duas lojas) e primeiro build iOS real:
- **Contexto**: o backend já tinha, de uma sessão anterior, todo o tratamento do lado do servidor
  pronto (webhook do RevenueCat em `billing.service.ts`, mapeando eventos de compra/renovação/
  cancelamento/reembolso pra `subscriptionStatus`, com `subscriptionProvider: 'revenuecat'` isolado
  do fluxo Asaas pra nunca os dois decidirem o status do mesmo aluno ao mesmo tempo) — só faltava o
  SDK dentro do app e as contas/credenciais reais das lojas.
- **SDK integrado no app** (`react-native-purchases`): configurado no login (`Purchases.configure`/
  `logIn`, usando o mesmo `userId` do JWT — extraído localmente do token, sem chamada nova à API —
  como identificador, batendo exatamente com o que o webhook do backend espera), desconectado no
  logout. As duas telas de assinatura do app (a da aba Semana, quando o plano está bloqueado, e a
  aba Pagamento) agora detectam automaticamente se estão rodando num app nativo com o RevenueCat
  configurado: nesse caso, a compra é feita direto pela loja (Google Play/App Store), sem CPF e sem
  passar pelo link do Asaas — que continua sendo o único caminho na versão web/PWA.
- **Conta RevenueCat criada e configurada** pelo treinador, com credenciais dos dois lados:
  - **Android**: conectado ao Google Play (nome do pacote, service account — pendente de o
    treinador terminar de gerar o arquivo JSON de conta de serviço no Google Cloud, ver pendências).
  - **Apple**: chave de assinatura ("Subscription Key", tipo `SubscriptionKey_*.p8`, diferente da
    chave geral de API — confundimos os dois tipos na primeira tentativa, corrigido) gerada no App
    Store Connect e validada com sucesso no RevenueCat ("Valid credentials").
- **Primeiro build iOS real, gerado e testado num iPhone físico do treinador** (Windows não roda
  simulador iOS, então esse teste só é possível assim): configurado perfil `preview` no `eas.json`
  pro iOS, corrigido um aviso da Apple (`ITSAppUsesNonExemptEncryption: false`, evita um passo manual
  extra no envio de cada build), e — depois de contornar dois problemas de ambiente do lado do
  treinador (pnpm não instalado na conta do Windows dele; uma variável `CI=true` que ficou grudada
  numa janela do PowerShell e fazia o EAS achar que estava rodando sem interação humana, travando
  o login da Apple) — o build terminou, foi instalado via QR code, e **rodou perfeitamente**: login,
  navegação e registro de treino confirmados também no iOS nativo, sem nenhum dos bugs corrigidos
  ontem no Android.
- No App Store Connect, o produto de assinatura mensal (`panzeri_run_mensal`, grupo "Panzeri Run
  Mensal") já estava criado e configurado (nome, descrição em português, disponibilidade) de uma
  sessão anterior — falta só confirmar o preço final e enviar junto com um build de produção real
  (a Apple exige que a primeira assinatura recorrente seja enviada junto com uma versão do app,
  não pode ser ativada sozinha).
- **Investigado um alerta real de produção** (Telegram, "Cannot read property 'search' of
  undefined", vindo de `Login`): confirmado, pela assinatura exata da mensagem de erro (formato
  antigo, característico do motor Hermes do React Native nativo, diferente do formato atual de
  navegador), que era o mesmo bug do `window.location` já corrigido nesta sessão — só não tinha
  chegado ainda a nenhum build novo. Não afeta nenhuma aluna real (a produção real que as alunas
  usam hoje é a PWA web, que nunca teve esse bug); era o próprio treinador testando um APK antigo.

**2026-08-30** — identidade visual aplicada de verdade no app (ícone/splash não bastavam), bug real
crítico de geração corrigido (aluna Roberta), e início do processo pra aumentar o limite de alunos
no Strava:

- **Identidade visual, fase 2 completa**: a sessão anterior só tinha trocado ícone/splash/símbolo do
  onboarding — o treinador reclamou, com razão, que "por dentro" o app continuava com a cara antiga.
  Corrigido: cor de decisão primária (Verde Pulso, texto escuro) aplicada em **todos** os botões
  principais do app (mais de 15 lugares — pagamento, salvar treino, salvar anamnese, Strava, etc.),
  ícone de destaque trocado do azul genérico antigo pro Azul Profundo da marca em todo lugar,
  cabeçalho fixo (aparece em toda tela logada) reestilizado com o símbolo real da marca.
- **Tela de Semana reorganizada** (pedido direto do treinador, 3 mudanças): "Avisos" saiu de cima do
  treino e virou item de menu com contador; removido um texto que incentivava indevidamente o aluno
  a ficar mudando a rotina toda hora; a caixa "Orientação da semana" passou a começar fechada (antes
  competia visualmente com o treino de verdade). Nessa mesma rodada, achado e corrigido um bug real
  já existente: em dois estados específicos da tela, o aviso "seu treino pode levar até 10 minutos"
  nunca era exibido de fato (só o texto do botão mudava pra "Gerando...") — explica relatos antigos
  de "cliquei e não aconteceu nada". Adicionado spinner visual nos botões de gerar treino.
- **Bug real crítico corrigido: geração de treino falhando sempre para a aluna Roberta Kemp**. Causa
  raiz encontrada direto no log de produção: uma diretriz detalhada dela (sessões com várias partes
  encadeadas — séries + caminhada de recuperação + transições) fazia a IA decidir uma "parte" bem
  curta demais, e o schema de validação (Zod) exigia no mínimo 0,05 km pra **qualquer** parte —
  rejeitando a resposta inteira por causa de uma única parte pequena. Corrigido pra um mínimo bem
  menor (0,01, não zero — zero quebraria o cálculo de duração, que é sempre distância × pace, sem
  campo de tempo independente; a primeira tentativa de correção cometeu exatamente esse erro e foi
  pega na autorevisão antes de ir pro ar).
- **Processo de sincronização revisto**: essa sessão criou branches separadas pra cada mudança
  (identidade visual, depois uma segunda parte, depois a tela de Semana) — gerou fricção real e
  desnecessária pro treinador (várias telas de "Pull Request"/mesclagem no GitHub, quando antes
  bastava commit direto). A partir de agora, o padrão volta a ser sincronizar direto pra `main`, sem
  branch nem PR — branch só quando o treinador pedir explicitamente.
- **Investigação do limite de alunos conectados no Strava**: a conta está no "Standard Tier" da API
  do Strava, limitada a 10 atletas conectados simultaneamente (confirmado: 10 de 10 no momento).
  Pesquisado o processo atual (mudou em 2026): auto-upgrade até 10 é direto no painel, sem formulário;
  acima de 10 precisa de revisão manual da Strava (Developer Program form, com capturas de tela de
  onde os dados do Strava aparecem no app + o botão de conectar). Confirmado que a assinatura Strava
  do treinador está ativa (sem risco pelo prazo de 30/06/2026 que a Strava impôs pra manter acesso à
  API). Formulário de revisão enviado pelo treinador ao final da sessão — aguardando resposta deles.

**Lição de processo registrada nesta sessão** (o próprio treinador pediu um "prontuário" separado
pra isso): ver `LICOES_COLABORACAO.md` na raiz do projeto — registro de erros reais de comportamento
meu (não de código) nas conversas, pra reduzir repetição.

**2026-08-31** — Novo recurso: check-in semanal obrigatório antes de gerar o próximo treino,
implementado a pedido explícito do treinador, com uma razão estratégica clara por trás — coletar
dado limpo e estruturado (não texto livre) sobre adesão/satisfação de cada aluna, de forma
sistemática, para no médio prazo permitir identificar padrão de engajamento, risco de abandono ou de
lesão e agir antes que vire problema:

- **Fluxo**: ao tocar em "Gerar treino da semana", o app primeiro busca
  `GET /training-plans/weekly-checkin/status`. Se a aluna ainda não fez o check-in daquele plano,
  mostra (a) uma tela de confirmação com a contagem real de sessões feitas como previsto, com
  modalidade trocada, diferentes do previsto e sem nenhum registro — pedindo que ela confirme que
  registrou tudo antes de seguir (se responder que não, é direcionada a voltar e registrar); depois
  (b) 3 perguntas obrigatórias em escala 1–5: satisfação com a elaboração dos treinos da semana,
  satisfação com o próprio cumprimento geral dos treinos, e motivação para a próxima semana. A
  explicação de "pra que serve" some depois das duas primeiras vezes que a aluna responde (pedido do
  treinador — espera que ela aprenda o padrão).
- **Dado guardado é sempre número, nunca texto livre** — nova tabela `WeeklyCheckIn` no banco, um
  registro por (aluna, plano), com os 4 números de contagem confirmados pela aluna + as 3 notas de
  escala. Objetivo explícito é permitir análise de padrão depois (sistemas complexos, adesão,
  engajamento, sinal de abandono/lesão), o que exige dado consultável, não prosa.
- **Sem custo de IA extra**: o check-in em si é só leitura/gravação de banco. As 3 respostas de
  escala do check-in do plano que está sendo fechado são incluídas no mesmo prompt que já ia pra IA
  na geração da próxima semana (`autoavaliacaoDaSemanaPeloAluno`), com instrução explícita de como
  pesar isso (sinal real, nunca decisor sozinho/fórmula) — nenhuma chamada nova à IA.
- **Cuidados de consistência aplicados** (3 rodadas de autorevisão antes de liberar): os números
  salvos são exatamente os que a aluna viu e confirmou na tela (não recalculados de novo no
  `submit`, pra não divergir se algo mudar no meio do caminho); o check-in é amarrado ao plano exato
  que está sendo fechado (`planId`), não "o mais recente que existir", pra nunca vazar autoavaliação
  de uma semana errada pro prompt; a rota de status é só leitura de verdade (adicionado `skipCache`
  no `StravaService.report()` pra não disparar gravação de cache ao só consultar o resumo); conta de
  dias sempre no fuso América/São_Paulo (não no fuso do servidor); e uma trava real no banco
  (`@@unique([userId, planId])`) garante um único check-in por plano mesmo em toque duplo/dois
  aparelhos ao mesmo tempo.
- **Sincronizado e implantado pelo próprio treinador** (commit direto pra `main`, sem branch, como
  combinado) na noite de 31/08. Verificação pós-deploy feita por mim sem precisar dele: rota
  `GET /training-plans/weekly-checkin/status` responde `401 Unauthorized` sem token (existe e está
  protegida, não `404`), API respondendo normalmente, cron diário de cobrança rodou às 6h como
  sempre — nenhum sinal de erro. Teste de ponta a ponta clicando de verdade (tela aparecendo, números
  batendo, treino sendo gerado depois) ainda não foi feito por falta de uma sessão de aluna real à
  mão nesta verificação; fica como próximo passo.

**2026-09-01** — Ajuste nos e-mails de recuperação de prospecto (`ProspectNurtureService`), a pedido
do treinador: o link mágico precisava levar de verdade pra onde a pessoa parou, não só pro login:

- **Bug real corrigido**: quem já tinha terminado as 5 perguntas rápidas mas nunca pagou (nível
  "quente" — já tem cobrança criada no Asaas) caía, ao clicar no link do e-mail, na aba "Semana"
  (sem nenhum plano pra mostrar), e não na aba de pagamento — mesmo o e-mail dizendo "falta só
  confirmar o pagamento". Causa: o roteamento pós-login (`App.tsx`) só tinha regra pra forçar a aba
  certa em dois casos (entrevista completa pendente / 5 perguntas pendentes) — faltava o terceiro
  caso (5 perguntas feitas, mas sem pagamento), que caía no padrão genérico. Corrigido: agora manda
  direto pra aba de assinatura nesse caso. Os outros dois níveis (quem nunca começou e quem está no
  meio das perguntas) já caíam certo — o link mágico sempre abre exatamente onde a IA sabe que a
  pessoa parou, sem precisar de nenhuma lógica extra no e-mail em si.
- **Textos reescritos pra serem mais persuasivos** nos 4 degraus da sequência (8h/24h/7d/30d),
  diferenciando quem está a um passo do pagamento (nível "quente" — copy focado em "não perca o que
  já fez", urgência real) de quem ainda precisa terminar o cadastro. Link sempre em destaque logo no
  início do bloco de call-to-action (não mais só no fim do parágrafo), reforçando o "pra que serve"
  de clicar.
- **Bug real corrigido no painel (admin)**: a lista "Ex-alunos" (quem já pagou e cancelou) sempre
  foi só uma tabela estática — não dava pra clicar numa linha e abrir o painel completo da aluna
  (treinos, histórico, tudo), diferente da lista "Alunos". Reportado pelo treinador depois de uma
  aluna pedir cancelamento e ele perder o acesso ao painel dela. Corrigido: linha da tabela agora é
  clicável e abre o mesmo painel de sempre — sem tirar a aluna da lista "Ex-alunos" nem fazê-la
  reaparecer em "Alunos" (a lista operacional já exclui quem tem `subscriptionStatus: 'canceled'`
  por design, desde 27/08 — só o botão de abrir o painel estava faltando).

**2026-09-02** — Painel do treinador reorganizado em abas, e sessão longa fechando praticamente toda
a ficha do app Android no Google Play Console:

- **Painel do aluno virou abas, em vez de página única gigante**: o treinador reportou precisar
  mandar 7 prints só pra mostrar o painel de uma aluna, de tanto scroll. Reestruturado em duas
  rodadas: (1) clicar num aluno agora troca a lista por uma vista dedicada dela (com botão "Voltar
  pra lista"), em vez de empilhar os dois na mesma tela; (2) dentro dessa vista, 6 abas (Treinos,
  Cadastro, Avaliação, Diretrizes, Semanas anteriores, Evolução) — cada uma só com o que interessa
  naquele momento. Cabeçalho ficou compacto de propósito (só nome/código/Strava, sempre visível
  acima das abas) depois de feedback direto do treinador de que o cadastro inteiro competia com o
  que ele queria ver na aba Treinos. Decisão técnica: `<>` (Fragment) em vez de `<div>` por aba, pra
  não quebrar os seletores CSS de grid que já existiam (`.detailPanel > .classe`). Combinado junto
  com o treinador: essa é a fase 1 de um plano de 3 — depois vem um dashboard de evolução agregando
  dado que já existe (aderência, notas do check-in semanal, satisfação por sessão), e só depois
  disso, novos campos de coleta (streaks, ciclo menstrual etc.) — esse último atrelado a finalmente
  fazer a revisão jurídica dos Termos/Política, dado que ciclo menstrual é dado pessoal sensível.
- **RevenueCat Android, destravado de vez**: a chave de conta de serviço gerada em 31/08 nunca tinha
  sido baixada de verdade (confirmado vasculhando Downloads); gerada de novo, política
  `iam.disableServiceAccountKeyCreation` bloqueou de novo (2ª vez que isso acontece, vale investigar
  se tem algo revertendo a substituição de política) e foi desativada de novo do mesmo jeito. Achado
  o motivo real da validação falhar mesmo com a chave certa: a conta de serviço nunca tinha sido
  convidada como usuária no Play Console (`Usuários e permissões` só tinha o próprio treinador) —
  convidada com as permissões certas, credenciais validaram 100%.
- **Ficha completa do app no Play Console preenchida numa sessão só**: política de privacidade,
  detalhes de login (conta de teste dedicada, senha trocada na hora), categoria/contato,
  classificação de conteúdo (questionário IARC completo), público-alvo (18+), texto da loja
  (nome/descrição curta/completa), ícone e banner (gerados por código, formas simples — não IA
  generativa), 2 capturas de tela reais (tiradas do próprio iPhone do treinador), segurança dos
  dados (formulário completo de tipos de dado coletado/compartilhado, honesto e batendo com o schema
  real do banco — teve que ser refeito uma vez porque uma navegação perdeu respostas no meio), sem
  recursos financeiros, e recursos de saúde declarados só como "atividade e condicionamento físico"
  (não como nutrição/ciclo menstrual/sono — esses ainda não existem no app, ver acima).
- **Política de privacidade ganhou seção explícita de exclusão de conta** (pedido do próprio
  formulário do Google, que exige uma URL explicando os passos): e-mail dedicado, prazo de resposta
  em 5 dias úteis / conclusão em até 15 (prazo definido com o treinador, não presumido por mim),
  lista clara do que é apagado vs. o que fica retido por obrigação fiscal.
- **Descoberta importante pro cronograma**: o Google exige teste fechado com no mínimo 12
  testadores participando por pelo menos 14 dias corridos antes de liberar acesso de Produção pra
  qualquer app novo — não dá pra pular essa etapa nem acelerar. Isso empurra a data mínima de
  lançamento público em pelo menos 2 semanas a partir de quando o teste fechado começar de verdade.
- **Build de produção Android (`.aab`) gerado** via novo script `gerar-app-android-producao.bat`
  (perfil `production` do EAS, diferente do perfil `preview` usado antes só pro teste no emulador) —
  ficou ~5h na fila gratuita da Expo (avaliado e descartado assinar plano pago só por isso: resolve
  velocidade, não é algo que vá ser precisado com frequência).
- **Trilha de teste fechado criada no Play Console**: lista de testadores "Teste Panzeri Run" com 5
  alunas confirmadas (Eduarda, Mariana, Elizângela, Vanessa, Juliana — todas já pagantes/cortesia,
  zero risco de cobrança); mesma lista também cadastrada em "Teste de licença" (conta), pra quando os
  ~8 testadores externos (amigos/família, sem assinatura) forem adicionados não correrem risco de
  cobrança real caso abram a tela de pagamento por engano.
- **Bloqueio real ao tentar subir o `.aab`**: o Google mudou a exigência mínima de versão do Android
  (API 36) a partir de 31/08/2026 — pegou o projeto desatualizado (Expo SDK 51, de 2024, mira só API
  34) e a versão do RevenueCat também precisa de uma biblioteca de faturamento mais nova. Investigado
  o escopo exato (Expo SDK 51→54 + RevenueCat 8→9) sem precisar do treinador — risco baixo/moderado
  (o app não usa as bibliotecas que mais costumam quebrar nesse tipo de upgrade), único ponto de
  atenção real é o Android ligar "edge-to-edge" por padrão a partir dessa versão, que pode bagunçar
  visualmente o cabeçalho fixo do app — precisa de teste visual antes do próximo build de produção.
  Deixado como próxima tarefa técnica, não forçado no fim de uma sessão já longa.

**2026-09-03** — Upgrade executado, testado de verdade e publicação automatizada, tudo sem precisar
do treinador clicar em nada além de duas autorizações pontuais:

- **Expo SDK 51→54 + RevenueCat 8→10 feitos**: `npx expo install expo@54 --fix` resolveu a maioria
  sozinho; React 18→19, React Native 0.74→0.81. Achado e corrigido de fato o risco visual previsto:
  `SafeAreaView` vinha do pacote `react-native` puro, que **nunca aplicou área segura no Android**
  (só no iOS — só "funcionava" porque o Android reservava sozinho o espaço da barra de status,
  reserva que o edge-to-edge obrigatório do SDK 54 remove). Trocado por `SafeAreaView`/
  `SafeAreaProvider` de `react-native-safe-area-context` (já era dependência).
- **Testado de verdade num emulador Android local** (Pixel 6, sem precisar do treinador — instalado
  via `adb install`, navegado via `adb shell input`/`screencap`): cabeçalho confirmado correto, sem
  sobreposição com a barra de status. No caminho, achado um incidente real e público do lado da
  Expo (status.expo.dev: cache de artefatos Maven fora do ar por algumas horas) que derrubou as
  duas primeiras tentativas de build — nada a ver com o projeto, confirmado antes de insistir.
- **Publicação automatizada via API oficial do Google Play**: como o treinador ia sair, criado um
  script Node autônomo (sem dependência nenhuma, só `crypto`/`fetch` nativos) que autentica com a
  conta de serviço já usada pelo RevenueCat (permissão nova concedida: "Liberar apps para as faixas
  de teste") e publica o `.aab` direto na trilha "Teste fechado - Alpha" via API — sem precisar abrir
  o Play Console. Chave de conta de serviço salva em `secrets/` (fora do git, padrão já existente
  desde 26/08).
- Build de produção (`versionCode 3`) terminou depois do treinador sair, baixado e publicado na
  trilha "Teste fechado - Alpha" via API sozinho, sem precisar dele. **Falta 1 clique manual dele**:
  a API do Google recusa marcar como "completa" o primeiro envio de um app que nunca passou por
  revisão manual nenhuma — a versão ficou em "rascunho" na trilha, esperando ele abrir o Play
  Console (Teste → Teste fechado → Alpha) e enviar essa versão pra revisão de lá, só dessa vez.
  Depois desse primeiro envio manual, atualizações futuras devem publicar via API sem esse tropeço.
- Faltam também os 8 testadores externos (fora os 5 alunas já cadastradas: Eduarda, Mariana,
  Elizângela, Vanessa, Juliana) pra completar os 12 mínimos e começar a contar os 14 dias exigidos
  pelo Google.

**2026-09-03 (mais tarde, mesmo dia)** — Elton voltou e concluiu o clique manual pendente: no Play
Console (Teste → Teste fechado → Alpha → Editar versão → Avançar), apareceu um bloqueio extra não
previsto pelo script — **declaração de ID de publicidade** obrigatória (exigência do Android 13+, não
relacionada ao envio em si). Verificado no código (`grep` em `package.json` do `apps/mobile`): o
projeto não usa nenhuma lib de anúncios/analytics que dependa de Advertising ID (sem AdMob, sem
Firebase Analytics) — declarado **"Não"**. Com isso resolvido, enviadas as 14 mudanças acumuladas
(loja, testadores, política de privacidade, segurança de dados, categoria, declaração de anúncios)
para revisão do Google de uma vez. Ficou em "Alterações em análise" — revisão de teste fechado costuma
sair em horas a poucos dias (bem mais rápida que revisão de produção). Continua faltando completar a
lista de testadores até 12 (7 pessoas fora as 5 já cadastradas) antes do relógio de 14 dias começar a
contar. Elton vai divulgar o convite nos Stories dele pra tentar conseguir ~10 pessoas de uma vez,
aproveitando também como oportunidade de atrair usuários novos (não só cobrir a cota do Google) — ver
nota de viabilidade real disso (link gerenciado por lista de e-mail x link aberto) na memória
`app_store_launch_status`.

**2026-09-03 (RevenueCat Android configurado)** — Fluxo de compra real do Android estava até então
totalmente inerte: [App.tsx:5450](apps/mobile/App.tsx:5450) já tinha o código pronto desde 28/08, mas
`revenueCatAndroidApiKey` ficava vazio em `app.json` de propósito, esperando o produto existir de
verdade. Feito ponta a ponta hoje, guiado por print (login do Elton no Play Console + RevenueCat, sem
acesso direto — extensão "Claude in Chrome" não conectou nesta sessão):
- **Play Console**: criada a assinatura `panzeri_run_mensal` (plano básico `mensal`, renovação
  automática, **R$ 24,90/mês**, disponibilidade restrita ao Brasil), ativada.
- **RevenueCat**: descoberta real — nem o produto do iOS nem o do Android estavam de fato importados
  ainda (só existia um produto de teste na "Test Store" interna, ligado à offering "default"/pacote
  "Monthly", 0 transações). Importado o produto Android (`panzeri_run_mensal:mensal`, status
  "Published"), anexado ao entitlement já existente `panzeri_run_pro`, e adicionado ao mesmo pacote
  "Monthly" da offering "default" (agora com produto de teste + Android real; iOS real ainda falta).
- Chave pública do SDK Android colada em [app.json:45](apps/mobile/app.json:45)
  (`revenueCatAndroidApiKey`). **Só passa a valer no próximo build de produção** — a versão já enviada
  pro Google hoje (versionCode 3) foi gerada antes dessa chave existir.
- **Pendência nova, achada nesse processo**: o produto real do **iOS** também nunca foi importado no
  RevenueCat (só existia o de teste) — precisa do mesmo tratamento (Import + Attach entitlement +
  adicionar ao pacote) antes do lançamento iOS, item que ainda nem tinha sido retomado.

**2026-09-04 — 3 bugs reais reportados pelo Elton, investigados e 2 corrigidos**: primeira testadora
real (Silvia) usou o app e trouxe problemas concretos.

- **Mensagem de feedback de treino confusa** ([workout-completions.service.ts:87](apps/api/src/workout-completions/workout-completions.service.ts:87)):
  não dizia qual treino era, só o motivo do desvio — 3 treinos diferentes geravam 3 avisos
  idênticos no Telegram. Corrigido: agora inclui data + modalidade/título do treino.
- **Cobrança indevida da Silvia (dinheiro real)**: causa raiz não é preço errado — R$19,90 (Asaas/
  web) e R$24,90 (loja) são valores diferentes DE PROPÓSITO (decisão de 26/08, cobre comissão da
  loja). O bug real: o build Android que ela instalou foi gerado ANTES da chave do RevenueCat
  existir (ver entrada anterior, mesmo dia) — sem essa chave o app não sabe que é compra nativa da
  Play Store, cai no fluxo antigo (Asaas, pede CPF, cobra na hora). Ela deveria ter sido testadora
  gratuita. **Ações pendentes que só o Elton pode fazer** (estorno é ação financeira, fora do que a
  IA executa sozinha): estornar no painel do Asaas + marcar a Silvia como "Cortesia / liberação
  manual" no admin. Mesmo risco vale pros outros 12 testadores até o próximo build (com a chave)
  sair — recomendado marcar cortesia neles preventivamente.
- **Trava real na entrevista (pergunta do CEP)**: a pergunta de CEP exigia que a busca automática
  (ViaCEP) desse certo pra liberar "Continuar", **sem nenhuma saída manual**. Se o CEP não estava na
  base do ViaCEP (comum em condomínios/loteamentos novos) ou a API falhasse, a pessoa ficava
  travada pra sempre, perto do fim de uma entrevista longa. Corrigido: adicionado link "Não
  encontrei meu CEP, digitar endereço manualmente" que libera campos de rua/bairro/cidade/estado
  direto ([App.tsx](apps/mobile/App.tsx), componente `GuidedInterview`, estado `cepManualEntry`).
  Typecheck de `apps/mobile` e `apps/api` limpos após as mudanças.
- **Botão "Voltar" (reportado pela Jú)**: verificado — o botão existe de fato no código (desabilitado
  só na primeira pergunta), a tela tem scroll. Não achei ausência real; pode ter sido um problema de
  visibilidade numa pergunta longa, ou uma versão anterior a essa funcionalidade. Não alterado sem
  mais evidência concreta.
- **Sinal real no funil de conversão**: no painel de Prospectos, várias pessoas aparecem como
  "entrevista concluída, cobrança ainda não gerada" — ou seja, terminam a entrevista rápida e param
  exatamente na tela de pagamento, sem clicar em "Ativar minha assinatura". Diferente do bug do CEP
  (que trava no meio). Registrado como pendência de investigação focada (fricção/design da tela de
  pagamento), não atacado às cegas nesta sessão — precisa de dados reais de quantas pessoas páram
  ali antes de mudar algo.

**2026-09-04 (correção da correção)** — primeira versão da proteção contra cobrança de testador
usava uma lista de 8 e-mails **fixa no código** — o Elton apontou corretamente que isso não escala
(ele mesmo já tinha adicionado mais 2 e-mails no Play Console sem o sistema saber, chegando a 15,
alguns já alunas pagantes). Trocado por solução geral:
- Tabela nova `FreeTesterEmail` no banco (migration `20260904120000_add_free_tester_email`).
- `createCheckout` (billing.service.ts) consulta essa tabela antes de qualquer cobrança — só libera
  cortesia automática se a pessoa AINDA NÃO tiver assinatura ativa (não mexe em quem já paga).
- Nova seção **"Testadores gratuitos"** dentro de Prospectos no admin — o próprio Elton adiciona/
  remove e-mails ali, aceita colar vários de uma vez separados por vírgula/espaço, sem precisar de
  mim pra cada pessoa nova.
- **Achado no processo**: o `.bat` de sincronização (`atualizar-github-panzeri-run.bat`) tem uma
  lista de pastas de migration **fixa/hardcoded**, gerada em algum momento no passado e nunca mais
  atualizada — pelo menos 3 migrations recentes (incluindo a nova de hoje) não estavam sendo
  copiadas pro mirror automaticamente. Corrigido manualmente desta vez (copiadas na mão); o `.bat`
  em si continua desatualizado e deveria ser regenerado numa próxima sessão pra não repetir isso.

**2026-09-04 (revisão rigorosa pedida pelo Elton)** — depois de corrigir a lista geral, o Elton
pediu revisão de verdade (testar, simular erros comuns) em vez de dar por resolvido. Achados reais
nessa segunda passada, todos corrigidos:
- **Backend rejeitaria quem completasse a entrevista com CEP manual**: `completeOnboarding`
  ([me.service.ts:109](apps/api/src/me/me.service.ts:109)) exigia `personal_cep` sempre preenchido
  — quem usa a entrada manual (adicionada mais cedo hoje) nunca preenche esse campo, só cidade/
  estado. A pessoa teria passado por toda a UI achando que deu certo e recebido um erro genérico
  só no "Concluir". Corrigido: exige CEP OU cidade+estado manuais.
- **"Remover" testador da lista podia mentir sucesso**: erro real de banco era engolido igual a
  "já não existia" — corrigido pra só ignorar o caso idempotente (P2025), qualquer outro erro sobe
  de verdade.
- **Checagem de testador dependia do Asaas estar configurado/no ar** (`assertConfigured()` rodava
  antes) — testador nunca deveria depender disso pra ser reconhecido; reordenado.
- Confirmado que `applyCoupon`/outras rotas de conclusão de entrevista (reavaliação, rotina) não
  têm o mesmo problema de `personal_cep` obrigatório — só existia esse ponto único.

**2026-09-04 (auditoria de escala — "imagine 1000 assinantes")** — Elton pediu revisão completa
pensando em gargalos que só apareceriam com muito mais gente usando ao mesmo tempo. 7 achados reais
corrigidos (com `tsc --noEmit` limpo depois de cada um):
1. **Fila de IA sem limite de espera** ([ai-queue.service.ts](apps/api/src/common/ai-queue.service.ts)):
   o teto de 3 chamadas simultâneas já existia e é bom, mas não havia limite pra quanto tempo um
   pedido esperava por uma vaga — sob pico real (ex.: muita gente confirmando check-in semanal ao
   mesmo tempo), alguém podia ficar esperando minutos em silêncio, sem erro nenhum. Agora desiste
   depois de 2 minutos com mensagem clara.
2. **Cron de análise do Strava sem trava contra sobreposição** — se um dia excepcional demorasse
   mais que 24h (mais provável com mais alunos conectados), o cron do dia seguinte começaria por
   cima do anterior, processando gente 2x. Trava adicionada.
3. **Cron de sincronização do Asaas** — mesma trava, mesmo motivo.
4. **Corrida real em 3 pontos de atualização de status de pagamento** (webhook Asaas, webhook
   RevenueCat, sync manual/cron) — se o provedor reenviasse o mesmo evento 2x quase ao mesmo tempo
   (comum em webhooks, acontece por timeout), os dois processos liam "ainda não ativo" antes de
   qualquer um escrever, duplicando aviso no Telegram + e-mail + geração de treino. Trocado pra
   update atômico condicional (Postgres serializa updates concorrentes na mesma linha).
5. **Vazamento de memória lento no mapa de checkouts recentes** ([billing.service.ts](apps/api/src/billing/billing.service.ts)):
   nunca perdia entradas, só crescia pra sempre. Agora limpa entradas expiradas a cada novo checkout.
6. **Backup diário sem alerta de falha** — hoje só loga no servidor (que ninguém olha); se o dump
   crescer além do limite de anexo do Resend (risco real conforme o banco cresce), falharia
   silenciosamente todo dia até precisar restaurar algo e descobrir tarde demais. Agora avisa no
   Telegram em caso de falha, e também avisa (sem falhar) se o tamanho já estiver ficando grande.
7. **Índice ausente pros filtros mais usados** (`role`+`subscriptionStatus`+`accountStatus`, usados
   no painel do treinador, prospectos e nos crons diários) — inofensivo a 1000 linhas, mas barato de
   adicionar agora em vez de esperar crescer além disso.

**Achados identificados mas NÃO alterados** (documentados, não escondidos):
- `MAX_CONCURRENT_AI_CALLS = 3` pode ser baixo demais sob concorrência real de 1000 assinantes —
  não mudei o número às cegas porque bumpar isso sem saber o limite real de taxa da conta Anthropic
  pode piorar (trocar espera silenciosa por erros 429 em cascata). Precisa checar o limite real no
  console da Anthropic antes de decidir um número novo.
- N+1 de consultas no cron diário de avisos (até ~3000 consultas pequenas sequenciais/dia) e envio
  de push notification 1-a-1 em vez de em lote (Expo aceita lote de 100) — ambos reais, mas de baixo
  impacto na prática a 1000 assinantes (terminam em segundos/menos de 1 minuto mesmo sequenciais,
  rodam fora do horário de pico) — não mexidos pra não gastar esforço em algo sem ganho real hoje.

**2026-09-06** — Dois incidentes com testadores cobrados indevidamente, análise do Strava reprovado e documentação de integrações:

- **Incidente: Ricardo Davino cobrado pelo Asaas (R$19,90)** — segundo caso do mesmo tipo após a Silvia (04/09). Causa raiz nova: dois bugs que se combinaram. (1) O app tratava resposta de acesso liberado sem `checkoutUrl` como **erro** — mostrava a mensagem de sucesso como erro e ficava na tela de billing, bloqueando a saída. (2) Na retentativa, a guarda do `createCheckout` usava `ACTIVE_STATUSES = {'received','confirmed','received_in_cash'}` (só status do Asaas) para bloquear o acesso a assinaturas ativas, mas `manual_active` (status pós-cortesia) não estava ali — o código passava para o Asaas e criava cobrança real. **Regra absoluta que não pode ser violada:** testador gratuito nunca pode receber cobrança real do Asaas. **Correções deployadas em 06/09**: (a) `createCheckout` agora checa `user.subscriptionStatus` logo na entrada — qualquer status ativo (`active`, `manual_active`, `grace`) retorna `{ activated: true, message }` sem tocar no Asaas; (b) app trata `activated: true` ou resposta ok sem `checkoutUrl` como sucesso, mostra mensagem e recarrega o status de billing. Regra permanente de código: qualquer caminho que resulte em acesso liberado deve retornar `{ activated: true }` — nunca usar `checkoutUrl` como proxy de sucesso. Assinatura e cobrança do Ricardo canceladas manualmente no Asaas pelo treinador.
- **Verificado: único caminho de criação de assinatura/cobrança no Asaas** é `createCheckout` → `/subscriptions POST` (linha 436 do `billing.service.ts`). A guarda adicionada hoje cobre esse único ponto. O caminho do treinador (`coach.service.ts:127`) passa pelo mesmo `createCheckout`. Não existe outro lugar.
- **Strava API reprovado** — e-mail recebido negando aumento de limite. Análise completa em `integracoes/strava/analise-elegibilidade.md`. Causas prováveis: (1) sem "experiência complementar" (só extraímos dados, não devolvemos nada ao Strava); (2) descrição técnica imprecisa no formulário; (3) política de privacidade sem URL pública e sem menção a dados de terceiros; (4) política do Strava proíbe explicitamente uso de dados da API em IA — consentimento do aluno não resolve essa restrição, é uma proibição contratual direta.
- **Documentação de integrações criada** em `integracoes/` — uma pasta por plataforma (Strava, Garmin, Polar, Apple Watch/HealthKit, COROS, Amazfit), mais `COMUM.md` com o denominador comum entre todas. O COMUM.md mapeia os bloqueantes universais: Política de Privacidade pública com revisão jurídica, consentimento granular, fluxo de revogação/deleção, OAuth padronizado, minimização de dados. Nada a ser implementado sem aprovação — é material de análise.

**2026-09-05** — Investigação e implementação do plano de comunicação de estado de assinatura,
disparado por aluna real (Fernanda Zimerer) com pagamento travado em "Aguardando pagamento" (cartão
virtual bloqueando a recorrência):

- **Diagnóstico raiz**: quando a recorrência falha no Asaas, o webhook entra mas o sistema atualizava
  o `subscriptionStatus` silenciosamente sem avisar a aluna de nenhuma forma (e-mail dependia do
  Resend, que só foi habilitado recentemente; push não existia). A aluna só descobriu por conta própria.
- **3 colunas adicionadas ao schema** (migration `20260905100000_billing_notifications_infra`):
  - `BillingSubscription.overdueInvoiceUrl`: URL específica da fatura pendente atual (nunca o
    `checkoutUrl` antigo — pode apontar pra outra cobrança). Populado no webhook e no sync; limpo
    quando volta a `active`.
  - `UserNotification.action`: ação semântica interna (ex: `billing_regularize`) — nunca URL externa
    embutida na notificação; a URL real é resolvida autenticada no momento do clique.
  - `UserNotification.externalRef`: ID do evento externo (ex: `payment.id` do Asaas) — deduplicação
    primária: o mesmo evento nunca gera duas notificações, independente de janela de tempo.
- **`deriveSubscriptionContext()` exportada do `billing.service.ts`**: 5 estados derivados dos campos
  reais do banco (never_subscribed / active / cancellation_scheduled / overdue / ex_subscriber), com
  `statusMessage`, `detailMessage`, `ctaLabel`, `ctaAction` e `actionUrl` prontos pro app consumir
  sem lógica duplicada no cliente.
- **`notifyUserIfNotRecent()` no `NotificationsService`**: deduplicação em dois níveis — primário por
  `externalRef` (mesmo evento), secundário por janela de tempo sem `externalRef`. Retorna `boolean`
  indicando se a notificação foi criada ou suprimida.
- **Notificações disparadas agora em 4 caminhos**: webhook Asaas (overdue/active/canceled), webhook
  RevenueCat (CANCELLATION), `refreshFromAsaas()` (cron 6h + sync manual), cron 9h de `checkPaymentPending`.
- **App mobile atualizado**: `Billing` consome `subscriptionContext`, mostra mensagem contextual por
  estado, CTA correto por ação (`pay_overdue` abre `actionUrl` diretamente; `open_checkout`/`reactivate`
  chamam o fluxo de checkout existente). Nunca mostra "Ativar assinatura" pra quem já teve acesso.
- **`PrismaClient` regenerado** após a migration — typecheck limpo em `apps/api` e `apps/mobile`.
- **Fernanda**: indicado enviar o link de fatura diretamente pelo WhatsApp (via painel do Asaas,
  "Enviar mensagem desta cobrança") para que ela pague com outro cartão enquanto o sistema de
  notificação não estava ainda funcionando.

**2026-09-06/07** — Bugs de entrevista e melhorias de UX (sessão multitópico):

- **Aba "Rotina" adicionada ao painel admin**: antes, para ver a rotina semanal de um aluno, o treinador precisava abrir a aba Avaliação e rolar até a seção de rotina. Agora existe uma aba dedicada "Rotina" entre Avaliação e Diretrizes, com a `RoutineAvailabilityTable` e o `ManualRoutineEditor` direto, sem precisar passar pela avaliação inteira. A rotina continua disponível em Avaliação também (não foi removida de lá).
- **Bug de sincronização de modalidade (Jéssica Rodrigues)**: `syncInterviewAnswersFromAvailability` sincronizava dias/horários da entrevista quando a rotina mudava, mas esquecia de sincronizar `routine_modality_choice` — o painel e o agente de IA podiam receber uma descrição de modalidade diferente da rotina real. Corrigido em `me.service.ts`.
- **Tela de carregamento durante geração do treino**: uma aluna interpretou os 25+ minutos de silêncio durante a geração como "erro" (reportado no WhatsApp). Corrigido: quando `isLoading` está ativo, ambas as variações do bloco de geração (com e sem `notGeneratedRange`) mostram um spinner + texto explicando que pode levar alguns minutos + que o celular pode ser usado normalmente. O estado `isLoading` já existia, faltava usá-lo pra substituir o conteúdo do card em vez de só trocar o texto do botão.
- **Bugs da entrevista (todos no App.tsx)**: (1) campo `personal_height` tinha o `help` explicando errado o formato (cm vs. m); corrigido com exemplo concreto. (2) Campos opcionais bloqueavam o avanço se o save falhasse — `next()` retornava imediatamente em caso de erro, mesmo para `optional: true`; corrigido para só bloquear se `!question.optional`. (3) Adicionado botão "Prefiro não responder · Pular esta pergunta" em todas as questões opcionais (exceto CPF e telefone), que salva `null` no servidor e avança — esses campos nunca poderão ficar em `null` em banco para quem os pulou (era `undefined` antes, que é indiferente para o agente). (4) A função de conclusão extraída em `finishOrAdvance()` para evitar duplicação entre `next()` e `skip()`.
- **Ricardo Davino — entrevista + assinatura**: estava travado no campo `abdomen_circumference` (wheel, opcional). Com o deploy de 07/09 (veja abaixo), a correção de campos opcionais chegou à produção — o app agora avança mesmo se o save falhar num campo opcional. A assinatura do Ricardo "caiu sozinha" em 06/09 (cobrança indevida, mesmo padrão da Silvia — bug já corrigido no mesmo deploy). Ele está em Ex-alunos com entrevista e rotina completas mas sem plano ativo. Ação pendente do treinador: dar cortesia/liberação manual e gerar treino da semana para ele.
- **Deploy de 07/09 confirmado**: Elton fez push via GitHub Desktop → EasyPanel auto-deployou `fd9a8c0` (confirmado no painel de implantações do EasyPanel). O EasyPanel **SIM** faz auto-deploy a cada push — a afirmação contrária desta entrada foi corrigida. Produção agora roda com: aba Rotina no admin, loading screen de geração, botão "Pular" na entrevista, correção de campos opcionais, sincronização de modalidade.
- **Workflow git definitivo (07/09)**: há DOIS diretórios distintos no computador do treinador — `C:\...\Aplicativo Panzeri Run` (onde a IA edita o código) e `C:\...\GitHub\panzeri-run-api` (onde o GitHub Desktop monitora). Após cada edição, a IA DEVE copiar os arquivos alterados para o segundo diretório antes de avisar que está pronto para commit. Sem essa cópia, o GitHub Desktop mostra "No local changes". Registrado em memória permanente (`github_desktop_repo_path.md`). Corrigir isso definitivamente (reconfigurar GitHub Desktop para apontar para o diretório real) eliminaria o problema, mas ainda não foi feito.

**2026-09-07 (sessão 2)** — Notificações Telegram, painel admin e UX de geração:

- **Tolerância de 20% na alerta de rotina diferente**: antes, qualquer diferença de duração entre o treino gerado pela IA e o horário combinado disparava o alerta "rotina diferente". Agora só alerta se a diferença for maior que 20% — evita falso positivo por pequena variação.
- **Formato legível no Telegram**: substituído o "weekday 1, 2, 3..." por formato completo — ex.: `segunda-feira 07/09 — corrida 12.5km contínuo`. O message de "rotina diferente" agora lista cada sessão desviada com dia da semana, data e detalhe de modalidade (corrida: km + método contínuo/intervalado; fortalecimento/musculação: fallback ao título da IA por ora — campo `muscleGroup` não existe no schema sem migration).
- **Nova notificação Telegram a cada treino gerado**: antes, o treinador só recebia Telegram em caso de mismatch ou falha. Agora, toda geração bem-sucedida dispara `✅ Treino da semana gerado.` com a lista de sessões, aluno e período.
- **Painel admin de notificações reformulado**: strip com scroll (max-height 300px) em vez de grid fixo de 8 itens; painel lateral em flex-column com cards completos; título de cada notificação passou a mostrar `[Aluno — Modalidade Xkm seg 07/09]` — identidade do treino na primeira linha, feedback do aluno abaixo; botão "Lida" compacto; contador de não lidas no cabeçalho; limite do servidor elevado de 20 para 50.
- **Banner de geração em andamento (isGeneratingWeek)**: o estado `isLoading` já dava feedback mínimo no botão; adicionado `isGeneratingWeek` separado que exibe um card proeminente com `ActivityIndicator` grande, título em destaque e instrução de que o celular pode ser usado normalmente enquanto aguarda.
- **ScalePicker com gradiente de cores**: os 5 botões de escala (check-in) agora têm cada um sua cor semântica (#E03E2D→#F5C800→#1B8A5A), com fundo colorido quando ativo e borda colorida quando inativo — elimina o visual monocromático anterior.
- **Arquivos alterados**: `apps/api/src/training-plans/prescription-agent.service.ts`, `apps/api/src/training-plans/training-methodology.ts`, `apps/api/src/training-plans/training-plans.service.ts`, `apps/api/src/workout-completions/workout-completions.service.ts`, `apps/api/src/notifications/notifications.service.ts`, `apps/mobile/App.tsx`, `apps/admin/app/page.tsx`, `apps/admin/app/styles.css`.

**2026-09-09 (sessão 2) — RoutineOverviewScreen: tabela de rotina antes da entrevista**

- **Nova tela `RoutineOverviewScreen`** em `apps/mobile/App.tsx`: quando o aluno toca em "Rotina de
  treinos" no menu, agora vê primeiro uma tabela da rotina atual (coluna fixa de labels + scroll
  horizontal com as 7 colunas de dias) — igual ao painel do treinador — antes de entrar na
  entrevista de configuração. Linhas: Corrida, Fortalecimento, Musculação (fonte: `WeeklyAvailability`
  canônica) + linha "Tempo disponível" (`availableMin` por dia). Células codificadas: verde + minutos
  (modalidade ativa com duração), "NÃO" cinza (modalidade inativa no dia), "DESC" cinza
  (`noTraining=true`), "—" (sem entrada). Cabeçalho dos dias em verde Pulso sobre fundo Graphite.
- **Botão condicional**: "Alterar rotina semanal" (já tem rotina) ou "Configurar rotina semanal" (sem
  rotina); "Voltar" retorna para a aba Semana sem entrar na entrevista.
- **Estado `routineSetupMode`**: controla se a aba `routine` mostra `RoutineOverviewScreen` (false)
  ou `GuidedInterview` (true). `useEffect` reseta para false sempre que `activeTab !== 'routine'` —
  garante que trocar de aba e voltar sempre exibe a visão geral primeiro.
- **Bug corrigido — preso na entrevista**: ao trocar de aba sem sair da entrevista, `routineSetupMode`
  ficava `true` e o aluno voltava direto para a entrevista ao retornar para "Rotina". Corrigido pelo
  `useEffect` acima, seguindo o padrão já existente de `fixAnswersModule`.
- **Escape sempre disponível**: botão "← Voltar" fixo acima do `GuidedInterview` quando em modo
  setup — funciona independente do que a tela de introdução da entrevista mostrar.
- **Arquivo alterado**: `apps/mobile/App.tsx`.

**2026-09-09 — Auditoria arquitetural de rotina (Fase 0) + implementação da WeeklyAvailability como fonte canônica**

Esta sessão teve duas partes distintas.

**Parte 1 — Fase 0: Inventário (só leitura, sem toque no banco)**

Três versões de script de inventário produzidas, com duas reprovações formais pelo Dr. Vanzão (ELTON²):
- **v1** (TypeScript + SQL básico): reprovado por N+1, tolerância arbitrária de ±15min, sem sanitização,
  dados pessoais expostos (email, routine_observation), sem proteções de execução.
- **v2** (SQL, READ ONLY): reprovado por não implementar `sanitizeAnswersForModalityChoice`, não incluir
  `availableMin` na comparação, fallback operacional incompleto, CTE `divergent_users` placeholder quebrado.
- **v3** (SQL, versão atual): grade simétrica `(userId × weekday × modality)`, faixa real de comparação
  (`faixa_lower`/`faixa_upper`, sem tolerância numérica), fallback `modalityDurations ?? availableMin ?? 0`,
  sanitização real com todos os enums de `routine_modality_choice`, 5 flags booleanas independentes, 5
  contagens por tipo de achado, pseudonimização com `studentCode` ou `SN_` + hash MD5. Artefatos:
  `inventario-rotina-fase0-v3.sql` e `REVISAO_INVENTARIO_ROTINA_FASE_0_V3.md`. **Não executado em
  produção ainda** — requer ambiente isolado (réplica ou backup) e aprovação explícita.

**Parte 2 — ORDEM EXECUTIVA Dr. Vanzão: WeeklyAvailability como fonte canônica única**

Dr. Vanzão declarou WA como a única fonte operacional de rotina e ordenou implementação imediata. Artefato
de decisão: `ORDEM_CLAUDE_IMPLEMENTACAO_ROTINA_CANONICA.md` na raiz do repositório.

Três mudanças implementadas e deployadas:

- **`me.service.ts` — back-sync WA→answers eliminado** (em `updateAvailability` e `updateAnamnese`):
  a sincronização reversa `syncInterviewAnswersFromAvailability` foi removida dos dois pontos onde era
  chamada. Quando o aluno ou o treinador mudam a rotina, só `WeeklyAvailability` é atualizada — as chaves
  `{dia}_run_time` em `answers` ficam como estão (dados históricos preservados, não apagados). A função
  `syncInterviewAnswersFromAvailability` permanece no arquivo como código inativo (reversível via git revert).

- **`training-methodology.ts` — nova `stripRoutineKeysFromAnswers(answers)`**: remove todas as chaves de
  rotina do objeto de respostas antes de montar o `MethodologyInput`. Chaves removidas: as 5 estáticas
  (`routine_modality_choice`, `routine_observation`, `routine_intro`, `routine_modality_confirmation`,
  `routine_confirmation`) + as 42 por dia × modalidade (`{dia}_run_time`, `{dia}_fortalecimento_time`,
  `{dia}_musculacao_time`, `{dia}_run_available_time` etc.). Opera só em memória, nunca toca o banco.

- **`training-plans.service.ts` — aplicada em `generateWeek()` e `regenerateSession()`**: o `answers`
  passado ao `MethodologyInput` como `respostasEntrevista` agora passa por
  `stripRoutineKeysFromAnswers(sanitizeInterviewAnswers(...))`. A IA recebe rotina exclusivamente via
  `diasDisponiveisParaCorrida`/`diasDisponiveisParaForca` (derivados da WA). Nenhuma chave de rotina
  do answers chega mais ao contexto do agente.

Gates: typecheck limpo, lint limpo em `me.service.ts` e `training-methodology.ts` (5 erros pré-existentes
em `training-plans.service.ts`, linhas não tocadas). Deployado pelo Elton na mesma sessão.

**2026-09-10 — Calendário de provas alvo (backend + admin + mobile) + ROADMAP.md**

- **Endpoint `GET /coach/races/calendar`** adicionado em `coach.controller.ts` e `coach.service.ts`:
  retorna todas as `TargetRace` com `status='em_andamento'` de todos os alunos, ordenadas por data,
  com nome e código do aluno, distância, pace calculado e prioridade. Campos: `id`, `studentName`,
  `studentCode`, `name`, `raceDate` (YYYY-MM-DD), `distanceKm`, `targetSeconds`, `priority`,
  `paceSecondsPerKm`. Usado exclusivamente pelo painel admin.

- **`RaceCalendarView`** — novo componente inserido em `apps/admin/app/page.tsx` (entre `FunnelView` e
  `FinanceView`). Agrupa provas por mês (Map<YYYY-MM, RaceCalendarEntry[]>), exibe countdown em dias,
  nome/código do aluno, distância, pace e prioridade. Provas passadas renderizadas com `opacity: 0.65`.
  Botão de acesso no sidebar: ícone `Flag` (lucide-react), label "Provas". Estado: `raceCalendar`,
  `loadingRaceCalendar`; função `loadRaceCalendar()` carregada via `changeView()` quando necessário.
  `AdminView` type atualizado para incluir `'raceCalendar'`.

- **`TargetRaceScreen` com toggle de viewMode** em `apps/mobile/App.tsx`: estado `viewMode: 'form' |
  'timeline'`; novo label "Linha do tempo (N)" com contagem de provas ativas; view timeline agrupa
  provas por mês (`racesByMonth`), mostra countdown, ações rápidas por prova. Formulário original
  preservado intacto sob `viewMode === 'form'`. Helpers adicionados: `formatRaceDate`,
  `formatRaceMonth`, `daysUntilRace`, `racePriorityLabel`, `raceStatusLabel`.

- **ROADMAP.md** criado na raiz do repositório: inventário plano de todas as iniciativas do produto,
  sem ordem de prioridade, sem fases. Categorias: produto mobile, produto admin, agentes de IA,
  integrações, lojas, segurança, infraestrutura, crescimento/marketing, financeiro, plataforma.
  Incorporou itens do `PRONTUARIO.md` e memórias de sessões anteriores. Ideia dos "perfis de
  treinadores fictícios criados por IA" foi explicitamente descartada pelo Elton — não consta.

- **Briefing estratégico de produto** (sem implementação): discussão de 6 ideias — calendário de
  treinos com bolinhas por dia (estilo Strava, não implementado), gráfico de km com seleção de
  período (não implementado), timeline da jornada do atleta (implementada como view na TargetRaceScreen),
  treino extra no calendário de bolinhas (recomendado, não implementado), gráfico arrastável
  lateral (não recomendado — gráfico de evolução já existe), cards instagramáveis (recomendado,
  implementar após lançamento nas lojas — requer `react-native-view-shot`).

- **Demais itens do roadmap estratégico** discutidos no mesmo dia: rede social interna estilo Strava,
  integração Panz Fit (profunda — não só deep link), Garmin/Polar/Apple Watch, segurança LGPD, Play
  Store (completar 12 testadores), App Store (retomar iOS), melhoria de gestão financeira, site
  institucional + página de vendas + Instagram, multi-treinador (longo prazo).

- **Arquivos alterados**: `apps/api/src/coach/coach.controller.ts`,
  `apps/api/src/coach/coach.service.ts`, `apps/admin/app/page.tsx`, `apps/mobile/App.tsx`, `ROADMAP.md`.
  Nenhum commit foi feito nesta sessão — todos os arquivos da sessão anterior (me.service.ts,
  me.controller.ts, evolution.types.ts, evolution-metric.service.ts, e os desta sessão) aguardam commit.

- **Gates desta sessão**: typecheck limpo nos três apps confirmado (erros pré-existentes em coach,
  não causados por esta sessão). Nenhum erro novo introduzido.

**2026-09-11 — Rastreamento de ciclo menstrual**

Feature de correlação (NÃO diagnóstico): permite identificar se alunas perdem mais treinos, relatam mais dor ou têm check-ins piores em fases específicas do ciclo. Toda a stack implementada de ponta a ponta.

**Schema (migration `20260911200000_add_menstrual_cycle`)**:
- `MenstrualProfile` (1:1 com User): `hasActiveCycle`, `usesHormonalContraceptive`, `contraceptiveType`, `cycleLengthDays` (default 28), `periodLengthDays` (default 5), `lastCycleStartDate`.
- `MenstrualCycleLog` (N:1 com User): `cycleStartDate`, `notes`, escalas opcionais (cramps/energy/mood/bloating — Int? 1–5).
- Problema resolvido: dois FKs em `MenstrualCycleLog` usando o mesmo campo `userId` geravam nome de constraint duplicado. Solução: removida a relação direta `MenstrualCycleLog↔MenstrualProfile`; o log só referencia o `User`.

**Backend (`apps/api/src/menstrual-cycle/`)**:
- `MenstrualCycleService`: `getProfile`, `upsertProfile`, `createLog`, `getLogs`, `getEstimatedPhaseContext` (calcula fase atual com base na data do último ciclo), `getCorrelations` (aderência por fase nas últimas 8 semanas).
- `MenstrualCycleController`: endpoints REST protegidos por JWT — `GET /menstrual-cycle/status`, `POST /menstrual-cycle/profile`, `POST /menstrual-cycle/log`, `GET /menstrual-cycle/logs`.
- Módulo integrado: importado em `AppModule`, `TrainingPlansModule`, `CoachModule`.

**Integração com a IA**: `MethodologyInput` recebe `menstrualContext?` com fase, dia do ciclo e flag de confiabilidade. O `PrescriptionAgentService` passa isso ao agente como `contextoCicloMenstrual` — contexto informativo, nunca prescritivo. Usuárias de anticoncepcional hormonal recebem `estimativaConfiavel: false`.

**Entrevista inicial (mobile)**: 5 perguntas condicionadas a `personal_sex === 'Feminino'`, todas opcionais — se tem ciclo ativo, se usa anticoncepcional, qual tipo, duração do ciclo e duração da menstruação. Respondidas durante o onboarding e salvas no `completeOnboarding` do `me.service.ts`.

**App mobile — tela "Registrar ciclo menstrual"** (novo item condicional no menu lateral, visível só pra quem respondeu `sex === 'Feminino'` na entrevista): mostra fase atual estimada com disclaimer para quem usa anticoncepcional hormonal; formulário de registro de novo ciclo (data + sintomas opcionais 1–5); histórico de ciclos anteriores.

**Painel admin**: aba "Ciclo" visível na ficha do aluno apenas quando `interview.answers.personal_sex === 'Feminino'`. Exibe perfil resumido, fase estimada, tabela de correlações (fase × aderência) e histórico de logs. Endpoint: `GET /coach/students/:studentId/menstrual-cycle`.

**Gates**: typecheck limpo nos três apps (api, mobile, admin). URL do `CicloTab` corrigida antes do commit (`/api/proxy/...` → `${API_URL}/coach/...`).

**2026-09-11 — Feedback pós-treino v1 (sistema longitudinal)**

Reformulação completa do formulário de registro de treino no app mobile. O feedback passou a ser tratado como fonte primária de dados longitudinais sobre o aluno, não apenas pesquisa de satisfação.

**Estrutura: 3 blocos sequenciais** (apenas para `done`/`adjusted`; `missed` mantém fluxo direto):
- **Bloco 1 "Como você chegou"**: sono (1–5), cansaço físico (1–5), estresse (1–5), motivação (1–5). Botão "Por que responder é importante" sempre visível, começa recolhido, expande ao toque.
- **Bloco 2 "Como foi o treino"**: RPE 1–10, satisfação com elaboração (`SATISFACTION_OPTIONS`), satisfação com execução (`EXECUCAO_OPTIONS` — novos rótulos, mesmos valores), sensação ao terminar (1–5).
- **Bloco 3 "Dor e observações"**: `painFlag` com 4 opções (Não / Sim leve / Sim moderado / Sim forte), `painTiming` condicional (6 opções de quando apareceu), observações livres opcionais.

**Validação**: cada bloco precisa estar completo para avançar; o botão de salvar só aparece no bloco 3.

**Schema (migration `20260911210000_add_workout_feedback_v2`)**:
- Novos campos: `preSleepQuality Int?`, `prePhysicalFatigue Int?`, `preStressLevel Int?`, `preMotivation Int?`, `postWorkoutFeeling Int?`, `painTiming String?`, `feedbackVersion Int @default(1)`.
- `painFlag` ganhou valor `'moderado'` (aceito no DTO e validação server-side).
- Campos históricos `satisfaction` e `satisfactionCarga` preservados no banco; não coletados na nova UI, mas ainda aceitos pelo endpoint para compatibilidade com feedbacks antigos.

**Backend**: DTO (`upsert-workout-completion.dto.ts`), service (`workout-completions.service.ts`) — validação server-side dos blocos 1+2 para `done`/`adjusted`, `painTiming` obrigatório quando `painFlag !== 'none'`, `profileParts` e notificação ao treinador atualizados, funções `painFlagLabel()` e `painTimingLabel()` exportadas.

**Gates**: typecheck limpo (api + mobile). Prisma client regenerado após migration.

---

**2026-09-19 — Fundação longitudinal de rastreamento (identidade + tempo + origem + estado comercial).**
Contrato completo, endpoints `/leo/*`, limitações e o incidente abaixo: `RUNBOOKS/2026-09-19-FUNDACAO-LONGITUDINAL.md`.
- **Incidente descoberto:** o commit `617788a` ("f", 16/09 17:23) sobrescreveu o espelho e apagou trabalho já entregue por
  outra linha (rota `/links`, validação do DTO do funil com `journeyId`/`dedupeKey`, coorte, GA4/Clarity). Efeito medido:
  o DTO de `/analytics/event` em produção rejeitava **100% dos eventos** do funil (HTTP 400) — o funil interno ficou mudo
  desde então. Restaurado: `/links` (byte a byte) e o DTO validado. NÃO restaurado (decisão a confirmar): GA4, Clarity,
  segunda implementação de Meta, eventos de ativação. Causa: duas linhas editando os mesmos arquivos + `.bat` que copia por cima.
- `journeyId` (longitudinal, anônimo) ≠ `sessionId` (uma sessão). Landing persiste `landing_view`/`landing_cta_click` e leva
  `journey_id` na URL do CTA; o PWA adota, limpa o parâmetro da URL **antes do Pixel** e vincula jornada↔usuário por
  `POST /analytics/link-journey` (userId vem do JWT; `/auth/*` intocado por causa do `forbidNonWhitelisted`).
- Estado comercial temporal (`prospect/active/ex_subscriber/reactivated/unknown` + `basis`): `BillingEvent` `status_changed`
  gravado em todos os 7 pontos que alteram `subscriptionStatus` + `baseline_snapshot`; regras testadas em `leo/commercial-state.ts`.
- Correções de dados: primeira compra só na transição real de quem nunca teve acesso (evita "primeira compra" falsa para
  assinantes antigos); `payment_confirmed` agora inclui renovações e é idempotente **no banco** (índice único parcial);
  provider da 1ª compra vem do `firstPaidPaymentId` (imutável) — `BillingSubscription.provider` é sobrescrito por
  `createCheckout`/cupom (correção de uma afirmação anterior de que era write-once).
- Migration única (sem coluna nova): `20260919120000_billing_history_baseline_and_payment_unique`.
- Gates: typecheck api+mobile limpo; 80 testes passam (suítes novas: commercial-state, journey-foundation, journey-pwa,
  billing-commercial-history, leo-foundation + funnel/links restaurados); landing e PWA validados em navegador real (Expo web
  atrás de proxy simulado, sem tocar produção). 3 suítes antigas seguem falhando por motivo alheio (exports/aridade antigos).

---

**2026-09-20 — Bug "gerei o treino e não aparece; diz 'Sua semana está liberada'" (domingo à noite).**
Causa raiz (provada, no app — o servidor estava certo): `planStartsInFuture()` (App.tsx) comparava a data do plano com
"amanhã" calculado em data LOCAL do aparelho e convertido com `toISOString()` (UTC). De domingo 21:00 a 23:59 (BRT) o UTC
já é segunda: "amanhã" pulava um dia e o plano recém-gerado (início 21/09) era tratado como "não futuro" — o override de
domingo-à-tarde (`isSundayAfterNoon`) escondia o plano e mostrava o botão de gerar, embora o treino existisse e aparecesse no
admin. Só acontecia nas 3 últimas horas do domingo (horário comum para gerar a semana). Correção: `apps/mobile/src/weekWindow.ts`
(sempre fuso de São Paulo) + teste de regressão `test/week-window.spec.ts` (18 casos em 3 fusos; a regra antiga falha às 21:00,
21:31 e 23:59). Efeito colateral a checar: quem tocou "Gerar treino da semana" de novo nessa janela pode ter gasto tentativas
(limite 2/semana) — liberar manualmente se pedirem. Achado adjacente NÃO corrigido: `App.tsx` (tela de provas-alvo) usa
`new Date().toISOString().slice(0,10)` — mesma classe, impacto menor.

---

## Onde as coisas estão agora (2026-09-11) — leitura rápida pra quem chega de fora

**Produto em produção, sendo usado por alunas reais**: a versão web/PWA, em
`https://panzerirun.eltonpanzeripersonal.com.br`. Entrevista, geração de treino por IA, registro de
treino, pagamento via Asaas (boleto/cartão recorrente), backup diário, alertas de crash e de dor
grave pro treinador via Telegram, check-in semanal obrigatório antes de gerar nova semana,
notificações de cobrança em atraso — tudo funcionando e testado com alunas reais.

**Última versão em produção (09/09, sessão 3)**: três mudanças relacionadas à semântica de "sem
registro": (1) bug fix em `coach.service.ts` — `summarizeSessions` colapsava sem registro em falta
confirmada; corrigido com `unregisteredSessions` separado e aderência recalculada como `feito ÷
(feito + não feito)`; (2) cards de treino agora usam sistema de cores: 🟢 feito, 🔴 não feito,
🟡 amarelo para sessões passadas sem registro (após meia-noite D+1), com label "⚠ Sem registro";
(3) notificação ao gerar nova semana agora inclui contagem de treinos sem registro da semana
anterior e explica o impacto na prescrição. Arquivos: `coach.service.ts`, `training-plans.service.ts`,
`App.tsx`. Typecheck limpo nos dois apps. EasyPanel auto-deploya a cada push.

**Prontos para commit (11/09, sessão 2)**: feedback pós-treino v1 (3 blocos, dados longitudinais), migration `20260911210000_add_workout_feedback_v2`, `CompletionForm` reescrito com progresso 1/2/3, validação por bloco, ScalePicker para escalas 1–5; todos os arquivos da feature de ciclo menstrual + calendário de provas + demais acumulados de sessões anteriores.

**Deployado (09/09, sessão 2)**: `RoutineOverviewScreen` — ao tocar em "Rotina de treinos" no menu,
o aluno vê a tabela da rotina atual antes de entrar na entrevista, com botão "Alterar/Configurar
rotina semanal". Três bugs corrigidos: (1) trocar de aba e voltar não prende mais o aluno na tela
da entrevista; (2) botão "← Voltar" externo (topo) funcionando; (3) botão "Voltar" interno do
GuidedInterview (`onLater` corrigido para só `setRoutineSetupMode(false)`). Arquivo: `apps/mobile/App.tsx`.
Também criado `.easignore` para reduzir archive EAS de 309 MB (`.pnpm-store` e `apps/api/admin`
estavam sendo incluídos desnecessariamente) — build Android ainda pendente de nova execução.

**Fonte canônica da rotina (decisão arquitetural, 09/09)**: `WeeklyAvailability` é a única fonte
operacional. As chaves de rotina em `OnboardingInterview.answers` são preservadas historicamente mas
nunca mais são: (1) atualizadas quando a rotina muda; (2) enviadas ao contexto da IA. A IA recebe
rotina exclusivamente via `diasDisponiveisParaCorrida`/`diasDisponiveisParaForca`.

**Ricardo Davino — ação pendente do treinador**: entrevista e rotina completas, assinatura cancelada
em 06/09. Está em Ex-alunos. Para reativá-lo: (1) dar cortesia/liberação manual no painel admin;
(2) gerar treino da semana via "Refazer nova semana de treinos".

**Aguardando novo build EAS**: para os clientes que usam o app nativo (Android/iOS), correções de
entrevista e UX das sessões 07-09/09 só chegam após novo build EAS. Usuários PWA já recebem.

**Em construção, ainda não publicado**: apps nativos Android e iOS.

- **Android**: RevenueCat configurado e validado. Teste fechado enviado pro Google (03/09), em análise.
  Precisa de 12 testadores por 14 dias corridos antes de liberar Produção. O próximo build de produção
  deve incluir a chave do RevenueCat Android (adicionada depois do build `versionCode 3`) e as
  correções recentes. Strava: pedido de aumento de limite reprovado (06/09),
  análise em `integracoes/strava/analise-elegibilidade.md`.
- **iOS**: produto RevenueCat não importado ainda. Aguardando retomada.
- Testar compra real em sandbox ainda pendente nas duas lojas.

**2026-09-12 — Bug recorrente: tela de pagamento exibida para alunas com acesso liberado (Juliana, Lucelane)**

Terceiro caso confirmado do padrão "tela de pagamento aparece para quem já tem acesso" (anteriores: Carina em 08/08, Reabrir entrevista em 28/07). **Causa raiz diferente dos dois anteriores** — desta vez estava no componente `Week` do `App.tsx`, não no fluxo de entrevista.

**Diagnóstico**: o bloco `if (!plan && !notGeneratedRange)` (linha ~3893) disparava em três cenários além do legítimo "sem assinatura":
1. Primeira renderização: `plan=null, notGeneratedRange=null, isLoading=false` antes do `useEffect` chamar `loadPlan()`
2. Durante o carregamento: `isLoading=true`, mas a verificação de `isLoading` estava DEPOIS do `return` que exibia a tela de pagamento — nunca era alcançada
3. Falha de API: `loadPlan()` saía com `plan=null, notGeneratedRange=null, isLoading=false` (estado indistinguível de "sem assinatura")

**Correção (commit `2b1fe57`, 12/09)** — 3 camadas:
- `isLoading` inicializa como `true` (evita flash na primeira renderização)
- Novo estado `planLoadError` separado para falhas de API (não confunde "não sei se tem acesso" com "sei que não tem acesso")
- Condição do bloco de pagamento exige `!isLoading && !planLoadError`
- Novo bloco de carregamento (spinner) para `plan=null && notGeneratedRange=null && isLoading=true`
- Novo bloco de erro com botão "Tentar novamente" quando `planLoadError=true`

**Padrão recorrente confirmado**: toda vez que uma condição de estado transitório (carregamento, erro de rede) fica indistinguível de um estado funcional legítimo ("sem assinatura"), alunas com acesso válido veem a tela de pagamento. A regra permanente: **qualquer bloco de UI de pagamento só pode disparar quando a API confirmou explicitamente que não há acesso** — nunca quando o estado é desconhecido.

**2026-09-07** — Sessão de diagnóstico do check-in + redesign do modal:
- Diagnóstico confirmado (Elton reproduziu ao vivo): ao tocar "Gerar treino da semana", o modal de
  check-in aparecia com 2 botões lado a lado — no iPhone o botão "Sim" ficava cortado fora da tela.
  Ao clicar "Não, preciso registrar algo", o modal fechava mas o app mostrava a semana *nova* (não
  gerada), sem os treinos da semana passada visíveis. O aluno ficava sem caminho para registrar e
  sem treino novo. Causa real do problema da Lucelena.
- Fix de navegação: "Não, preciso registrar ainda" agora navega para `weekOffset=-1` (semana
  anterior), onde os treinos da semana passada ficam visíveis e clicáveis para registro.
- Nova opção 3 "Não quero registrar — pode gerar assim mesmo": cria um check-in sentinela
  (`elaborationSatisfaction=0`) sem migration; a IA recebe `semDados:true` e não presume execução.
- Layout do modal redesenhado: 3 opções empilhadas verticalmente (sem corte em tela estreita).
- Bug de data no iOS nativo confirmado (mostra 06/09 em vez de 07/09): fix já está no código desde
  commit `86eaef3` mas o app nativo precisa de novo build EAS para incluir a correção.
- Commits desta sessão: `df26fa0` (micro-feedback por exercício + simplificação "Não feito"),
  `86eaef3` (fix de fuso em datas), e o commit desta sessão (check-in 3 opções).

**2026-09-07 (sessões de UX e geração)** — Melhorias nos formulários de feedback de treino e diálogo "Incluir hoje?" antes de gerar:

- **CompletionForm — estado pós-envio**: depois de enviar o feedback de um treino, os controles do formulário continuavam ativos (permitindo re-submit acidental). Corrigido: depois de enviado, o formulário entra em modo "bloqueado" (opacity 0.55, `pointerEvents="none"`) com banner mostrando o status salvo ("Feito em DD/MM — treinador pode acompanhar"). Botão "Alterar feedback" permite editar de novo; ao editar, o botão vira "Atualizar feedback" e aparece "Cancelar alteração". `saveCompletion` passou a retornar `Promise<boolean>` para comunicar sucesso/falha de volta ao formulário — antes retornava `void` e o formulário nunca sabia se tinha dado certo.
- **"Gerar treino da semana" — proteção contra duplo toque**: o botão ficava ativo durante toda a geração, o que podia disparar uma segunda chamada no meio da primeira. Corrigido: `disabled={isLoading || isGeneratingWeek}` em ambas as ocorrências (com e sem check-in pendente). Texto muda para "Gerando..." enquanto em andamento.
- **Diálogo "Incluir hoje?" antes de gerar**: problema real diagnosticado com a Carina (geração feita às 17:56, segunda-feira ficou vazia porque a IA decidiu não prescrever para o mesmo dia quando gerando tarde, sem que ninguém pedisse isso). Solução: de segunda a sábado, quando `todayHasRoutine=true`, o app pergunta antes de gerar: "Você deseja incluir o dia de hoje na geração de treinos dessa semana ou já posso gerar a partir de amanhã, seguindo a rotina que você assinalou?" — opções "Sim, inclua o dia de hoje" / "Não, pode ser a partir de amanhã". A resposta vira `includeToday: boolean` no POST; o servidor (não o app) calcula a data em fuso América/São_Paulo e passa pra IA como `gerarAPartirDe`. No domingo (a partir de 12h, janela normal de geração da próxima semana), sem diálogo — gera direto. `todayHasRoutine` é consultado em paralelo com o check-in existente, sem viagem extra ao banco.
- **Erro de escopo TypeScript encontrado e corrigido na mesma sessão**: `generateFrom` foi inicialmente colocado no `methodologyInput` dentro de `generateWeek()`, que não tem o parâmetro `includeToday` — TypeScript recusou com `error TS2304: Cannot find name 'includeToday'`. Corrigido: `generateFrom?: string | null` adicionado ao `options` de `generateWeek`; data calculada em `doGenerateCurrentWeekOnDemand` e repassada via options. TypeScript zerado nos dois apps após a correção.
- **Bug A (Eduarda) — diagnóstico concluído, correção pendente de aprovação**: `computeSummary` (weekly-checkin.service.ts) trata `status='missed'` igual a `null` (sem registro), gerando o texto "1 treino sem registro" para treinos que o aluno marcou como "não feito". Isso faz a aluna recusar o check-in, bloqueando a geração. A semana da Eduarda foi gerada corretamente no servidor (07/09–13/09, confirmado no painel) mas o bloqueio do check-in impede ela de ver o treino. Correção não aplicada ainda — precisa de aprovação.
- **Arquivos alterados**: `apps/mobile/App.tsx`, `apps/api/src/training-plans/training-methodology.ts`, `apps/api/src/training-plans/weekly-checkin.service.ts`, `apps/api/src/training-plans/training-plans.service.ts`, `apps/api/src/training-plans/training-plans.controller.ts`, `apps/api/src/training-plans/prescription-agent.service.ts`.

**2026-09-08 — Bugs de Luiza + IA "sem registro = não fez" + UX de modalidades e feedback**

- **Bug crítico: `createManualSession` sem filtro de `planId`** — ao adicionar treino manualmente pelo admin, o código buscava sessões existentes em TODOS os planos (incluindo arquivados), não só no plano ativo. Luiza gerou o treino dela na terça (08/09), uma geração anterior (arquivada) tinha uma sessão de Corrida para essa terça — o admin mostrava "Sem treino" (plano ativo, correto), mas `createManualSession` encontrava a sessão no plano arquivado e rejeitava com "Já existe um treino dessa modalidade cadastrado para esse dia". Corrigido: filtro `planId: activePlan.id` adicionado à busca.
- **Bug Telegram: "musculação 10km"** — o mapeamento de modalidade para texto legível no Telegram não tinha `esteira`, que caía no `else` → `'musculacao'`. Como `esteira` é modalidade de corrida e tem `distanceKm`, o resultado era "musculação 10km" (absurdo). Corrigido: `esteira` mapeada junto com `corrida`.
- **Bug `computeSummary` — "não feito" ≠ "sem registro"** (Eduarda, diagnóstico já feito em 07/09): `status='missed'` (aluno marcou "não feito" explicitamente) era contado como `missedSessions` junto com `null` (sem nenhuma interação). Isso gerava "1 treino sem registro" para treinos explicitamente dispensados, confundindo a aluna na tela de check-in. Corrigido: separados — `null` não entra em nenhum bucket; `missed` continua em `missedSessions`; `done`/`adjusted` em `asPrescribedSessions`.
- **IA interpreta "sem registro" como "não fez"** — o histórico semanal (`historicoSemanal`) enviado pra IA mostrava `prescribedSessions` e `completedSessions` mas não separava sessões sem registro (pode ter feito) de sessões marcadas como "não feito" (evidência real de ausência). Corrigido em duas frentes: (1) novo campo `unregisteredSessions` em `MethodologyHistoryWeek` e no objeto enviado à IA; (2) nova instrução de prompt explícita: "ausência de registro NÃO é ausência de execução — continue a progressão normalmente quando não houver evidência contrária".
- **UX: múltiplas modalidades no mesmo dia viram cards separados** — antes, Corrida + Musculação no mesmo dia ficavam num único card colapsável com "+" no título, obrigando a rolar por tudo para chegar na segunda modalidade. Agora cada modalidade tem seu próprio card independente com toggle individual. `expandedDays` migrado de chave por data para chave por `session.id`.
- **UX: feedback por exercício inline** — os botões de kg e Ótimo/Ok/Difícil foram movidos para DENTRO de cada exercício expandido em `StrengthExerciseList`, com indicador visual de preenchimento (✓ verde) na row colapsada. A seção separada "Registro por exercício" no rodapé do formulário foi removida. `SessionPrescription` e `StrengthExerciseList` passaram a aceitar `exerciseFeedback`, `onExerciseFeedbackChange` e `feedbackLocked` como props opcionais.
- **Admin — paginação no topo da lista**: botões Anterior/Próxima e "Página X de Y" duplicados no topo da lista de alunos (compact), além do que já existia no rodapé.
- **Arquivos alterados**: `apps/api/src/training-plans/training-plans.service.ts`, `apps/api/src/training-plans/training-methodology.ts`, `apps/api/src/training-plans/weekly-checkin.service.ts`, `apps/api/src/training-plans/prescription-agent.service.ts`, `apps/mobile/App.tsx`, `apps/admin/app/page.tsx`.

**2026-09-08 (Cowork) — Bug real reportado pela aluna Thais: roda de números travando na Avaliação
física recente, sem conseguir registrar as medidas**

- **Diagnóstico**: em `WheelColumn` (`apps/mobile/App.tsx`), três eventos de rolagem redundantes
  (`onScroll`, `onScrollEndDrag`, `onMomentumScrollEnd` — redundância deliberada desde o caso da
  Duane, ver comentário no código) disparavam `onChangeIndex` DIRETO cada um, sem coordenação entre
  si. Um gesto de arrastar rápido (fling) podia gerar 2-3 chamadas com índices diferentes do mesmo
  gesto, cada uma virando um PUT concorrente pra `/me/onboarding/answer`. Resposta chegando fora de
  ordem: mostrava "Não consegui salvar esta resposta" mesmo com o valor certo já salvo por outra
  chamada, ou um valor antigo sobrescrevia o novo em `answers` e o `useEffect` que sincroniza a
  posição visual da roda puxava ela de volta — o que a aluna sentiu como "a roda parou de responder
  ao arrasto, só funciona apertando a setinha". Bate exatamente com o relato dela.
- **Correção aplicada** (via Cowork, sessão sem `device_bash`/typecheck — **precisa passar pelos
  gates do Code antes de comitar**: typecheck de `apps/mobile`, lint, teste manual real na tela de
  Avaliação física recente): os três eventos agora passam pelo MESMO timer de espera de 150ms — só
  o último índice reportado depois da rolagem ficar quieta é enviado (um único `onChangeIndex`, logo
  um único PUT, por gesto). Toque direto no item da lista e nos botões -/+ continuam síncronos, sem
  essa espera — não foram alterados. Risco Médio (UX/estado local), reversível.
- **Achado adicional, mais sério, NÃO CORRIGIDO — precisa de aprovação antes de mexer (risco Alto,
  concorrência)**: `saveOnboardingAnswer` (`apps/api/src/me/me.service.ts:69`) faz
  `findUnique` + `upsert` (leitura, depois escrita do objeto `answers` inteiro) sem transação nem
  lock. Duas requisições concorrentes pro mesmo aluno podem se sobrescrever: a que demorar mais pra
  responder pode gravar por cima de uma resposta mais recente de OUTRA pergunta que foi salva no
  meio do caminho (lost update clássico). A correção do frontend acima reduz muito a frequência
  disso (normalmente 1 PUT por gesto agora, não 2-3), mas não elimina a causa raiz no backend. Fix
  provável: `UPDATE ... SET answers = answers || jsonb_build_object($key, $value)` atômico no
  Postgres em vez de ler-modificar-escrever em código, ou uma transação serializável. Não
  implementado — CLAUDE.md classifica concorrência como Alto risco (Gauntlet Loop obrigatório).
- **Arquivo alterado**: `apps/mobile/App.tsx` (`WheelColumn`).

**Não iniciado ainda**: integração com WhatsApp (VPS Hostinger com Evolution API/n8n configurada, mas
não conectada ao Panzeri Run).

**Pendências que não bloqueiam lançamento, mas seguem em aberto**:
- Texto de Termos de Uso / Política de Privacidade ainda não teve revisão jurídica profissional.
- Fluxo completo "5 perguntas → assinatura → entrevista completa → rotina → gerar treino" nunca
  testado ponta a ponta com pagamento Asaas real.
- Identidade visual v2 (alinhada com Panz Fit) proposta mas não decidida nem implementada.
- Strava API reprovada para aumento de limite além de 10 atletas.
- Ricardo Davino: liberação manual de cortesia ainda pendente do Elton.

**2026-09-08 (Cowork) — Verificação pedida pelo Elton: fluxo entrevista→rotina, ajuste "só essa
semana" vs. permanente, e aba Rotina no admin — depois do caso da Thais (rotina vazia com plano já
gerado)**

- **Fluxo 5 perguntas → assinatura → entrevista completa → rotina**: confirmado correto no código
  atual. Ao concluir a entrevista principal (`mainInterviewQuestions`, que deliberadamente NÃO inclui
  o módulo "Rotina semanal"), o app manda automaticamente para a aba `routine` (`App.tsx:1264`) — já
  existe um comentário no código confirmando que isso foi corrigido em 16/08 exatamente pra evitar
  cair direto em "Semana" sem rotina configurada. Nenhum gap encontrado aqui.
- **Rotina oficial vs. ajuste só desta semana**: confirmado que os dois caminhos existem e são
  bem separados. "Salvar rotina permanente" chama `PUT /me/availability` e só entra em vigor na
  geração automática de domingo (a semana atual não muda). "Gerar ajustes só desta semana" chama
  `POST /training-plans/week` com a disponibilidade dessa tela embutida no corpo da requisição — não
  grava em `WeeklyAvailability` nem na entrevista, é usado só naquela chamada (`weeklyOverride` em
  `training-plans.service.ts`). Esse segundo caminho NÃO tem relação com o bug da rotina vazia.
- **Aba Rotina separada no painel admin**: já existe (adicionada 06-07/09, ver Diário acima),
  confirmada também na tela que o Elton mostrou. Continua também disponível dentro de Avaliação, por
  decisão deliberada da época (não é duplicação por engano).
- **Conclusão**: nenhuma das três coisas verificadas é bug — as três já estão implementadas como o
  Elton descreveu. O problema real da rotina vazia da Thais continua sendo o achado anterior (mesmo
  dia): `syncAvailabilityFromInterview` sem trava contra sobrescrever rotina real com rotina vazia
  calculada da entrevista. Nada foi implementado ainda para esse ponto — segue precisando de
  aprovação (risco Alto/Médio, dado tocado por estudantes pagantes em produção).

**2026-09-08 (Cowork) — Pergunta do Elton: dá pra fixar rotina em só 2 momentos (entrevista de rotina
única + ajuste "só essa semana" na tela de Semana), acabando com o retrabalho da aluna? Achado novo:
terceiro caminho que mexe em `WeeklyAvailability` sem o usuário nunca ter "respondido rotina duas
vezes" pela tela — o problema é de encanamento interno, não de UX repetida**

- **A pergunta do Elton estava certa como diagnóstico de produto**: hoje só existem mesmo dois
  momentos em que a ALUNA vê e mexe em rotina pela tela — (1) o módulo "Rotina semanal" dentro da
  entrevista guiada (perguntas tipo `${dia}_run_time`, respondidas uma vez), e (2) a tela de Semana,
  com a opção "só essa semana" (não grava nada permanente) ou "salvar como rotina permanente"
  (grava). Não existe uma terceira tela pedindo a mesma coisa de novo. Ou seja, do ponto de vista de
  "quantas telas pedem isso pra ela preencher", já está em 2 — o retrabalho que ele viu não vem de
  uma pergunta duplicada na interface.
- **O retrabalho real é outro, e mais grave**: reli `completeOnboarding` (`me.service.ts`, a função
  que fecha a entrevista PRINCIPAL — nome, saúde, preferências, CPF etc., que deliberadamente NÃO
  inclui as perguntas de rotina). Ela também calcula `buildInterviewAvailability(answers)` e, dentro
  da mesma transação, apaga e recria `WeeklyAvailability` inteira (linhas ~159 e ~219-220) — MESMO
  sem nenhuma pergunta de rotina ter sido respondida ainda, porque a ordem normal é: entrevista
  principal termina → SÓ DEPOIS o app manda pra tela de Rotina. Ou seja: no exato momento em que a
  aluna termina a entrevista principal, antes mesmo dela ver a tela de rotina, o sistema já apaga
  qualquer rotina real que existisse e grava uma rotina vazia (nenhum dia com treino) — de forma
  automática, silenciosa, sem ela ter feito nada de errado. Se depois disso ela demorar pra chegar na
  tela de Rotina, ou o app já tiver gerado treino da semana antes disso, o efeito é exatamente o "sumiu
  a rotina" que apareceu com a Thais. Esse é o terceiro lugar que escreve em `WeeklyAvailability` a
  partir do rascunho da entrevista (os outros dois já mapeados são `syncAvailabilityFromInterview` —
  botão "sincronizar" do admin — e o próprio `completeRoutineFromInterview`, que é chamado quando ela
  termina a tela de Rotina de fato). Os três usam a mesma função de conversão
  (`buildInterviewAvailability`) e nenhum tem trava contra sobrescrever uma rotina real com uma vazia.
- **Resposta à proposta do Elton ("será que não é melhor a gente fixar só nisso?")**: sim, e a forma
  mais limpa de fazer isso é justamente parar de tratar isso como "consertar a interface" (ela já está
  certa, só 2 telas) e tratar como "consertar o encanamento" — fazer `completeOnboarding` (fim da
  entrevista PRINCIPAL) simplesmente NÃO tocar em `WeeklyAvailability`, porque essa não é a etapa
  responsável por isso — quem é responsável é a tela de Rotina, que roda logo em seguida e já chama
  `completeRoutineFromInterview` quando a aluna termina de respondê-la de verdade. Isso é mais
  direcionado do que só colocar uma trava defensiva em `syncAvailabilityFromInterview` (que também
  continua valendo a pena, como segunda camada de proteção, já que o botão "sincronizar" do admin
  também pode disparar o mesmo problema se usado num momento errado).
- **Implementado no mesmo dia (ver entrada seguinte, 08/09 à noite)** — Elton pediu explicitamente
  pra aplicar essa correção depois de novos relatos da Thais na entrevista. Ver detalhes abaixo.

**2026-09-08 (Cowork, à noite) — Implementadas as duas correções de rotina propostas acima, mais um
ajuste no picker de rolagem por causa de novos relatos da Thais na entrevista ("muitos erros")**

- **`completeOnboarding` (`apps/api/src/me/me.service.ts`) não mexe mais em `WeeklyAvailability`**:
  removida a reconstrução de disponibilidade que rodava ao concluir a entrevista PRINCIPAL (antes
  calculava `buildInterviewAvailability(answers)` e fazia `deleteMany`+`create` da tabela inteira,
  mesmo sem a aluna ter respondido o módulo "Rotina semanal" ainda). Comentário explicando o porquê
  deixado no código, referenciando o caso da Thais. Quem continua responsável por
  `WeeklyAvailability` de verdade: a tela de Rotina (`completeRoutineFromInterview`) e as telas de
  edição direta (`updateAvailability`, painel do treinador).
- **Trava de segurança em `syncAvailabilityFromInterview`** (mesmo arquivo, usada tanto pela tela de
  Rotina da aluna quanto pelo botão "Sincronizar disponibilidade da entrevista" do painel do
  treinador): se a rotina calculada da entrevista vier totalmente vazia (nenhum dia com treino) mas
  já existir uma rotina real configurada (pelo menos um dia com treino), a função agora ABORTA sem
  gravar nada — devolve `{ synced: false, aborted: true, days, firstTime: false }` em vez de apagar
  a rotina real. Loga um warning explicando o motivo pra investigação futura.
- **Frontend (`apps/mobile/App.tsx`) ajustado pra esse novo retorno**: quando a tela de Rotina da
  aluna recebe `aborted: true` ao concluir, NÃO mostra mais a tela de "concluído" como se tivesse
  dado certo — mostra uma mensagem clara ("Não consegui atualizar sua rotina agora porque as
  respostas ficaram incompletas. Sua rotina anterior continua ativa...") e mantém a aluna na tela de
  revisão. Antes, com o retorno antigo, isso teria passado batido silenciosamente pro aluno achar
  que salvou.
- **Achado novo e não relacionado ao bug de rotina, a partir de prints reais da conversa da Thais no
  WhatsApp (08/09)**: ela reclamou que "quando aumento muito as medidas ele não vai pra próxima" nas
  perguntas de roda (circunferências, `Avaliação física recente`). Causa real: a correção de 08/09 de
  manhã (debounce de 150ms unificando os três eventos de rolagem) também fazia `onMomentumScrollEnd`
  passar pelo MESMO timer de 150ms — só que esse evento já é o indice final de verdade (a inércia da
  rolagem já acabou quando ele dispara), então aquela espera extra era pura perda de tempo, e quanto
  maior a distância rolada (medidas indo de 30 a 200cm, por exemplo), mais longa a inércia e mais
  essa espera extra se destacava — dando a sensação de "trava" que ela descreveu ("tem que dar um
  tempo pra ele"). Corrigido: `onMomentumScrollEnd` agora confirma o índice na hora, sem debounce;
  `onScroll`/`onScrollEndDrag` continuam com o debounce de 150ms (ainda podem ser substituídos por um
  evento seguinte do mesmo gesto, diferente de `onMomentumScrollEnd`). `WheelColumn` em
  `apps/mobile/App.tsx`.
- **Dois outros itens da mesma conversa, verificados e NÃO são bugs**: (1) erro "403 — limite de
  atletas conectados excedido" do Strava é o teto conhecido de 10 alunas simultâneas (ver decisão de
  06/09, aceito por ora); (2) uma tela "preta"/carregando que ela printou não pôde ser diagnosticada
  com certeza (imagem chegou sem conteúdo visível) — hipótese mais provável é a tela normal de
  "Estamos montando seu treino" (geração de treino pode levar até 10 minutos), mas fica em aberto
  até haver um print mais claro ou ela dizer exatamente em que tela aconteceu.
- **Risco e validação**: risco Alto (dado de rotina de alunas pagantes) para as mudanças de backend,
  Médio (UX/estado local) para a mudança do picker. Implementado nesta sessão do Cowork, SEM
  `device_bash`/typecheck/lint/teste real — só verificação manual de sintaxe (chaves balanceadas).
  **Precisa passar pelos gates do Code antes de ir pra produção**: typecheck de `apps/api` e
  `apps/mobile`, lint, e idealmente um teste manual real (terminar a entrevista principal sem responder
  rotina e conferir que a rotina antiga não sumiu; rolar a roda de uma medida numa distância grande e
  ver se confirma sem demora perceptível depois de soltar).
- **Arquivos alterados**: `apps/api/src/me/me.service.ts` (`completeOnboarding`,
  `syncAvailabilityFromInterview`), `apps/mobile/App.tsx` (`WheelColumn`, `finishOrAdvance`).

**2026-09-11 (sessão 3) — Aba Evolução: redesign completo dos gráficos + histórico longitudinal**

Redesign total da aba Evolução no painel admin (`apps/admin/app/page.tsx`), transformando gráficos
básicos em painéis longitudinais comparáveis ao SisRun.

**6 novas seções de análise longitudinal**:
- `VisaoGeralSection`: cards de resumo de km total, aderência média e tendência de evolução.
- `PreWorkoutStateSection`: gráfico de médias de sono/cansaço/estresse/motivação por semana (dados do
  bloco 1 do feedback pós-treino v1 — coletados a partir de 11/09).
- `ExperienciaTreinoSection`: RPE médio semanal + satisfação com elaboração/execução ao longo do tempo.
- `DorLongitudinalSection`: histórico de incidência de dor (nenhuma / leve / moderada / forte) por
  semana, com linha de percentual de sessões com dor.
- `ExplorarRelacoesSection`: gráfico de dispersão cruzando pares de variáveis (ex.: sono × RPE,
  estresse × aderência) para identificar correlações longitudinais.
- `TimelineIntegradaSection`: linha do tempo unificando eventos-chave (provas alvo, mudanças de
  rotina, semanas com dor reportada) com o volume de km.

**KmEvolutionChart — 3 barras separadas por semana** (commits `9f622ed`, `2cbc23a`):
- Barra cinza (#94a3b8) = km Prescrito pelo treinador.
- Barra verde (#22c55e) = km Realizado total.
- Barra ciano (#06b6d4) = km Extras (`max(0, completedKm − prescribedKm)` — só sessões além do
  prescrito). Antes os extras eram empilhados sobre Realizado; agora são uma coluna separada,
  tornando o comparativo imediato.
- Rótulos inline em TODAS as 3 barras (não só ao passar o mouse).
- Linha de tendência SÓLIDA via regressão linear sobre `completedKm` (linha tracejada eliminada).
- Primeira versão rejeitada pelo Elton (linha tracejada, sem rótulos em Prescrito, extras empilhados);
  segunda versão aprovada.

**LoadChartAderencia — gráfico de colunas com filtro de modalidade** (mesmo commit):
- Substituiu gráfico de linha anterior por 3 colunas por semana: Prescrito (cinza), Feito (verde) +
  Extras stacked (ciano), Sem Registro (âmbar).
- Filtro interativo de modalidade via `useState<string>('all')`: botões aparecem somente para as
  modalidades presentes nos dados reais (corrida / musculação / fortalecimento / caminhada / outro).
- Rótulos numéricos inline nas colunas (visíveis sem hover, quando `bW >= 8`).
- Dados carregados de `history` (planos + sessões com `modality` e `completionStatus`);
  mapeados para a semana canônica via `weekStart`.

**LoadChartACR — escala e grade corrigidas** (commit `f91b73e`):
- Antes: linha plana em 1.0 com zona vermelha (>1.5) ocupando metade visual do gráfico; rótulos
  horizontais sobrepostos; apenas grade horizontal.
- Depois: ticks em 0 / 0.5 / 1.0 / 1.3 / 1.5 / 2.0 / 2.5 / 3.0; grade H+V (linhas verticais a
  cada `vTickEvery` pontos, adaptativo ao total de semanas); rótulos do eixo X rotacionados −45°;
  labels só em pontos-chave (primeiro, último, máximo, mínimo); `H=240`, `PB=56`.
- Legenda agora inclui aviso contextual explícito: "O ACWR é um indicador auxiliar — um valor fora
  da zona segura isoladamente não representa necessariamente risco. Interprete sempre em conjunto com
  RPE, sono, dor e contexto do atleta. Nunca altere a prescrição com base nesse número sozinho."

**Anel de esforço — box-shadow** (commit `9f622ed`):
- Problema: `border: 3px solid ${ring}` com `box-sizing: border-box` desenhava o anel DENTRO do
  círculo colorido, onde a cor sumia contra o fundo.
- Correção: `boxShadow: '0 0 0 2px var(--bg), 0 0 0 5px ${ring}'` cria anel externo com gap branco
  visível em qualquer fundo. Mesmo padrão aplicado na legenda do effort ring.

**Correções ESLint/TypeScript** (commit `825f2e3` e demais):
- `y0`: variável `const y0 = MT + CH` declarada mas não usada no KmEvolutionChart inicial —
  removida para passar o build do Next.js.
- `period`: parâmetro de `KmEvolutionChart` sem uso — anotado com `_period` ou encapsulado.
- `noPain`, `PT`, `PB`, `onNavigatePlan`, `plan`, `SatisfactionSection`: demais variáveis/funções
  não utilizadas encontradas e corrigidas (removidas ou prefixadas com `_`) durante o lint completo.

**coach.service.ts — 12 novos campos no histórico** (mesmo lote de commits desta sessão):
- `flatFeedbackSessions()` passa ao cliente admin os dados do bloco 1 (sono, cansaço, estresse,
  motivação), bloco 2 (RPE, sensação ao terminar, satisfação com elaboração/execução) e bloco 3
  (painFlag, painTiming): `preSleepQuality`, `prePhysicalFatigue`, `preStressLevel`,
  `preMotivation`, `postWorkoutFeeling`, `painFlag`, `painTiming`, `feedbackVersion`,
  `completedAt`, `completedDurationMin`, `completedDistanceKm`, `completedPaceSecondsKm`.
- Usado pelas 6 novas seções da aba Evolução para alimentar os gráficos longitudinais.

**Gates desta sessão**: typecheck limpo nos três apps antes de cada commit; lint verde; sem
migration nova além das já documentadas em sessão anterior (20260911210000_add_workout_feedback_v2).

**2026-09-12 — Redesenho completo do CompletionForm**

Reformulação da experiência de registro de treino após teste real com treino de 21km.

**Problemas identificados e corrigidos:**

- **DurationWheelField / DistanceWheelField substituídos por TextInputs** — os wheels piscavam e
  travavam no iOS dentro de ScrollView aninhado (re-renders em cascata ao calcular pace). Agora:
  3 campos compactos h / min / seg inline para duração; 1 TextInput decimal para distância.
  Sem migration, sem mudança na lógica de cálculo de pace (computePaceFromInputs ainda usado).

- **SessionPrescription colapsável** — botão "Recolher prescrição / Ver prescrição" adicionado
  (começa expandida). Resolve o aluno precisar rolar muito para chegar no formulário de registro.
  `runSummary` (totais globais) oculto quando há só 1 bloco de corrida — era completamente
  redundante com os dados do bloco único que aparece logo abaixo.

- **session.notes (aquecimento/resfriamento da IA) movido para dentro do colapsível** — antes
  aparecia sempre visível e ocupava espaço. Agora some quando o aluno recolhe a prescrição.
  Removê-lo programaticamente não seria possível sem parsear texto da IA.

- **Bloco 2 redesenhado:**
  - RPE 1–10 com gradiente de 10 cores (RPE_GRADIENT_10: vermelho→verde escuro), mesmo padrão
    visual colorido do bloco 1 — resolve o "tinha que apertar várias vezes".
  - Elaboração e Execução migrados para ScalePicker 1–5 (Pessimo→Adorei / Muito insatisfeito→Muito
    satisfeito). Mapeamento `satisfactionToNum` / `numToSatisfaction` mantém compatibilidade com os
    valores string do banco (amei/gostei/neutro/nao_gostei/detestei).
  - `postWorkoutFeeling` (campo existente, 1–5) renomeado para "Como seu CORPO se sentiu ao
    terminar?" — `POST_FEELING_LABELS` atualizados: "Exausto / no limite" → "Cheio de energia".
  - `postWorkoutMood` (campo novo, string '1'..'5') — "Como você terminou EMOCIONALMENTE?"
    ("Frustrado / chateado" → "Orgulhoso / muito feliz"). Guardado em `details.postWorkoutMood` —
    sem migration. Lido em `completionDraftFromSession` via `completion.details.postWorkoutMood`.

- **Pergunta de caminhada reformulada** — antes: 3 chips (Corri tudo / Caminhei pouco /
  Caminhei bastante). Agora: primário Não/Sim; ao escolher Sim, aparecem 7 sub-opções:
  "Caminhei apenas o pedido no treino" / "Caminhei pouco — esforço estava alto" / "Caminhei
  bastante — esforço estava alto" / "Caminhei por outros motivos" / "Parei para beber água" /
  "Parei para ir ao banheiro" / "Parei por outros motivos". Guardado em `details.pacingMode`
  (campo existente — sem migration). 'correu_tudo' = Não; qualquer sub-opção = Sim.

- **`block2Complete`** agora exige `postWorkoutMood` além dos demais campos do bloco 2.

**Arquivos alterados**: `apps/mobile/App.tsx`.

**Gates**: TypeScript limpo em mobile e admin. Sem migration.

**Commit**: `4b63e28 — feat(mobile): redesenho completo do CompletionForm`

---

**Commits desta sessão (espelho pendente de push)**:
- `9f622ed` — feat(admin): redesenha graficos da aba Evolucao
- `825f2e3` — fix(admin): remove variavel y0 nao utilizada no KmEvolutionChart (ESLint)
- `2cbc23a` — feat(admin): KmEvolutionChart com 3 barras por semana e labels em todas
- `f91b73e` — fix(admin): ACWR com escala correta, grade H+V, labels rotacionados e aviso contextual

---

**2026-09-12 (continuação) — Correções pós-teste do CompletionForm**

Quatro pontos levantados pelo Elton após testar o redesenho do formulário:

1. **Texto de alongamento removido** — `STANDARD_WARMUP_COOLDOWN_TEXT` em
   `training-plans.service.ts` terminava com "seguido de alongamento leve." — removido. Agora
   o resfriamento termina em "logo apos terminar." Sem migration.

2. **Steppers ▲/▼ para duração e distância** — `DurationWheelField` e `DistanceWheelField`
   trocados de TextInputs (que abriam o teclado ao toque) para botões Pressable ▲/▼.
   Duração: incremento por h / min / seg individualmente. Distância: incremento de 0.1 km por
   passo. Visual: valor grande centralizado entre os dois botões; nenhum campo editável.

3. **Formulário em página única** — Removida a navegação Continuar/Voltar entre os 3 blocos.
   Todo o formulário now aparece em um único scroll quando o aluno está em modo edição. As 3
   seções ("Como voce chegou", "Como foi o treino", "Dor e observacoes") ficam separadas por
   um divisor visual (`height:1, backgroundColor:#E2DDD5`). O botão Salvar foi movido para
   o rodapé e aparece sempre (antes só aparecia após confirmar o bloco 3). `feedbackStep`,
   `setFeedbackStep`, `ProgressDots`, `block1Complete` e `block2Complete` removidos;
   validação unificada em `allSectionsComplete`.

4. **Tempo e distância prescritos no cabeçalho colapsado** — Quando o card de sessão está
   recolhido, exibe `session.durationMin` e `session.distanceKm` abaixo do título (ex:
   "45 min · 8.0 km"). Some quando expandido (a prescrição detalhada já aparece dentro).

**Arquivos alterados**: `apps/mobile/App.tsx`, `apps/api/src/training-plans/training-plans.service.ts`.

**Gates**: TypeScript limpo (mobile). Sem migration.

**Commit**: `c7665ae — fix: formulario de feedback em scroll unico, steppers para tempo/distancia...`

**2026-09-12 (continuação 2) — Investigação de bugs reportados por testadores + bug crítico da API**

Dois reportes chegaram via WhatsApp/Instagram de pessoas testando o app:

**Lucelane ("Estou sem acesso ao app")** — Aluna ativa que se cadastrou também como testadora. A tela
que ela vê ("Seu acesso está quase pronto" com campo de CPF e "Ativar minha assinatura") é exibida
quando `!plan && !hasSubscriptionAccess`. As hipóteses, em ordem de probabilidade:
1. Ela entrou no app com um **e-mail diferente** do e-mail de aluna (conta nova sem assinatura).
2. O `subscriptionStatus` da conta dela está como `'pending'` por falha de sync do cron de billing.
**Diagnóstico necessário**: verificar no painel admin qual conta a Lucelane está usando e qual o
`subscriptionStatus`. Se for conta diferente: orientar a usar o e-mail correto, ou adicionar a conta
de testadora ao painel como aluna. Não há código a corrigir até confirmar a causa.

**Tiago ("Preencha todas as perguntas do bloco 'Como você chegou'")** — BUG CRÍTICO encontrado e
corrigido. A causa: ontem adicionamos validação no servidor (`workout-completions.service.ts`) que
exige os 4 campos de pré-treino (`preSleepQuality`, `prePhysicalFatigue`, `preStressLevel`,
`preMotivation`) e `postWorkoutFeeling` para qualquer completion `done`/`adjusted`. Mas o build
da Play Store que os testadores têm é mais antigo — esses campos não existem na interface deles.
Resultado: o Tiago preenche o que consegue com a tela antiga, tenta salvar, e a API nova retorna 400.

**Correção aplicada**: lógica `isV1Client` em `workout-completions.service.ts`. Se ao menos um campo
de pré-treino veio no DTO, é cliente v1 e todos devem vir. Se nenhum veio, é cliente antigo — passa
sem eles. A validação de satisfação/elaboração/painFlag (que existia na tela antiga) permanece
obrigatória para todos.

**Gates**: TypeScript limpo (API). Sem migration.

**Commit**: `3c65ab9 — fix: validacao de feedback v1 retrocompativel com clientes antigos da Play Store`

**Play Store — atualização para testadores**: Os testadores com build da Play Store NÃO verão o novo
formulário (scroll único, wheel picker de tempo/distância, métricas no topo) sem uma nova build EAS.
Com o fix acima, ao menos eles voltam a conseguir salvar treinos. Para receber o redesenho completo,
é necessário um novo `gerar-app-android-producao.bat` + subir o AAB no Play Console. A decisão de
quando fazer isso é do Elton.

**Pente fino no CompletionForm (novo formato)** — revisão do código, sem bugs novos encontrados:
- `whyExpanded` declarado corretamente (linha 8239).
- `distanceKm.replace(',', '.')` seguro: `defaultCompletionDraft` sempre inicializa como `''`.
- `allSectionsComplete` exige `postWorkoutMood`, mas a API não valida esse campo (vai em `details`).
  Inconsistência intencional: o mobile é mais rigoroso que a API para garantir captura do humor.
- Editar completions antigas (sem campos v1) requer preencher tudo de novo → fricção esperada
  (nenhuma "jornada de edição retroativa" foi projetada, o treinador não pediu isso).

**2026-09-13 — Bug real: IA prescrevia sessões para dias com `noTraining=true` (Tiago)**

**Sintoma reportado**: o programa semanal do Tiago mostrava Seg/Ter/Qua/Sex sem treino ("Sem treino")
e Dom com 2 sessões indevidas (Corrida + Fortalecimento), sendo que Dom está marcado como "Não treina"
na rotina dele (Dom=NÃO).

**Causa raiz** (`apps/api/src/training-plans/training-plans.service.ts`, `generateWeek()`):
- O array `weekDates` enviado ao agente de IA era construído com `[0, 1, 2, 3, 4, 5, 6]` fixo — todos
  os 7 dias da semana, sem filtrar pelos dias que o aluno realmente treina.
- `availability` já vem do banco com `noTraining: false` (linha 474), então `availableDays` não contém
  Dom. Mas `weekDates` usava um array fixo que incluía weekday=0 (Dom) com a data correspondente (13/09).
- Como Dom era data futura no momento em que o programa foi gerado, a IA viu 13/09 como uma data válida
  e prescreveu 2 sessões para ela. Essas sessões entraram pelo caminho de `extraRunSessions` (sobras do
  `runDecisionsByWeekday`), sem nenhuma verificação de `noTraining`.
- As sessões de Seg a Sex apareceram como "Sem treino" porque eram passadas no momento da geração —
  foram filtradas corretamente pelo filtro de datas. A geração foi feita em algum momento anterior
  (provavelmente sábado 12/09), e o programa ficou com só Sab + Dom preenchidos.

**Correção aplicada (13/09/2026)**:
1. `weekDates` agora filtra por `trainingWeekdays` (Set derivado de `availableDays`):
   ```typescript
   const trainingWeekdays = new Set(availableDays.map((d) => d.weekday));
   weekDates: [0,1,2,3,4,5,6].filter(w => trainingWeekdays.has(w)).map(...)
   ```
   A IA passa a receber somente os dias que fazem parte da rotina do aluno — Dom nunca aparece quando
   Dom=NÃO.

2. Guard no loop `extraRunSessions`: mesmo que a IA alucinasse um weekday fora da rotina (improvável
   agora, mas defensivo), a sessão é descartada com log de warning antes de ser criada.

**Arquivo alterado**: `apps/api/src/training-plans/training-plans.service.ts`.

**Gates**: typecheck limpo (API). Sem migration.

**Contexto adicional — `shouldRollToNextWeek`**: bug separado identificado nesta sessão, ainda não
corrigido. Se alguém gerar treino no domingo antes das 12h com Dom=NÃO na rotina, `shouldRollToNextWeek`
permanece `false` porque a condição `(!activePlanBeforeAdjustment || pastWeeklyRelease)` impede o
rollover para quem já tem plano ativo. O sistema fica preso na semana atual sem nenhum dia de treino
disponível. Esse bug não causou o problema do Tiago (ele foi gerado em outro dia), mas vai morder alguém
num cenário de domingo. Registrado para correção futura com aprovação.

**2026-09-13 — Bug real: Telegram falso "solicitou alteração de rotina" (Lucelane)**

**Sintoma reportado**: Telegram de "solicitou alteração de rotina" disparou para a Lucelane quando ela
apenas abriu a tela "Rotina de treinos", clicou em "Alterar rotina" e navegou pelas perguntas sem mudar
nada — concluindo sem alterar nenhuma resposta.

**Causa raiz**: A ORDEM EXECUTIVA 09/09 removeu o back-sync WA→interview (para evitar sobreescrever
respostas da entrevista com dados da WA). Isso criou deriva silenciosa entre a `WeeklyAvailability` e as
respostas da `OnboardingInterview`. Quando o aluno conclui a GuidedInterview em mode="routine" sem mudar
nada, `availabilityChanged()` comparava WA vs respostas da entrevista e devolvia `true` pela deriva,
fazendo `syncAvailabilityFromInterview` disparar o Telegram mesmo sem mudança real do aluno.

**Correção aplicada (13/09/2026)**: comparação de respostas no próprio app (não no servidor):
1. `App.tsx` (`GuidedInterview`, mode="routine"): `initialAnswersRef` guarda as respostas no momento do
   load; `finishOrAdvance` compara JSON antes/depois e envia `changesWereMade: boolean` no corpo do POST.
2. `me.controller.ts`: endpoint `POST onboarding/complete-routine` agora aceita `{ changesWereMade?: boolean }`.
3. `me.service.ts`: `completeRoutineFromInterview` e `syncAvailabilityFromInterview` recebem `changesWereMade`;
   o Telegram só dispara quando `notifyAsStudentRequest && changesWereMade`. Default conservador: `undefined → true`
   para apps antigos sem o campo (não silencia notificações legítimas).

**Arquivos alterados**: `apps/mobile/App.tsx`, `apps/api/src/me/me.controller.ts`, `apps/api/src/me/me.service.ts`.

**Gates**: typecheck limpo (API + mobile). Sem migration.

**Nota**: esta correção (API) já foi deployada por Elton. O lado mobile (`App.tsx` — `initialAnswersRef` +
`changesWereMade`) exige novo build EAS para entrar em vigor no app instalado pelas alunas.

---

**2026-09-13 — Regressão grave: `isDetailedPlan` impedindo Lucelane (e potencialmente outros) de ver o plano**

**Contexto**: O commit `6215363` (12/09, mesma sessão que introduziu a tela de Rotina no admin) adicionou a
função `isDetailedPlan()` em `apps/mobile/App.tsx`. A intenção era detectar "planos em formato antigo" (sem
`structure.type` definido) para não mostrar a tela de pagamento incorretamente para planos antigos. A função
verificava se TODAS as sessões tinham `structure.type === 'run' | 'strength' | 'aerobic'`.

**Bug introduzido**: `isDetailedPlan()` retornava `false` para planos válidos de alunas reais — impedindo o
app de exibir o plano e caindo no caminho `notGenerated`. Causa: o valor `'aerobic'` foi adicionado ao check
mas **nenhum plano gerado pelo backend jamais cria `structure.type === 'aerobic'`** — o backend só cria `'run'`
e `'strength'`. O `'aerobic'` existe no TypeScript (tipo), mas nunca no banco de dados. Qualquer sessão com
tipo não previsto retornava `false` da função, bloqueando a exibição.

**Tentativa errada (commit `0202873`, 13/09)**: Filtrou sessões com `source: 'student'` do check (teoria de
que Lucelane tinha adicionado uma sessão extra com `type: 'extra'`). Elton confirmou que ela não adicionou
nada. A teoria estava errada — a fix não resolveu.

**Fix real (commit `be1ec20`, 13/09)**: Removida `isDetailedPlan()` inteiramente de `loadPlan()` e
`generatePlan()`. Comportamento correto e simples: **se a API devolveu um plano, exibe o plano**. A proteção
de tela de pagamento já existe separada (`!plan && (!notGeneratedRange || !notGeneratedRange.hasSubscriptionAccess)`)
e só dispara quando a API confirma explicitamente que não há acesso.

**Resultado após deploy**: AINDA não resolveu para a Lucelane — ver entrada seguinte.

**Lição**: A `isDetailedPlan` era proteção desnecessária que criava um segundo "gate" após a API já ter
validado e devolvido o plano. Não existe "plano em formato antigo" sendo devolvido pela API em produção —
`current()` só devolve planos com estrutura atual. Se existisse, o lugar certo de lidar seria a API, não o
frontend inventando critérios de validação de estrutura.

---

**2026-09-13 — ABERTO: Lucelane não consegue ver o programa (plano invisível após 3 tentativas)**

**Dossiê**: `erros persistentes/0004_Lucelane_Plano_Invisivel.md`

**Situação**: Após o deploy de `be1ec20` (remoção de `isDetailedPlan`), Lucelane continua sem ver o programa
no Android e no iPhone. A sessão anterior (12/09) havia diagnosticado como suspeita de conta errada ou
`subscriptionStatus: 'pending'` — diagnóstico pendente de confirmação no painel admin.

**O que o código atual faz** (após `be1ec20`):
- `loadPlan()` chama `GET /training-plans/current`
- Se a API retornar `notGenerated: true` → `setNotGeneratedRange(...)` → ou "Ainda não liberado" (se
  `hasSubscriptionAccess: true`) ou tela de pagamento (se `hasSubscriptionAccess: false`)
- Se a API retornar o plano → `setPlan(data)` → plano aparece

**Hipótese mais provável**: A API está retornando `notGenerated: true` para ela. Isso acontece quando
`current()` não encontra nenhum `TrainingPlan` com `status: 'active'` e `startDate IN [weekStart, weekStart+7]`.

**Diagnóstico necessário (ainda pendente)**:
1. Qual é o `subscriptionStatus` atual da conta dela no painel admin?
2. Ela tem um `TrainingPlan` com `status: 'active'` para a semana de 07/09?
3. Se sim, qual é o `startDate` do plano? Bate com `startOfWeek(new Date())`?
4. Ela está logando com o e-mail correto (conta de aluna, não conta de testadora)?

**Atenção**: hoje é domingo (13/09). `startOfWeek(new Date())` com padrão date-fns retorna domingo = 13/09.
Um plano gerado na semana passada (startDate = 07/09, segunda-feira) NÃO seria encontrado pela query
`startDate IN [13/09, 20/09]`. Isso pode ser o problema — mas só afetaria quem gerou o plano em outro
startDate. Verificar se `generateWeek()` usa o mesmo `startOfWeek()` que `current()`.

**Estado**: ABERTO. Nenhuma mudança de código foi feita além da remoção de `isDetailedPlan`. Próximo passo
é verificar os pontos de diagnóstico acima antes de qualquer mudança de código.

**2026-09-16 — Panzeri Data Layer: cadeia de atribuição implementada (Opção C híbrida)**

Auditoria revelou que `User.acquisitionAttribution` nunca foi escrito para nenhum dos 65 alunos: a landing capturava UTMs, mas o PWA nunca lia `window.location.search` e o `/auth/register` não aceitava campos de atribuição. Dados dos 65 alunos anteriores são irrecuperáveis.

Correção implementada para novos cadastros:
- `App.tsx` captura UTMs + referrer da URL na primeira abertura (first-touch, first-storage), persiste em `AsyncStorage['panzeri-run-funnel-attribution']`, nunca sobrescreve.
- Evento `app_opened` passa atribuição em `metadata` → permite analisar conversão mesmo de visitantes que não concluem cadastro.
- Cadastro: envia `attribution` com campos explícitos (source/medium/campaign/content/term/referrer/fbclid/gclid/journeyId) para `POST /auth/register`.
- `RegisterDto` valida campos via `AcquisitionAttributionDto` (sem `Record<string, unknown>` livre).
- `auth.service.ts` grava em `User.acquisitionAttribution` somente quando ao menos um campo é preenchido — null quando direto/sem campanha. Nunca inventa origem.
- `journeyId` na atribuição = `funnelSessionId` do momento do cadastro — vincula `User.acquisitionAttribution` aos `FunnelEvents` da mesma sessão.
- Sem migration — campo `acquisitionAttribution Json?` já existia.
- `FunnelEvent.journeyId` (schema): campo existente mas nunca populado. Mantido. `sessionId` é o identificador canônico de jornada.

**2026-09-17 — Três bugs corrigidos em sessões extras (Luiza case)**

**Contexto**: Aluna Luiza criou sessão extra de corrida pelo próprio app. Ao abrir o registro
do treino depois de salvar, ela via: cabeçalho colapsado sem dados, formulário sem campos de
Tempo/Distância, data "16/09" sendo 17/09 o dia real, e mensagens (Avisos) travando ao tentar apagar.

**Bug 1 — Campos Tempo/Distância sumindo no formulário de registro** (commits 0b0dade, e51e58b)
- **Causa**: `addStudentExtraSession` grava `structure = { type: 'extra', source: 'student' }`.
  O `CompletionForm` só mostrava os campos quando `session.structure?.type === 'run'` — que nunca
  é verdade para sessões criadas pela aluna.
- **Fix** (App.tsx, CompletionForm): `isRun` agora também inclui `session.modality === 'corrida'`
  e `'esteira'`. Sessões do coach continuam com `structure.type === 'run'` e não são afetadas.
- **Regra**: NÃO assumir que só `structure.type === 'run'` identifica corrida — sessões extras
  da aluna usam `type: 'extra'`, classificação real fica em `modality`.

**Bug 2 — Data exibida um dia antes do real** (commit e51e58b — dossiê 0005)
- **Causa**: `completedAt: scheduledDate` salvava meia-noite UTC. No Brasil (UTC-3), isso é
  21h do dia anterior. `isoDateToInputValue` usava `getDate()` (hora local) → dia errado.
- **Fix duplo**: API grava `completedAt` ao meio-dia UTC (12:00:00Z). App usa `getUTCDate()`
  para ler datas — protege dados históricos já gravados com meia-noite UTC.
- **Regra**: Qualquer `completedAt` definido pelo servidor usa **12:00:00Z** (não 00:00:00Z).
  Leitura de datas no app usa sempre métodos UTC (`getUTCDate`, `getUTCMonth`, `getUTCFullYear`).

**Bug 3 — Avisos travando ao tentar apagar (scroll bloqueado)** (commit e51e58b)
- **Causa**: `PanResponder` capturava gesto com `dx > 8px` — durante scroll vertical no iPhone,
  qualquer deriva lateral de 8px dispara o handler e bloqueia o scroll completamente.
- **Fix**: Threshold aumentado para `dx > 20px` E `dx > dy * 1.5` (gesto claramente horizontal).

**Bug 4 — Cabeçalho colapsado mostrando prescrição em vez do realizado** (commit 8cad4c4)
- **Causa**: Cabeçalho colapsado lia `session.durationMin` (prescrição = 0 para extras).
- **Fix**: Agora lê `session.completion?.durationMin ?? session.durationMin` para preferir
  o valor realizado quando existe.

**2026-09-17 (continuação) — Admin: km e duração de extras no calendário/histórico/gráfico + formulário extra com feedback completo**

**Admin — km sem aparecer no calendário e histórico flotante**
- Calendário (`TrainingCalendarDots`): lia `session.distanceKm` (null para extras) → agora usa `session.completedDistanceKm ?? session.distanceKm`
- Histórico: mostrava `durationMin` como float (`32.916...`) → `Math.round((session.completedDurationMin ?? session.durationMin) ?? 0)` + km real de `completedDistanceKm`
- Gráfico de volume: barra cyan não aparecia porque `extraKm = max(0, completedKm - prescribedKm)` → sempre 0 quando realizado < prescrito. Fix: `extraKm` calculado de sessões com `structure.source === 'student'`; barra verde vira `regularKm = completedKm - extraKm`.

**Bug 5 — Card de sessão extra mostrando bloco de prescrição vazio** (dossiê 0008)
- **Causa**: `SessionPrescription` não tinha branch para `type === 'extra'`, caía no render de corrida e mostrava "Treino principal | 0 min | DISTANCIA - | PACE - | VELOCIDADE -".
- **Fix**: `if (structure.type === 'extra') return null;` + tipo `SessionStructure` com variante `'extra'`.

**Bug 6 — Formulário de treino extra sem perguntas de feedback** (dossiê 0007)
- **Causa**: Modal "Registrar Treino Extra" coletava apenas 7 campos. Feedback v1 (11 perguntas) nunca foi adicionado ao modal. Aluno precisava de 2 passos; na prática ficava sem dados.
- **Fix**: `extraForm` expandido com todos os campos de feedback. UI do modal com seções "Como voce chegou" / "Como foi o treino" / "Dor e observacoes" (reutilizando ScaleStr, ScalePicker, OptionChips). API: controller e service aceitam e persistem todos os campos.
- `ScaleStr` e `OptionChips` movidos de funções locais dentro de `CompletionForm` para nível de módulo, para reuso.

**2026-09-17 (continuação 2) — Admin: gráficos de aderência e carga semanal corrigidos**

- **LoadChartAderencia — barra cyan nunca aparecia** (dossiê 0010): `extras = max(0, completedSessions - prescribedSessions)` — sempre 0 quando há sessões prescritas não-feitas. Fix: adicionado `extraSessions` ao tipo `WeekData` e ao mapeamento `allWeeks`, contando sessões com `structure.source === 'student'`. `LoadChartAderencia` usa `w.extraSessions`.
- **LoadChartSemanal — cor da barra comparava com semana imediatamente anterior mesmo se ela fosse 0km**: agora busca a semana anterior mais recente com km > 0; tendência só exibida com n ≥ 4 semanas.
- **Arquivos alterados**: `apps/admin/app/page.tsx`.

**2026-09-17 (continuação 3) — Mobile: KmLineChart rótulos em todos os pontos + percorrido inclui extras + Evolução com mais dados**

- **KmLineChart — rótulos em todos os pontos**: antes apenas o pico tinha rótulo. Agora todos os pontos têm rótulo com o valor em km, offset vertical por série (série 0: y-9, série 1: y-17, série 2: y-26) para não sobrepor. `paddingTop` dinâmico (`20 + activeSeries.length * 8`) para acomodar rótulos extras.
- **KmLineChart — série "percorrido" inclui kmExtras**: a linha azul agora soma `kmPercorridos + kmExtras` — reflete tudo que o aluno correu de fato, incluindo treinos extras que ele próprio adicionou. Valor 0 vira null para não quebrar a linha.
- **Evolução — 6 novos cards de dados**: duas linhas de 3 cards adicionadas abaixo dos cards originais (aderência/sequência/sem reg):
  - Linha 2: "Total (km)" (allTime), "No período" (período selecionado no gráfico), "Melhor sem." (melhor semana do período).
  - Linha 3: "Média/sem." (km/semana com km no período), "Recorde seq." (longestStreakWeeks), "Último reg." (data do último treino registrado).
- Estatísticas de período computadas em `Progress` a partir de `data.recentWeeks` filtrado pelo `chartPeriod` corrente.
- **Arquivo alterado**: `apps/mobile/App.tsx`.
- **Gates**: typecheck limpo (mobile e admin).

**2026-09-24/25 — Training Intelligence: Passos 1 a 4 (fundação longitudinal, ciclo de vida da prescrição, reavaliação de 15 semanas, contexto/lacunas)**

Retomada tardia do Diário — este bloco cobre 4 rodadas grandes de trabalho aprovadas por Elton e implementadas em sequência, cada uma encerrada com "PARE, não avance sem minha ordem" antes da próxima. Registrado aqui de uma vez porque não foi anotado no momento (falha de processo — corrigir daqui pra frente: anotar a cada Passo fechado, não só no fim).

**Passo 1/2 — Fundação de Training Intelligence + Athlete State Snapshot + correção do ciclo de vida da prescrição.**
- `VariableRegistry` + `ObservationReaderService` + `MathLayerService` + `LongitudinalDynamicsService`: camada determinística que lê WorkoutCompletion/WeeklyCheckIn e calcula média/tendência/baseline/desvio/variabilidade/excursões/persistência/retorno por variável, sempre preservando `evidence.n`/`observedSpan`/missing≠zero.
- `AthleteStateSnapshotService` (`/coach/students/:id/athlete-state`): orquestra tudo isso em domínios (training/sleepRecovery/physicalState/psychologicalState/trainingResponse/painHealth/performanceCapacity/behavior/lifeContext/systemDynamics/evidenceQuality) — não é score, não decide treino.
- `CompactAgentContext`: comprime o Snapshot pro prompt do agente de prescrição sem duplicar dado.
- **Correção do ciclo de vida da prescrição** (schema): `TrainingSession.origin` ('agent'/'coach_manual'/'student_extra'/null=legado), `TrainingSession.prescriptionHistory` (snapshot append-only quando edição manual sobrescreve sessão já executada), `TrainingSession.updatedAt`. `regenerateSession()` passou a bloquear sessão já executada (`code: 'session_already_completed'`) e respeitar a regra temporal (passado nunca regenera; hoje só com `allowToday` explícito). Prova cadastrada virou exceção explícita de rotina (`injectTargetRaceDays`). "Ajustado" virou "Fiz, mas mudei o treino" na UI (`WorkoutCompletion.adjustmentReasons/adjustmentComment/adjustmentPreferredActivity`, valor interno `'adjusted'` preservado). `TRAINING_INTELLIGENCE_DATA_CUTOFF` (01/08/2026) centralizado em `common/training-history-policy.ts`.
- **Arquivos-chave**: `apps/api/src/training-intelligence/*`, `training-plans.service.ts` (generateWeek/regenerateSession), `coach.service.ts` (updateTrainingSession), `prescription-agent.service.ts`.

**Passo 3 — Reavaliação de 15 semanas + trajetória longitudinal + Evolution Report.**
- Ciclo oficial mudou de 90 para **105 dias** (`ReassessmentService.REASSESSMENT_DUE_AFTER_DAYS`), âncora = última reavaliação concluída ou `OnboardingInterview.completedAt`. Aviso na semana 14 (`REASSESSMENT_WARNING_AFTER_DAYS=98`) via cron diário (push+e-mail). Ao completar 105 dias, `generateWeek()` bloqueia a próxima geração (`code: 'reassessment_required'`) sem tocar treinos já existentes.
- Reavaliação passou a reaplicar, com as MESMAS chaves da entrevista inicial, os 17 ratings 1-10, objetivo (9 opções canônicas), dor estruturada por região e km semanal — produzindo série real INITIAL→R1→R2→R3 (`reassessment-trajectory.ts`, `buildReassessmentTrajectories`), com comparabilidade DIRECT/PARTIAL declarada por variável e missing nunca virando zero.
- Versionamento novo: `OnboardingInterview.interviewVersion`/`Reassessment.reassessmentVersion` (null=legado, nunca reclassificado retroativamente).
- `EvolutionReport` (tabela nova): gerado uma vez por reavaliação concluída (`ReassessmentService.complete()`), persistido, reutilizado pelo agente de prescrição sem re-chamar a IA. Reopen de uma reavaliação invalida (`invalidatedAt`) o relatório associado. `EvolutionAgentService` reescrito pra receber a trajetória COMPLETA (não só "últimas 5") + Athlete State Snapshot, sem nunca gerar score/nota geral.
- **Arquivos-chave**: `apps/api/src/reassessment/*`, `apps/mobile/App.tsx` (reassessmentQuestions).

**Passo 4 — ContextEvent (contexto longitudinal) + retorno após lacuna de treino.**
- `ContextEvent` (tabela nova, spec já estava escrita em `ATHLETE_STATE_MODEL.md` seções 12-15): type/subtype/startedAt/endedAt/status(ongoing|ended)/source(student_reported|coach_reported|reassessment|return_after_gap|system_detected)/originalText. Nunca infere causa — observação, relato e associação temporal ficam sempre separados.
- Detecção de gap: 14 dias sem execução válida (`GAP_RETURN_THRESHOLD_DAYS`, centralizado em `context-events/context-event-types.ts`) dispara questionário de retorno no app (5 perguntas: treinou?/motivo/condição física 1-5/disposição mental 1-5/nota livre) — tudo autorrelato, nunca vira WorkoutCompletion/RPE/volume inventado.
- `WorkoutCompletion.firstObservationAfterGapEventId`: metadado que marca a primeira execução real após um retorno respondido (pra Training Intelligence estudar antes→gap→retorno→recuperação depois).
- `AthleteStateSnapshotService.lifeContext` ganhou `activeEvents`/`recentEvents`/`currentGapStatus`/`latestReturnContext` (além da contagem de StudentObservation/StudentDirective que já existia).
- Caminho manual do treinador pronto (`POST /coach/students/:id/context-events`), sem tela no admin ainda (fica pro Passo 5).
- **Arquivos-chave**: `apps/api/src/context-events/*` (módulo novo), `workout-completions.service.ts`, `athlete-state-snapshot.service.ts`.

**Validação real (Elton/Juliana/Lucelane) em todos os 4 Passos**: só leitura em produção, nenhum dado fabricado. Nenhum dos três estava em gap ao final do Passo 4 (todos treinaram no dia). Nenhum dos três tinha reavaliação concluída ainda ao final do Passo 3 (ciclo de 105 dias ainda não se completou pra nenhum). Cutoff de 01/08 confirmado ativo em produção (ex: `perceivedEffort` de Elton caiu de n=63/from=02/07 pra n=54/from=02/08 após o Passo 2).

**Gates**: cada Passo fechado com typecheck limpo (api+mobile) e suíte de testes verde antes de sincronizar (208→258→276 testes ao longo dos 4 Passos). 3 suítes pré-existentes (`training-methodology.spec.ts`, `exercise-libraries.spec.ts`, `auth.service.spec.ts`) seguem quebradas por motivo não relacionado a este trabalho (referenciam código de outra feature em andamento) — não foram tocadas.

**Commits no espelho**: `6764a9a` (Passo 2), `ca5ff84` (Passo 3), `db6f2cf` (Passo 4). Todos com push+deploy confirmados por Elton antes da validação real de cada Passo.
[nota adicionada 27/09/2026: os itens marcados acima como "fora de escopo por decisão do Elton" (medicação, ciclo como camada visual, byModality-style pro ciclo) tiveram a ordem original retomada e ampliada por Elton em 26/09 — ver entrada abaixo, "Acompanhamento menstrual — fechamento da ordem original". O fato histórico acima (o que foi decidido em 25/09) continua registrado como estava; isso é só o encadeamento temporal.]

**Pendência explícita**: Passo 5 (dashboard/telas de contexto, tela do treinador pra ContextEvent manual, Evolution Report na UI) só começa com ordem explícita de Elton — não implementado ainda.

**2026-09-25/26 — Visualização e Exploração Longitudinal do Admin + modalidade chegando ao agente (fase declarada como continuação, não reabertura da Fundação Training Intelligence)**

Elton pediu explicitamente para não reabrir a Fundação (Passos 1-4 acima) e expor visualmente a inteligência já construída, evoluindo o Admin existente sem tocar no calendário atual.

- **Correção pontual**: `student.history` do backend inclui o plano ativo (dedupe só por chave de semana) — `TimelineTab` do Admin duplicava sessão/feedback da semana corrente ao concatenar `plan.sessions`+`history`. Corrigido com dedupe por id de sessão em `apps/admin/app/page.tsx`.
- **`LongitudinalExplorer`** (novo, dentro da aba Evolução de cada aluno, `apps/admin/app/page.tsx`): navegação PASTA→VARIÁVEL→MATEMÁTICA→OBSERVAÇÃO ORIGINAL reaproveitando 100% o backend canônico (`getVariableSnapshot`, `variable-legend`) — nenhum cálculo novo, só apresentação. Camadas (Bruto/MM21/MM60/MM200/Baseline/Faixa habitual/eventos de contexto), "Sistema" (construtor de séries livre cross-variável, overlay de até 2), pin/fixar análise, glossário com tooltips (ⓘ).
- **Modalidade como dimensão preservada, não filtro**: `getVariableSnapshot` ganhou parâmetro opcional `modalities?: string[]` (filtra observações ANTES de toda a matemática — mesmas funções, subconjunto filtrado) + `availableModalities`/`movingAverageSeries` na resposta. Primeira versão filtrava por união de modalidades num "pool" só (ERRADA, corrigida no mesmo dia por ordem de Elton); versão final: cada série selecionada (Global + cada modalidade) é buscada e calculada **independentemente**, nunca merge-then-filter — `VariableSeriesBlock` por série no modo "Aprofundar".
- **"Comparar Modalidades"** (novo modo em `VariableDeepDive`): um único gráfico com uma linha independente por série selecionada, mesmo eixo/escala, seletor de Transformação (Bruto/MM21/MM60/MM200/Baseline) aplicado uniformemente, `SeriesDistributionSummary` (n/mediana/faixa, "descrição nunca conclusão") — reaproveita os snapshots já buscados, nunca uma série derivada nova.
- **Fechamento do gap Snapshot→agente**: `AthleteStateSnapshotService`/`CompactAgentContext`/`PrescriptionAgentService` ganharam `byModality` (só variáveis com dimensão de modalidade E evidência real n>0 por modalidade — nunca lista vazia "pra completar"). Prompt do agente ganhou regra explícita: Global é a série literal (nunca "carga interna"), ausência de uma modalidade ≠ zero, proibido regra automática tipo "RPE corrida subiu → reduzir corrida" — a matemática caracteriza, o agente interpreta.
- **Validação real (Lucelane, RPE)**: 29 obs corrida / 62 global / 1 musculação. Achado real: tendência de curto prazo diverge por modalidade (Global `decreasing`, Corrida isolada `increasing`) — exatamente o tipo de diferença que se perderia sem o `byModality`. Confirmado ponto-a-ponto que a série "corrida" filtrada via API contém 100% observações com `context.modality==='corrida'`.
- **Bug de investigação (falso positivo, registrado como aprendizado)**: seletor de Transformação parecia não afetar o gráfico de "Comparar Modalidades" — investigação por SVG-path-diff mostrou path idêntico entre Bruto/MM21. Causa real: os cliques de teste usados (`form_input` em checkboxes) setavam o DOM sem disparar o evento React de verdade, deixando `selectedSeries` vazio por trás de checkboxes visualmente marcados. Com cliques reais (`computer left_click` por `ref`), tudo funcionou (paths diferentes, 3→2 linhas ao desmarcar, filtragem por modalidade 100% correta). Nenhum bug de produto — falha da própria metodologia de teste automatizado nesta sessão. **Aprendizado**: nesta ferramenta de browser, usar clique real via `ref` para checkboxes controlados por React, não `form_input`.
- **Ciclo menstrual — evolução completa** (feature separada, mesma janela de trabalho): calendário mensal real substituindo o campo de texto único; início/fim de menstruação rastreados separadamente (histórico nunca sobrescrito); registro diário de sintomas (cólica/energia/humor/fluxo); predição de próximo ciclo derivada de variabilidade real (nunca assume 28 dias fixos); `MenstrualDailyLog` (tabela nova) + `MenstrualCycleLog.cycleEndDate/flowIntensity`; `cycle.crampsLevel/energyLevel/moodLevel` entraram no Variable Registry (domínio `menstrual_cycle`); notificação por push agora navega de verdade ao toque (`data.action` — gap real encontrado e fechado, existia campo mas nada escutava). Explicitamente fora de escopo por decisão do Elton: medicação como contexto, ciclo como camada visual sobre outros gráficos, `byModality`-style para o ciclo especificamente.
- **Arquivos-chave**: `apps/admin/app/page.tsx` (Explorer inteiro), `apps/api/src/training-intelligence/{variable-registry,observation-reader.service,training-intelligence-query.service,athlete-state-snapshot.service,compact-agent-context}.ts`, `apps/api/src/training-plans/prescription-agent.service.ts`, `apps/api/src/menstrual-cycle/*` (reescrito), `apps/mobile/App.tsx` (calendário + tap-to-navigate).
- **Gates**: typecheck limpo (api+admin) em cada rodada; suíte 310/310 (3 suítes pré-existentes não relacionadas seguem quebradas, mesmas do registro anterior).
- **Commits no espelho**: `e40b05b` (Explorer inicial), `9b4ccc9` (modalidade v1, corrigida no mesmo dia), `0cd1850` (séries independentes), `7760e47`+`5144cd8` (ciclo menstrual), `9b75741` (Comparar Modalidades + `byModality` no agente — fecha esta fase). Push+deploy de cada um confirmado por Elton antes de seguir.

**2026-09-26/27 — Acompanhamento menstrual: fechamento da ordem original (medicamentos, ciclo real no agente, notificações recorrentes, ciclo como camada temporal)**

Elton retomou explicitamente a ordem de 25/09 (que tinha sido só parcialmente implementada) com 13 seções detalhadas, deixando claro "não reabra a conceituação, não refaça o que já está funcionando". Trabalho feito em 4 rodadas sincronizadas separadamente:

- **Medicamentos como contexto temporal (item 4)**: reaproveitado 100% o `ContextEvent` já existente (`type='medication'` novo na lista) em vez de criar tabela nova — início/fim/status já eram exatamente os campos que existiam. Nome do medicamento vai em `originalText`, que `getLifeContextData()` já excluía do que chega ao Snapshot/agente (só type/subtype/datas) — ou seja, o nome do remédio nunca chega à IA, fechando sozinho o requisito de privacidade/anti-inferência-farmacológica sem nenhum código extra. Endpoints novos: `POST/GET /me/context-events/medications`, `PATCH .../:id/end`. Tela no app (dentro de Ciclo, recolhida por padrão).
- **Ciclo real chegando ao agente (itens 7/8 — gap fechado)**: o agente recebia `getEstimatedPhaseContext` (fase fixa assumindo 28 dias/ovulação dia 14 quando a aluna não declarava duração). Substituído por `MenstrualCycleService.getAgentContext()`, inteiramente baseado no histórico real via `getCycleOverview` já existente (maturity/n/mediana real/janela prevista/ressalvas) — nunca uma "fase" inventada, nunca conclui nada com pouca evidência. Entra dentro do MESMO objeto `athleteStateContext.menstrualCycle` que já chega ao prompt (não um campo solto novo) — decisão de engenharia: por causa do risco de dependência circular entre os módulos `training-intelligence` e `menstrual-cycle` (um já importa o outro pra matemática), o campo é anexado em `training-plans.service.ts` no momento de montar o contexto, não calculado dentro do `AthleteStateSnapshotService` propriamente — mesmo resultado prático, wiring ligeiramente diferente do "textbook". Regra dura nova no prompt: nunca "está menstruando → reduzir treino".
- **Notificações recorrentes com resposta rápida (itens 9/10)**: as duas condições ("provavelmente terminou" / "atraso na prevista") viraram uma função única — `MenstrualCycleService.getPendingCheck()` — reaproveitada tanto pelo cron diário (que dispara o push, dedup permanente por ciclo) quanto por um endpoint novo (`GET /menstrual-cycle/pending-check`) que o app consulta ao abrir a tela de Ciclo, mostrando um banner com Sim/Ainda não/Atualizar calendário mesmo sem a aluna ter visto o push. Auto-resolvente por construção: assim que ela confirma, a condição desaparece sozinha, sem estado extra de "já respondida" guardado em lugar nenhum.
- **Distinção visual observado/estimado/incerto (item 1)**: calendário do app já distinguia observado de estimado; faltava a 3ª categoria. Adicionado `predicted_uncertain` (mesma janela prevista, mas com maturity moderada = poucos ciclos) com aparência visual diferente (contorno tracejado em vez de preenchido) + aviso textual explícito.
- **Duração de ciclo/menstruação como variáveis navegáveis (item 5)**: `cycle.cycleLengthDays`/`cycle.periodLengthDays` entraram no Variable Registry, lidas de `MenstrualCycleLog` por um novo método em `ObservationReaderService` (uma observação por INTERVALO entre ciclos sucessivos, nunca o último ciclo isolado — mesma regra já usada em `getCycleOverview`, sem segunda matemática). Como o Explorer do Admin já lista qualquer variável do domínio automaticamente (`listVariableIds()`, sem lista hardcoded), essas duas variáveis passaram a ter tendência/baseline/faixa habitual/excursão completos SEM nenhuma tela nova no Admin.
- **Ciclo como camada temporal nos gráficos (item 6)**: novo layer `menstrualCycle` no `LayerToggleBar` já existente do Explorer — faixas de fundo (`ReferenceArea`) sobre QUALQUER gráfico de variável, sólidas pra período observado, tracejadas/claras pra janela estimada. Reaproveita o mesmo mecanismo já usado pra faixa habitual/excursões/eventos de contexto, só um layer a mais. Cobertura desta rodada: gráfico principal do Explorer (`VariableChart`, usado em "Aprofundar" e na visão de domínio) — NÃO cobre ainda o gráfico de "Comparar Modalidades" nem os widgets antigos fora do Explorer (RPE por calendário, ACWR) — ficou registrado como pendência.
- **Achado durante a sessão (falso alarme, sem bug de produto)**: parte da validação do "Comparar Modalidades" (fase anterior) tinha sido erroneamente marcada como bug — na verdade era a própria ferramenta de teste automatizado (`form_input` em checkbox) não disparando o evento React; com clique real funcionou 100%. Registrado como aprendizado de metodologia de teste, não do produto.
- **Validação**: 18 testes novos de `getAgentContext`/`getPendingCheck` (cenários irregular/estabelecido/hormonal/sem-evidência), 5 de medicamentos, 3 de `cycle.cycleLengthDays`/`cycle.periodLengthDays` — todos com fixtures/mocks, nenhum dado fabricado em conta real (Lucelane/Juliana não foram tocadas). Overlay visual nos gráficos do Admin (item 6) e as novas variáveis (item 5) NÃO foram verificados ao vivo no navegador nesta sessão — token de treinador expirou no meio da sessão e não havia credencial nova disponível; typecheck limpo e revisão de código confirmam a implementação, mas falta checagem visual real.
- **Pendências explícitas remanescentes**: item 2 (aprendizado com irregularidade) já estava coberto pela matemática existente (faixa habitual escala com a variabilidade real), sem trabalho novo necessário — confirmado, não implementado do zero. Item 3 (perfil complementar) ganhou UI de progressive disclosure no app (regularidade/contraceptivo/DIU/fase de vida), reaproveitando o DTO que já existia. Overlay do ciclo ainda falta no gráfico "Comparar Modalidades" e nos widgets fora do Explorer. Validação visual do Admin (itens 5/6) pendente por falta de sessão de treinador válida durante a implementação.
- **Arquivos-chave**: `apps/api/src/context-events/*` (medicamentos), `apps/api/src/menstrual-cycle/menstrual-cycle.service.ts` (`getAgentContext`/`getPendingCheck`), `apps/api/src/training-plans/{training-plans.service,training-methodology,prescription-agent.service}.ts`, `apps/api/src/training-intelligence/{compact-agent-context,variable-registry,observation-reader.service}.ts`, `apps/api/src/messaging/notification-triggers.service.ts`, `apps/admin/app/page.tsx` (layer `menstrualCycle`), `apps/mobile/App.tsx` (banner de confirmação, seções de perfil/medicamentos, calendário com 3 estados).
- **Gates**: typecheck limpo (api/admin/mobile) a cada rodada; suíte 328/328 (as mesmas 3 suítes pré-existentes não relacionadas continuam quebradas, intocadas).
- **Commits no espelho**: `05256d8` (medicamentos + ciclo real no agente + distinção visual), `c36bbd8` (notificações recorrentes com resposta rápida), `e11845c` (duração de ciclo como variável navegável + camada temporal nos gráficos).

**2026-09-27 — Auditoria e evolução longitudinal de Volume, Aderência e ACWR**

Elton pediu explicitamente auditar ANTES de implementar (seção 1 do pedido). Achados reais da auditoria:
- **3 sistemas paralelos** calculavam volume/aderência: `EvolutionMetricService` (bem desenhado, usado pelo app do aluno), `summarizeSessions()` em `coach.service.ts` (usado pelo Admin), e **ACWR 100% no frontend** (`apps/admin/app/page.tsx`), com janela por ÍNDICE DE ARRAY (não calendário) e zonas de cor "seguro/risco" hardcoded.
- **Bug real confirmado**: `summarizeSessions()` retornava `adherencePercent: 0` (nunca `null`) quando ainda não havia nenhum feedback registrado — exatamente o "sem dado virando 0%" que a arquitetura existe pra evitar. `EvolutionMetricService` já fazia certo. **Corrigido isoladamente primeiro** (commit `b1d39b1`), com teste de regressão, antes do resto do trabalho.
- Extras eram computados no FRONTEND (`h.sessions.filter(isExtraSession)`), não no backend — segunda matemática.

**Decisões de arquitetura (reaproveitamento, zero matemática nova):**
- `EvolutionMetricService` ganhou `getSeriesByModality(userId, modality)` e `getDistinctModalities(userId)` — mesma agregação/classificação de sempre, só filtrada. Nenhuma fórmula duplicada.
- 8 variáveis novas no Variable Registry, domínio `training_load` (novo): `volumePrescribedKm`, `volumeCompletedTotalKm` (total realizado, já com extras), `volumeCompletedPrescribedOnlyKm` (só prescrito, sem extras), `volumeExtraKm`, `volumeDiffAbsoluteKm`, `volumeRatioCompletedPrescribed` (nunca 0%/100% quando não há prescrição — simplesmente não gera observação), `adherencePercent` (numerador/denominador/coverage reais no context de cada ponto, não só a %), e `acwr`.
- **ACWR recalculado do zero no backend**: média móvel de 28 dias (aguda) ÷ 42 dias (crônica) sobre `volumeCompletedTotalKm`, usando `MathLayerService.movingAverage` com janela `calendar_days` — a MESMA função de qualquer outra variável, corrigindo o bug real de janela-por-índice do gráfico antigo.
- Modalidade descoberta DINAMICAMENTE (`getDistinctModalities`), nunca lista fixa — evita o problema real já visto antes (`forca` vs `musculacao` coexistindo como valores diferentes).
- Por já existirem no Variable Registry, as 8 variáveis passaram a ter MM21/60/60/200 (calendar_days, nunca "21 observações" — a granularidade semanal continua correta pela própria definição já existente do MathLayer), baseline, tendência, faixa habitual, excursões e comparação por modalidade **automaticamente**, sem nenhuma tela nova no Admin (`listVariableIds()` já lista qualquer domínio sozinho).
- **item 27 (semana parcial)**: `context.isPartialWeek` marca quando `weekStart` cai na semana corrente — presente em toda observação de `training_load`.
- **Linguagem normativa removida** (itens 12-17): "Meta ideal: acima de 80%" e as zonas de cor "seguro/risco 0.8-1.3/>1.5" do ACWR, incluindo a codificação de cor por variação % ("≤+10% seguro") do gráfico de Volume Semanal — tudo substituído por texto descritivo.
- **Gap fechado no agente (item 22)**: achado real — `CompactAgentContext.training` despejava `recentWeeks` (até 12 semanas brutas) e `modalityBreakdown` inteiros pro agente, sem nenhuma matemática longitudinal aplicada. Substituído por resumo leve (`dataAvailableSince`/`totalWeeksWithPlan`/`adherence`/`consistency`) + novo domínio `trainingLoad` (as 8 variáveis acima, com trend/baseline/faixa habitual reais). Prompt do agente ganhou regra dura explícita: ACWR é relação descritiva, nunca diagnóstico de segurança/risco; proibido criar "aderência<X%→reduzir" ou "ACWR>X→reduzir carga".
- **Arquivos-chave**: `apps/api/src/coach/coach.service.ts` (`summarizeSessions` exportado + fix), `apps/api/src/evolution/evolution-metric.service.ts` (`getSeriesByModality`/`getDistinctModalities`), `apps/api/src/training-intelligence/{variable-registry,observation-reader.service,athlete-state-snapshot.service,compact-agent-context}.ts`, `apps/api/src/training-plans/prescription-agent.service.ts`, `apps/admin/app/page.tsx` (domínio `training_load` no Explorer, ACWR/Volume sem linguagem normativa).
- **Gates**: typecheck limpo (api+admin) a cada rodada; suíte 348/348 (36 testes novos: fix de aderência, leitor de volume/aderência/ACWR, filtro por modalidade em EvolutionMetricService, integração no Snapshot/CompactContext) — mesmas 3 suítes pré-existentes não relacionadas continuam quebradas, intocadas.
- **Validação AO VIVO com aluno real (itens 29/30) — feita depois, mesma sessão**: Elton logou de novo e pediu pra tentar. Validado com Lucelane (id `ab465137-e15a-404b-acb4-5e5930579efb`) por dois caminhos: (1) chamadas diretas à API de produção confirmando matematicamente `ACWR = acuteValue/chronicValue` (`0.957070707070707 = 28.424999999999997/29.7`, bate exato) e `volumeCompletedTotalKm - volumeExtraKm = volumeCompletedPrescribedOnlyKm` em 5 semanas seguidas; (2) visual no Admin real (porta local 3018, mesmo token): domínio "Volume, aderência e carga" aparece sozinho no Explorer com os 8 gráficos reais (Bruto/MM21), ACWR sem nenhuma zona verde/vermelha, aderência com "não existe meta universal", e a tabela de observações originais do ACWR mostrando a composição completa (isPartialWeek/acuteValue/chronicValue/janelas) ponto a ponto — rastreabilidade real confirmada, não só nos testes. **Achado real no processo** (não é bug, é informação): o ACWR atual da Lucelane está abaixo da própria faixa habitual dela havia 9 dias (excursão em curso, direção "below") — só registrado aqui como prova de que a matemática está viva e reagindo a dados reais, nenhuma ação tomada.
- **Fechamento definitivo (mesmo dia, 27/09)** — Elton aprovou a validação e pediu só dois últimos itens antes de encerrar:
  - **Semana em andamento visível no gráfico**: `ReferenceLine` tracejada + rótulo "Semana em andamento" (sempre visível, não é camada opcional) adicionada em `VariableChart` (Aprofundar/DomainOverview) e `CompareModalitiesChart` (Comparar Modalidades) — confirmado ao vivo com dado real da Lucelane (linha tracejada laranja aparecendo corretamente no fim da série).
  - **Teste de Comparar Modalidades + Sistema com as 8 variáveis novas — achou e corrigiu um bug real**: ao testar `aderência semanal` com Global+Corrida+Musculação+Fortalecimento simultâneas, `n` do Global apareceu como 28 em vez de ~9 — a série Global estava sendo montada por `training-intelligence-query.service.ts` como "tudo sem filtro", o que nessa variável (diferente de RPE etc.) misturava a entrada Global de verdade com as 3 entradas por modalidade no MESMO pool, inflando `n` e podendo pegar o valor de uma modalidade errada como "atual" do Global. **Corrigido na raiz**: as entradas Global de `training_load` agora carregam `context.modality==='global'` (modalidade reservada); `training-intelligence-query.service.ts` ganhou uma regra pequena e genérica — quando essa tag existe e não há filtro explícito, usa só ela (nunca a mistura) — variáveis que nunca usam essa tag (RPE, sono etc.) continuam com o comportamento antigo, comprovado por teste dedicado. 4 testes novos provam os dois comportamentos lado a lado.
  - **Checklist do item 2 validado ao vivo com a Lucelane** (aderência semanal, Global/Corrida/Musculação/Fortalecimento): seleção simultânea das 4 séries ✓; cálculo independente por modalidade com numerador/denominador/coverage reais por ponto ✓; Musculação (n=1) nunca fabrica faixa, mostra "—" ✓; Bruto/MM21/MM60/MM200/Baseline funcionam — MM60=MM200 idênticos aqui, confirmado matematicamente correto (histórico da aluna tem só ~56 dias, então as duas janelas cobrem o mesmo conjunto de pontos, não é bug) ✓; rastreabilidade até a observação original com contexto completo ✓; Sistema (`OverlayChart`, código não tocado) já usa eixo Y duplo por variável, sem normalizar ou somar unidades incompatíveis ✓ (confirmado por leitura de código, não recriado).
  - **Nota**: a correção do bug do Global só aparece nos dados reais depois do deploy — a validação ao vivo mostrou o bug (n=28) porque a API em produção ainda não tinha o fix; a correção está comprovada por 4 testes unitários dedicados + suíte completa (352/352).
- **Gates finais**: typecheck limpo (api+admin); suíte 352/352 (36 API + o fix do Global). **Volume + Aderência + ACWR está encerrado** — nenhuma ampliação de escopo, nenhuma arquitetura nova iniciada, conforme pedido.
- **Commits no espelho desta rodada final**: `a5f6aaf` (fix do bug Global + indicador de semana em andamento).
- **Commits no espelho**: `b1d39b1` (fix isolado do bug de 0%), `5e65e76` (sync do bat), `42ad242` (remoção de linguagem normativa), `aec594d` (infraestrutura Variable Registry/ObservationReader), `3fd1272` (integração no agente).

**2026-09-27 — Bug crítico real: sessão de domingo contaminando o programa da semana seguinte (caso Roberta Kemp)**

Elton reportou (com prova real: Admin mostrando domingo 27/09 dentro do programa "28/09") e pediu auditoria completa da semântica de semana/rotina antes de qualquer outra tarefa, usando Roberta como caso principal — depois generalizado.

- **CAUSA RAIZ (uma única, confirmada por reprodução direta na API real)**: em `TrainingPlansService.generateWeek()`, a migração que "carrega pro plano novo as sessões de hoje/já passadas com execução real" (existe pra proteger o que o aluno já fez) assumia implicitamente que "hoje" está sempre DENTRO da semana sendo gerada. Isso é falso exatamente no rollover de antecipação de domingo (`shouldRollToNextWeek=true`, `weekStart` já é a segunda da semana SEGUINTE, mas `today` continua sendo o próprio domingo da semana que está terminando). A cláusula `{ scheduledDate: today, completion: { isNot: null } }` (ramo `allowToday`) não tinha limite inferior nenhum — bastava a sessão de "hoje" ter execução registrada pra ser reparentada (`planId` reatribuído) pro plano novo, mesmo quando "hoje" pertencia à semana anterior.
- **Reprodução real confirmada via API de produção (read-only)**: Roberta tinha domingo 27/09 (corrida, 13.09km, já executada) com `planId` apontando pro plano 28/09–04/10 — dois registros `weekday=0` no mesmo plano (27/09 errado + 04/10 correto), contaminando `prescribedSessions/completedKm/adherencePercent` desse plano.
- **Sistêmico, não isolado**: mesma auditoria em todos os 40 alunos encontrou o MESMO padrão exato em mais 2 alunas — **Fernanda Zimerer** e **Silvia Mendes Leal** — todas com domingo 27/09 (corrida, já executada) dentro do plano 28/09-04/10. Confirma que o bug afeta qualquer aluno que: (a) tinha plano ativo, (b) treinou no domingo antes das 12h, (c) teve a geração de antecipação disparada depois das 12h do mesmo domingo.
- **O dado de 195 minutos NÃO é bug de código**: rastreado até a origem — a própria Roberta selecionou a faixa "de 150 a 240 minutos" (`monday_fortalecimento_time: "from_150_to_240"`) na entrevista; `195` é o ponto médio dessa faixa, calculado e persistido corretamente. É um dado real, atipicamente alto (comparado às outras faixas dela, todas ≤45min), que merece confirmação humana com a aluna — não uma correção de código, e não presumido como "deveria ser 45".
- **Correção (mínima, centralizada, sem patch local)**: extraídas 4 funções puras e exportadas de `training-plans.service.ts` — `computeShouldRollToNextWeek()` (regra única do rollover, reaproveitada em vez de recalculada), `shouldMigrateTodaySessionsToNewPlan()` (o guard que fecha o bug: `hasActivePlan && !shouldRollToNextWeek` — durante o rollover, NADA de "hoje" migra, porque "hoje" não pertence à semana nova), `isModalityAllowedOnWeekday()` (item 8: restrição objetiva determinística — modalidade extra da IA num dia em que a rotina vigente não permite aquela modalidade é descartada e logada, a menos que exista diretriz individual ativa). `startOfWeek`/`addDays`/`weekdayOffsetFromMonday`/`anyAvailableDayIsFuture`/`saoPauloWeekdayAndHour` também exportadas — já estavam corretas (segunda→domingo, fuso São Paulo), só precisavam ficar testáveis diretamente.
- **Item 3 (pergunta "incluir treino de hoje?") já estava correto**: o diálogo no app já era explicitamente "só de segunda a sábado, nunca domingo" — confirmado no código, nenhuma mudança necessária.
- **Auditoria mais ampla (item 9) NÃO feita nesta rodada**: dado o tamanho já grande desta correção e o pedido explícito de eficiência (não ampliar escopo), a auditoria completa de "rotina alterada não é respeitada" (itens 6, 9) ficou para uma rodada futura, se Elton pedir — o achado desta rodada foi especificamente o bug de contaminação temporal, com causa raiz única e confirmada.
- **Pendência resolvida em 28/09** (ver entrada abaixo "Correção dos 3 registros contaminados") — Elton autorizou explicitamente, os 3 registros (Roberta, Fernanda, Silvia) foram corrigidos e confirmados.
- **Arquivos alterados**: `apps/api/src/training-plans/training-plans.service.ts` (guard do bug + extração das 4 funções puras + reforço do item 8).
- **Testes de regressão criados**: `apps/api/test/week-rollover-canonical.spec.ts` (21 testes) — cobre semana canônica segunda→domingo (inclusive virada de mês), invariante weekStart≤sessionDate≤weekEnd, liberação de domingo antes/depois das 12h, reprodução direta do cenário real da Roberta (rollover nunca migra sessão de hoje), geração em dia comum, restrição objetiva de modalidade por dia.
- **Resultado dos testes**: 21/21 novos, suíte completa 373/373 (mesmas 3 suítes pré-existentes não relacionadas continuam quebradas, intocadas). Typecheck limpo.
- **Commit no espelho**: `d81bed9`.

**2026-09-28 — Correção dos 3 registros contaminados + fix do webhook Asaas (caso Tiago) + limpeza de testes mortos**

- **Reparo dos 3 registros da Roberta/Fernanda/Silvia**: Elton autorizou explicitamente ("Corrija os três registros contaminados sobre a questão da rotina"). Reconferidos um a um em produção (read-only) antes de codificar: cada aluna tinha a sessão de domingo (27/09, já executada) presa no plano 28/09–04/10, e o plano correto (21/09–27/09) não tinha nenhuma sessão nessa data (sem colisão). Endpoint one-off e temporário (`POST /coach/repair/week-rollover-contamination`, lista fechada e hardcoded com os 3 IDs — nunca um endpoint genérico) criado, chamado uma vez após deploy (`outcome: "fixed"` nos 3), confirmado por reconsulta (0 sessões deslocadas nas 3), e **removido** do código na sequência (reparo pontual nunca fica permanente).
- **Bug real encontrado à parte (caso Tiago Souza Jesus, cortesia→assinante pago)**: `processAsaasWebhook()` atualizava `subscriptionStatus` corretamente mas nunca limpava `subscriptionManualOverride` — um aluno de cortesia que virasse pagante de verdade ficava travado pra sempre fora do sync automático diário com o Asaas. Corrigido (mesmo padrão já usado em `refreshFromAsaas()`). Também identificado (não é bug, é dado real): o e-mail do Tiago segue na tabela `FreeTesterEmail` — enquanto lá, qualquer tentativa de checkout cai no fluxo de testador gratuito sem cobrar nada; remoção da lista é ação manual do Elton no Admin (tentativa de eu remover via API foi corretamente bloqueada pela proteção de exclusão irreversível da sessão).
- **3 suítes de teste pré-existentes quebradas encontradas incidentalmente** (rodando a suíte completa, sem relação com as mudanças do dia): `auth.service.spec.ts` (faltava o 4º argumento do construtor, `MetaCapiService`, adicionado em sessão anterior) — corrigido; `training-methodology.spec.ts` e `exercise-libraries.spec.ts` testavam funções (`buildWeeklyMethodologyDecision`, `isApprovedGymExercise`, `selectGymExercises`, `selectRunnerStrengthExercises`) que **não existem mais no código** — resíduo da lógica determinística de prescrição removida há tempos (regra permanente: só a IA decide). Eram testes mortos sem substituto necessário — apagados.
- **Commits no espelho**: `Libera trava manual apos pagamento real e prepara reparo de sessoes de rollover`, `Remove endpoint de reparo ja usado e testes de codigo de prescricao removido`.

**2026-09-28 — Bug real: gráficos de RPE/satisfação mostrando o dia errado (dois bugs distintos na mesma queixa)**

Elton reportou com evidência concreta: treino do dia 28 aparecendo como 27 no gráfico do Explorer, mesmo tendo treinado e registrado o feedback no mesmo dia.

- **1º bug (real, mas não era a causa do sintoma relatado)**: `ObservationReaderService.readWorkoutVariable()` usava `completion.completedAt` (o instante em que o feedback foi enviado) como `timestamp` da observação, em vez do dia do treino — inconsistente com TODAS as outras fontes do mesmo arquivo (check-in semanal, ciclo menstrual, volume/carga), que sempre ancoram no dia de calendário a que o dado se refere. Um aluno que treina num dia e só registra o feedback depois (ou virando a noite) faria o ponto aparecer no dia errado. Corrigido: `timestamp` passou a ser `session.scheduledDate`. Teste de regressão dedicado.
- **2º bug (causa raiz real do sintoma relatado)**: no Admin (`apps/admin/app/page.tsx`), a função `fmtDay()` fazia `new Date(iso).toLocaleDateString('pt-BR', ...)`. Uma data-só (ou timestamp meia-noite UTC, que é exatamente o formato de `scheduledDate`/`weekStartDate`) é interpretada pelo JS como meia-noite UTC; `toLocaleDateString` reformata no fuso do NAVEGADOR (America/Sao_Paulo, UTC-3) — meia-noite UTC vira 21h do dia ANTERIOR, exibindo sempre um dia a menos. Esse bug afetava TODOS os pontos de TODOS os gráficos do Explorer igualmente, independente da fonte (por isso o 1º fix sozinho não resolveu o sintoma). Corrigido usando `getUTCDate()/getUTCMonth()` (mesmo padrão já usado em `dateLabel()` no mesmo arquivo e em `isoDateToInputValue()` no app mobile) em 6 pontos: `fmtDay`, comparação de variáveis (`VariableSnapshotPanel`), período observado (evidência), excursões, eventos de contexto.
- **Lição registrada**: dois bugs reais coexistindo na mesma queixa — o primeiro fix (backend) era genuinamente correto e necessário, mas não era a causa do sintoma específico relatado; só a investigação completa do pedido de reavaliação (revisitar todas as possibilidades, não parar no primeiro achado) revelou o segundo bug (frontend), que era a causa real.
- **Commit no espelho**: `Corrige exibicao de datas no Explorador (fuso horario deslocava um dia)` (backend: `Corrige data dos graficos de RPE/satisfacao para usar o dia do treino`).

**2026-09-28 — Recuperação de senha 100% dentro do app + botão para remover prospecto**

- **Recuperação de senha**: uma aluna (Carolina Carvalho / "Carol") não conseguiu recuperar o acesso nem com o link manual gerado pelo treinador no Admin. Investigação revelou que o app já tinha um fluxo de "Esqueci minha senha" que chamava a API corretamente e gerava um token real — mas a mensagem de sucesso sempre dizia "Solicite ao treinador um link seguro", sem nunca entregar esse link/token pra aluna (nem por e-mail — ainda sem domínio configurado — nem dentro do app). `POST /auth/forgot-password` passou a devolver o token cru; o app mobile passou a mostrar, na hora, um formulário "Criar nova senha" dentro da própria tela de login, usando esse token direto contra `POST /auth/reset-password` — sem link, sem e-mail, sem depender do treinador.
- **Prospecto com e-mail digitado errado (Carolina Carvalho, investigado à parte)**: linha "Frio" na tela de Prospectos com nome igual mas e-mail diferente (`albadiape` × `aldabiape`, letras trocadas) da aluna real — não era bug, era um cadastro avulso por engano durante a tentativa de acesso. Não existia forma de remover um prospecto da lista — adicionado botão "Remover" (reaproveita `archiveStudent`/`accountStatus='archived'`, reversível, nada apagado).
- **Commit no espelho**: `Recuperacao de senha passa a acontecer inteira dentro do app`, `Adiciona botao para remover prospecto da lista`.

**2026-09-28 — Agente Relator + Linha do Tempo de Relatos**

Pedido explícito de Elton: transformar todo texto livre do aluno em informação estruturada e contextualizada, preservando sempre o relato original, como insumo para um futuro Agente de Prontuário (implementado na mesma sessão, ver entrada seguinte).

- **9 fontes de texto livre conectadas**: feedback de treino (`WorkoutCompletion.notes`, inclusive treino extra), justificativa de não realizar treino (`details.missedComment`), comentário de ajuste na execução (`adjustmentComment`), relato de dor (`PainReport.comment`+`otherLocation`), check-in semanal (`freeTextObservation`), "Relatar observação" (`StudentObservation.content`), questionário de retorno após pausa (`ContextEvent.originalText`), 4 respostas livres reais da entrevista inicial + observação sobre rotina, edição de dados de saúde/reavaliação (`HealthProfile.*`), cancelamento de assinatura (`cancelFeedbackText`). Deliberadamente fora: nome de medicamento (isolamento proposital já existente no código), `ContextEvent` criado pelo treinador (não é texto do aluno), ciclo menstrual (sem campo de texto livre hoje).
- **Tabela nova `StudentReportEntry`**: preserva o texto original pra sempre (nunca alterado); campos de análise (`facts`, `perception`, `themes[]`, `temporality`, `longitudinalNote`, `hypotheses[]`, `relevance`, `analysisError`) ficam nulos até o Relator processar (assíncrono, melhor-esforço, nunca bloqueia o salvamento do dado original). `sourceType` é string livre — fonte nova não pede migration.
- **Agente Relator (`StudentReporterAgentService`)**: nunca prescreve, nunca diagnostica, nunca transforma hipótese/percepção em fato, nunca infere relação fisiológica por coincidência (regra explícita: "pernas pesadas" nunca vira "provavelmente é o ciclo menstrual" mesmo que o sistema saiba que a aluna está perto do período). Consulta até 15 relatos anteriores do mesmo aluno pra contexto longitudinal — nunca o histórico bruto inteiro.
- **Gates**: 12 testes novos dedicados + suíte completa 389/389.
- **Commit no espelho**: `Cria Agente Relator e Linha do Tempo de Relatos do aluno`.

**2026-09-28 — Otimização de agentes: modelos, prompt caching e observabilidade de custo**

- **Modelos**: Treinador/Gerente Técnico/Prontuário continuam em Sonnet 5; **Relator trocado para Haiku 4.5** (`claude-haiku-4-5-20251001`) — mais barato, volume de chamadas potencialmente maior que os outros agentes. Strava intocado, como pedido. Centralizado em `apps/api/src/common/ai-models.config.ts`.
- **Config de geração do Relator**: `thinking: disabled` (nunca `adaptive`), sem `effort` no `output_config` — confirmado via documentação oficial da Anthropic que Haiku 4.5 não suporta esse parâmetro (exclusivo de Sonnet 5+/Opus 5+).
- **Prompt caching**: os 4 agentes ativos já usavam `cache_control` ephemeral (TTL 5min padrão) de sessão anterior — confirmado, não recriado. **Validado com chamadas reais à Anthropic** (endpoint de diagnóstico temporário, removido depois): Sonnet criou cache na 1ª chamada (`cache_creation=3506`) e leu do cache na 2ª (`cache_read=3506`) — confirmado. Haiku não criou cache em nenhuma das duas chamadas (`cache_creation=0`, `cache_read=0`, `input_tokens=2566` real) — confirmado que o prompt do Relator (~2566 tokens reais) fica abaixo do mínimo de 4096 tokens que Haiku exige pra cache funcionar. Não inflado artificialmente pra bater o mínimo, como pedido — limitação documentada.
- **Comparação real Haiku × Sonnet no Relator** (4 casos sintéticos: ambíguo, emocionalmente complexo, recorrente, dor): qualidade equivalente na maioria dos aspectos; diferença real observada — nos casos com sinal de recorrência ("de novo", "voltou depois de sumir"), Haiku classificou `temporality: ATUAL` enquanto Sonnet classificou `RECORRENTE`. Registrado como nuance real, não como falha bloqueante — a troca foi mantida como pedido.
- **Observabilidade**: `logAiUsage()` (novo, compartilhado) loga uma linha `[custo-ia]` por chamada nos 4 agentes com tokens reais de input/output/cache_read/cache_creation — nunca texto do aluno.
- **Commits no espelho**: `Troca Relator para Haiku e adiciona observabilidade de custo de IA`, `Remove endpoint temporario de diagnostico apos validacao real`.

**2026-09-28 — Fecha o circuito Relator → Prontuário → Treinador**

- O Agente de Evolução (`EvolutionAgentService`) passou a exercer também a função de Agente de Prontuário — **nenhum agente novo criado**. A chamada de IA que condensa o prontuário (antes solta dentro de `StudentProfileService`) foi movida pra um novo método `condenseProfile()` na mesma classe do Evolution Agent. Módulo novo e isolado (`evolution-agent.module.ts`, só Config+AiQueue) evita dependência circular entre `StudentProfileModule` e `ReassessmentModule`.
- **Relator → Prontuário**: quando `ReportTimelineService.analyzeEntry()` termina, se a relevância for `ACOMPANHAR`/`LONGITUDINAL`/`MUDANÇA_IMPORTANTE` (nunca `PONTUAL`), grava um evento no prontuário preservando explicitamente `FATO:`/`PERCEPÇÃO (interpretação, nunca fato):`/`PADRÃO OBSERVADO:`/`HIPÓTESES (não confirmadas):` como registros separados — nunca funde interpretação com fato.
- **Prontuário reestruturado em 5 seções obrigatórias**: QUEM É / DE ONDE VEIO / TRAJETÓRIA-JORNADA / ESTADO ATUAL / PARA ONDE ESTÁ INDO — continua sendo um único campo de texto (`StudentProfile.summary`, sem migration de schema), só a estrutura do prompt de condensação mudou. Informação resolvida migra de "estado atual" pra "trajetória" no texto, nunca é apagada.
- **Ordem dos eventos já estava garantida pela arquitetura existente**: `refreshProfile()` já rodava de forma síncrona logo antes de cada geração de treino (`training-plans.service.ts`, não alterado nesta tarefa) — nenhuma represcrição acontece com prontuário desatualizado enquanto há evento pendente.
- **Teste de ponta a ponta com o exemplo literal do pedido** ("Estou ficando desanimada... trabalho muito puxado..."): confirmado texto original preservado, Relator interpretando sem virar fato, prontuário recebendo o evento correto, condensação delegando pro Evolution Agent, e nenhuma regra automática de treino criada a partir do relato. `PONTUAL` confirmado que nunca infla o prontuário.
- **Gates**: 6 testes novos de ponta a ponta + suíte completa 395/395.
- **Commit no espelho**: `Fecha o circuito Relator -> Prontuario -> Treinador`.

**2026-09-29 — Auditoria "Astra" (independente): revisão técnica de 36 achados + correção do bloco prioritário (8 itens)**

- Elton colou uma auditoria de 36 itens feita por outra IA ("Astra") sobre todo o fluxo
  Relator→Prontuário→Treinador + áreas adjacentes (prescrição, billing, ciclo menstrual, funil, fila
  de IA). Pedido: classificar cada item como CONFIRMADO/JÁ RESOLVIDO/INTENCIONAL/PLANEJADO/NÃO
  PROCEDE contra o código real, sem implementar nada ainda. Os 2 itens marcados CRÍTICOS pela Astra
  foram confirmados exatamente: (01) rota `POST /training-plans/week` pulava os gates oficiais; (02)
  arquivar+criar+migrar plano eram 3 escritas soltas no banco, sem trava real de concorrência entre
  processos. Também confirmados 2 bugs próprios não detectados antes: (10) duplicação de
  incorporação narrativa Relator→Prontuário; (20) `compact-agent-context.ts` descartava metadados de
  semana parcial/cobertura que o prompt do Treinador já instruía a IA a considerar.
- Elton autorizou corrigir o "bloco prioritário" — 8 itens, nesta ordem: 02→01→17→10→20→30→14→06.
  Todos corrigidos na mesma sessão:
  - **02 (substituição de plano)**: archive+create+migrate viraram uma única `$transaction`;
    notificações movidas pra depois do commit (regra do projeto: nunca IA/rede em transação); nova
    trava `TrainingPlanGenerationLock` no banco (unique constraint em userId, staleness de 15min)
    substitui o `Map` em memória antigo.
  - **01 (rota alternativa)**: gate de assinatura movido pra dentro de `generateWeekLocked()`,
    compartilhado por todo caminho — corrigida minha própria avaliação anterior (a rota tem 2 usos
    reais no app mobile: fallback de carregamento e recálculo pós-teste de 3km).
  - **17 (workout.painFlag)**: `toNumericValue()` fazia `Number("moderado")=NaN` e descartava todo
    relato de dor silenciosamente; nova `toObservationValue()` preserva categoria como string.
  - **10 (duplicação Relator→Prontuário)**: removido texto livre repetido nos `recordEvent()`
    diretos de observations/pain-reports/workout-completions — mantidos só os campos estruturados,
    texto livre com incorporação única via Relator.
  - **20 (metadados de carga)**: `currentWeekContext`/`currentWeek` (isPartialWeek/numerator/
    denominator/coveragePercent) propagados da Observation mais recente até o Compact Agent Context.
  - **30 (RevenueCat + cortesia)**: guarda de precedência bloqueava também compras reais
    (INITIAL_PURCHASE/RENEWAL) de aluna manual_active/grace — agora distingue por tipo de evento.
  - **14 (campos livres)**: `reassessment_notes`/`pain_other_location` (reavaliação) e
    `pain_other_location` (entrevista inicial) adicionados à Linha do Tempo — miss real de 28/09.
  - **06 (geração de domingo)**: query de `previousPlans` usava a semana do relógio em vez da
    semana-alvo, excluindo do histórico a semana que acabou de terminar quando gerada no domingo.
- 8 arquivos de teste novos/estendidos, suíte completa 437/437.
- **Commit no espelho**: `Corrige bloco prioritario da auditoria: substituicao atomica de plano,
  gate de assinatura, dor categorica, deduplicacao Relator-Prontuario, metadados de carga,
  RevenueCat e campos livres de reavaliacao`.
- Demais 28 itens da auditoria ficam para decisão de próximo bloco — nenhuma nova auditoria geral
  foi feita nesta etapa, por instrução explícita.

**2026-09-30 — Bug real: mensagem genérica no formulário de feedback de treino (caso Juliana Oliveira)**

- Aluna relatou (via WhatsApp, repassado por Elton) que o botão "Confirmar treino e enviar
  feedback" parecia travar toda vez que ela preenchia algo diferente (dor, treino trocado).
  Investigação: não existe nenhum código que bloqueie o botão especificamente por dor ou exercício
  extra — o formulário exige 16 perguntas de escala preenchidas (sono, estado antes do treino,
  resposta ao treino, + timing da dor quando há dor), e a mensagem de erro era sempre genérica
  ("Complete todas as perguntas acima"), sem dizer qual estava faltando.
- Hipótese mais provável (não uma causa determinística confirmada): num treino comum a aluna toca
  rápido nas mesmas opções nas 16 perguntas por hábito; quando o treino tem algo diferente ela para
  pra rolar a tela e escrever texto livre, ficando mais fácil pular sem perceber uma pergunta de
  escala em outro ponto do formulário.
- Correção: a mensagem agora lista exatamente o que falta (ex: "Falta responder: cansaço mental
  causado pelo treino, mudança no estado mental."), em vez do texto genérico — resolve a queixa
  relatada independente de qual pergunta específica estava sendo pulada.
- **Commit no espelho**: `Mostra qual pergunta falta responder no feedback de treino, em vez de
  mensagem generica`.

**2026-09-30 — Especificação registrada: Sistema de Medalhas do Panzeri Run**

- Elton enviou a especificação funcional completa do futuro Sistema de Medalhas/Conquistas (13
  famílias: constância, aderência, treinos concluídos, volume semanal/mensal/sustentado, distância
  única, acumulado, feedbacks, check-ins, reavaliações, provas, retomada — mais graus de
  raridade, "próximas conquistas" e inteligência gerencial). Pedido explícito: só registrar e
  checar contra o modelo de dados atual — **nada implementado, nenhuma tabela/migration criada**.
- Documento completo em [SISTEMA_DE_MEDALHAS.md](SISTEMA_DE_MEDALHAS.md) (repo-root).
- Checagem contra o código real (não só suposição): aderência/cobertura semanal, volume semanal e
  mensal, maior distância em corrida única, limiar de 14 dias de lacuna, contagem de reavaliações e
  de check-ins não pulados já existem de forma canônica e são diretamente reaproveitáveis.
- **Achado importante, fora do escopo do sistema de medalhas mas bloqueador pra família 2
  (Aderência)**: `EvolutionMetricService` hoje **inclui** sessões extras no denominador de
  aderência/cobertura (`bucket.prescritas++` roda pra toda sessão, extra ou não) — isso contradiz a
  regra já documentada em `GLOSSARIO_METRICAS.md` ("Extra não entra em prescrito/elegível/
  aderência"). Divergência doc↔código pré-existente, precisa de decisão antes de implementar
  "semana perfeita"/aderência ≥90%.
- Existem tabelas `Achievement`/`UserAchievement` no schema, criadas em algum momento anterior mas
  **nunca usadas por nenhum código** — formato genérico (`id/code/name/description/criteria Json`)
  insuficiente pra tudo que a especificação exige (grau, valor, período, modalidade, evidência,
  versão da regra), mas serve de ponto de partida em vez de criar do zero. `Challenge`/
  `ChallengeProgress` (também dormentes) parecem modelar outra ideia (desafios semanais), não
  medalhas permanentes.
- Mapeamento completo `medalha → fonte canônica → calculável hoje / dependência / dúvida`
  devolvido a Elton para validação antes de qualquer implementação.

**Continuação no mesmo dia (2026-09-30) — regra canônica de execução real + desenho técnico**

- Elton validou o levantamento e acrescentou uma regra central antes do desenho: medalhas de
  **realização** (constância, treinos, volume, distância, acumulado) sempre usam o **executado**,
  nunca o prescrito — prescrito 20km/executado 10km conta 10km; executado acima do prescrito conta
  o valor real, sem virar recomendação de aumentar carga. Medalhas de **aderência** continuam
  comparando realizado com prescrito pela fórmula canônica (extra não entra). Medalhas de
  **participação/processo** (feedback/check-in/reavaliação) contam pela ação efetivamente
  concluída, nunca pela disponibilidade dela.
- Documento atualizado com essa regra central + anotação explícita em cada seção afetada, e com um
  **desenho técnico completo** (ainda não implementado): schema estendendo as tabelas dormentes
  `Achievement`/`UserAchievement` (campos novos: categoria, grau, versão da regra, valor observado,
  período, modalidade, evidência), arquitetura de `MedalEvaluationService` (nunca recalcula
  matemática, só lê fontes canônicas já existentes), pontos de disparo reaproveitando crons/eventos
  já existentes (sem cron novo e solto), e ordem recomendada de implementação — começando pela
  correção da divergência de aderência (extras no denominador) como pré-requisito.
- Prova (família 12) documentada mas com avaliação automática **desligada** por enquanto —
  `TargetRace.status='concluida'` é autodeclarado sem verificação cruzada contra treino real.
- Ver [SISTEMA_DE_MEDALHAS.md](SISTEMA_DE_MEDALHAS.md) para o documento completo e atualizado.

**Continuação no mesmo dia (2026-09-30) — Sistema de Medalhas: backend implementado (sem UI)**

Elton aprovou o desenho técnico e autorizou a implementação completa do backend, em 8 etapas:

1. **Correção da divergência de aderência** — `EvolutionMetricService` agora exclui sessão extra
   de `prescritas`/`feitas`/`naoFeitas` (aderência/cobertura/modalidade/mensal), mantendo extra
   somado só em `kmTotal`/`kmExtrasTotal` (volume realizado). Antes, um aluno com 3/4 prescritas
   (75%) + 1 extra aparecia com 80% — bug real confirmado com teste específico do cenário
   prescrito+concluído+não-realizado+extra.
2. **Schema**: `Achievement`/`UserAchievement` (existiam no banco desde antes, nunca usadas por
   nenhum código) estendidas com categoria, grau, threshold, unit, ruleVersion, criteria, sortOrder
   — e `UserAchievement` com value/periodStart/periodEnd/modality/evidence/ruleVersionAtUnlock.
   Nenhuma tabela nova de catálogo.
3. **Catálogo** (`apps/api/src/medals/medal-catalog.ts`): 124 medalhas determinísticas cobrindo as
   13 famílias aprovadas (provas com `active:false`, avaliação desligada de propósito).
   `MedalCatalogSyncService` sincroniza (upsert por `code`) toda vez que a API sobe — nunca escrevo
   direto em produção, é o próprio boot que faz isso, igual qualquer outro provider do Nest.
4. **`MedalEvaluationService`**: nunca recalcula matemática existente — lê `EvolutionMetricService`
   (volume/aderência) + queries mínimas novas (distância por sessão, acumulado, streak de
   constância/retomada). REGRA CENTRAL preservada em cada família: realização usa executado (nunca
   o prescrito, mesmo quando o aluno executa mais ou menos que o planejado), aderência compara
   executado×prescrito pela fórmula canônica, participação conta a ação em si. Gatilhos reaproveitam
   pontos que já existem (upsert de treino, submit de check-in, conclusão de reavaliação) — sem
   cron novo; categorias de fechamento semanal (constância/aderência/volume/sustentação) são
   avaliadas tanto no registro de um treino quanto na leitura do `GET /me/medals` (não existe mais
   nenhum cron semanal rodando pra todos os alunos desde 06/08, então esses são os pontos naturais
   mais frequentes pra pegar uma semana recém-fechada).
5. **API** (`GET /me/medals`, `/unlocked`, `/progress`): conquistas + progresso pras próximas,
   com filtro de segurança (item 15/seção 16) — medalha muito acima da prescrição atual do aluno
   existe no catálogo mas não é sugerida como "próximo objetivo" (margem de 1,5x a prescrição atual;
   sem prescrição ativa pra comparar, nunca filtra).
6. **Aderência + semana perfeita**: ativadas no gatilho de fechamento semanal, reaproveitando a
   mesma função de streak de constância/sustentação.
7. **Provas**: confirmado desligado (`active:false` no catálogo) — `TargetRace.status='concluida'`
   é autodeclarado, sem verificação cruzada.
8. **Base pra inteligência gerencial**: índice `@@index([achievementId])` em `UserAchievement`
   (consultas futuras tipo "quantos alunos já conquistaram a medalha X") — sem endpoint/agregação
   ainda, só a base.

Testes específicos em cada etapa (funções puras de streak/calendário isoladas e testadas sem mockar
Prisma, motor de avaliação com Prisma mockado, catálogo com testes de integridade estrutural) +
suíte completa: **508/508 verdes** (50 suítes, 7 arquivos de teste novos pro sistema de medalhas +
1 pra correção de aderência).

**Commit no espelho**: `Implementa backend do Sistema de Medalhas: catalogo, motor de avaliacao,
persistencia e API de consulta`.

**Pendência explícita**: nenhuma UI — a experiência visual das medalhas entra junto da reformulação
maior da Home do aluno, ainda não iniciada.

**2026-09-30 — Nova Home do aluno (ordem fechada, reconstrução completa da tela inicial)**

Elton mandou uma especificação fechada e muito detalhada pra reconstruir a Home do app mobile
(App.tsx), pra deixar de ser "onde vejo meu treino" e virar uma tela vertical com 8 seções (Hoje,
Sua semana, Seu progresso, Como você está, Seu acompanhamento, Conquistas, Sua trajetória, Seu
próximo passo), consumindo 100% de fontes canônicas já existentes — nenhum cálculo de
treino/aderência/medalha refeito no frontend.

- **Backend**: só 1 endpoint novo, `GET /me/observations/:variableId` (`me.controller.ts`) —
  reaproveita exatamente a mesma `TrainingIntelligenceQueryService.getVariableSnapshot()` já usada
  pelo painel do treinador, agora também exposta ao próprio dono do dado (sono/fadiga/motivação/RPE
  nunca tinham chegado ao aluno antes, só o treinador via). Nenhuma migration, nenhum cálculo novo.
- **Frontend novo** (`apps/mobile/home/`): `homeTheme.ts` (paleta clara própria desta intervenção,
  hex exatos definidos por Elton — distinta da paleta de marca em `theme/tokens.ts`), `homeLogic.ts`
  (funções puras: sessão de hoje, células da semana, timeline de trajetória — sem nenhum cálculo de
  negócio, só seleção/formatação do que a API manda), `HomeScreen.tsx` (as 8 seções, gráfico
  barra+linha em SVG puro reaproveitando o padrão já usado em `KmLineChart`), `MedalsScreen.tsx`
  (única tela secundária nova autorizada, "Todas as conquistas"), `BottomNav.tsx` (o app NUNCA teve
  bottom nav até agora — navegação era só o menu hambúrguer; agora tem os 5 destinos primários
  Início/Treinos/Evolução/Conquistas/Perfil, sem apagar o menu antigo pros itens que não cabem).
- **Wiring em App.tsx**: `Tab` ganhou `'home'` (novo tab padrão, substituindo `'week'`) e `'medals'`;
  bottom nav fixo abaixo do ScrollView, escondido durante fluxos guiados (entrevista/teste/
  reavaliação/setup de rotina).
- **Validação visual real**: harness temporário (`?mock=1` na URL, mockando `fetch` com dados
  fixos, nunca login nem rede real) usado pra ver a Home logada de verdade — removido por completo
  antes de finalizar. Testado em 375×812, 390×844, 430×932 e tablet 768×1024, cenário com dados
  reais e cenário "aluno novo" (sem plano/evolução/medalhas) — nenhum gráfico vazio gigante, estados
  vazios com texto real, nenhum crash.
- **Achado real corrigido durante a validação**: singular/plural na dica de progresso da medalha
  ("Falta 1 km" vs "Faltam 3,6 km").
- **Gate não satisfeito, registrado honestamente**: `apps/mobile` não tem NENHUMA infraestrutura de
  teste automatizado (nem jest, nem RN Testing Library — `"test": "echo pending"` no
  `package.json`). As funções puras de `homeLogic.ts` foram verificadas por leitura cuidadosa +
  validação visual (os estados que elas produzem são visíveis na tela renderizada), mas não têm
  teste automatizado real. Montar essa infraestrutura do zero ficou fora do escopo desta
  intervenção — registrado como pendência real, não escondido.
- Typecheck limpo (mobile + api), lint limpo nos arquivos novos/alterados (erros restantes no
  `App.tsx` são todos pré-existentes, não relacionados a esta mudança).

**2026-10-01** — Camada de ingestão de exercícios Polar AccessLink (dado bruto → canônico),
continuação do OAuth Polar que tinha sido implementado no commit anterior (30/09, "Apenas
credencial de conexão. Dados do dispositivo não são importados nesta etapa") sem passar por aqui:
- **Decisão arquitetural**: em vez de clonar o padrão `StravaActivity` (tabela 100% dedicada a um
  provedor) para o Polar, foi criada uma camada canônica nova e agnóstica de provedor:
  `RawExternalActivity` (payload bruto preservado por inteiro, dedupe por `provider+userId+
  externalId`) → `ActivityLog` (atividade física observada, sem nenhum campo nomeado `polar*`,
  pensada para no futuro receber também `Strava → RawExternalActivity → ActivityLog` sem mudar de
  significado). `StravaActivity`/`WorkoutCompletion`/`TrainingSession` não foram tocados nesta
  tarefa — migração do Strava para a camada nova fica para depois, fora de escopo.
  Motivo: evitar acumular `PolarActivity`, `GarminActivity`, `CorosActivity` etc. e só depois
  construir a fronteira canônica em cima de N estruturas diferentes — a fronteira nasceu agora,
  no primeiro momento em que um segundo provedor de atividade se tornou real.
  `pace` deliberadamente NÃO é persistido (sempre derivável de distância/duração — evita
  divergência entre valor observado e calculado); `training-load` da Polar (métrica já
  interpretada pelo algoritmo deles) também não virou campo canônico, só fica preservado no raw.
- **Registro AccessLink**: achado que faltava no OAuth original — a Polar exige um
  `POST /v3/users` explícito depois do OAuth, antes de aceitar qualquer leitura de exercício
  (OAuth concluído ≠ usuário registrado no AccessLink). `PolarConnection.registeredAt` marca isso;
  409 (já registrado) é tratado como sucesso idempotente.
- **Sincronização por transaction, não por data**: diferente do Strava (polling `after=timestamp`),
  a AccessLink usa um modelo de transação (abrir → listar exercícios pendentes → buscar cada um →
  só então confirmar/commit). Só se comita depois que TODOS os exercícios da transação foram
  persistidos localmente com sucesso; falha parcial deixa a transação aberta
  (`PolarConnection.openTransactionId`) e o próximo sync retoma a MESMA transação em vez de abrir
  outra (a Polar recusa uma 2ª transação aberta com 409) — upserts idempotentes garantem que a
  retomada não duplica o que já foi salvo.
- **Sem token de refresh confirmado** no fluxo atual (a troca de código não devolveu
  `refresh_token`) — pendência a confirmar quando a primeira conta Polar real conectar.
- Vários campos do resumo de exercício da Polar (cadência, potência, elevação real, rota GPS)
  dependem de endpoints de samples/GPX/TCX/FIT não implementados nesta etapa — ficam `null` no
  schema (não zero), com `detailFetchedAt` reservado para distinguir "nunca buscamos" de "buscamos
  e não veio".
- **DESCONHECIDO registrado, não assumido**: não foi possível confirmar pela documentação pública
  se o `id` de exercício da Polar é globalmente único ou só único dentro da conta do usuário. A
  chave de dedupe usa `provider+userId+externalId` (composta) justamente para ser correta nos dois
  cenários, sem depender de confirmar isso agora.
- Migration `20261001000000_add_polar_activity_ingestion`: aditiva (2 tabelas novas +
  4 colunas nullable em `PolarConnection`), sem alteração destrutiva. 19 testes novos/existentes
  passando (`polar-activity-ingestion.spec.ts` + `polar-oauth.spec.ts`), typecheck e lint limpos.
  Suíte completa da API rodada: única falha é `analytics-instrumentation.spec.ts`, pré-existente e
  sem relação com esta mudança (`isFirstPaidAcquisition`/`buildCohortSteps` ausentes em arquivos
  não tocados aqui).
- **Fora de escopo desta etapa, deliberadamente**: matching atividade↔sessão prescrita, webhook
  Polar, cron automático, samples/FIT/TCX/GPX, sono/HRV/PPI/Nightly Recharge, Training
  Intelligence. Sem commit/push/deploy — aguardando aprovação e, para validar de fato, a primeira
  conexão Polar real do treinador.

**2026-10-04** — Bloco 1 (execução e treino completo), 3 commits locais (064d949, 7ed7e7d, f70984b),
sem push/deploy. Caso de aceitação: Polar `512122061` (03/10/2026, 30,08 km, prescrito 30 km).
- **Histórico/calendário** (`TrainingPlansService.getStudentHistory`): lia só `WorkoutCompletion`, então
  corrida vinculada sem feedback aparecia como "Sem registro" e fora do volume. Agora `ActivityLog` +
  `SessionExecutionLink` ativo = realizado (`executionStatus: 'realized'`, km vindo da execução), com
  `feedbackPending` separado. Atividade `alternative` sem sessão sintética entra como card próprio
  (`isAlternativeActivity`, conta no volume, nunca cumpre prescrição); as já materializadas (`device_extra`)
  não são contadas duas vezes. Sem correção global de `isExtra`.
- **Causa dos gráficos/parciais ausentes**: `ActivityTimeSeriesService.normalizeFromRawSamples` só era
  chamado na ingestão de exercício NOVO. Atividade persistida antes da série canônica existir ficava com
  raw e zero `ActivityTimeSeriesPoint`; o detalhe escondia gráficos/parciais por falta de dado (e
  `cadenceAvg` ficava nulo). Correção: `ActivityDetailService.getDetail` reconstrói a série a partir do
  `RawActivitySample` já salvo (idempotente, deduplicada por atividade, sem consultar a Polar) quando a
  série está vazia e há raw.
- **Treino completo**: payload ganhou `prescribedSegments` (lidos de `TrainingSession.structure.blocks`,
  km acumulados + faixa de pace; sem hardcode; estrutura sem km ⇒ sem agrupamento), parciais com
  `segmentIndex` (metros excedentes ficam fora do bloco), `chart` agregado em ≤300 baldes por distância
  (média por balde — agregação, não interpolação) e `chartAxis`. UI nova em `apps/mobile/src/activityDetail.tsx`
  (react-native-svg): Resumo, Prescrito × Realizado, Ritmo (faixa prescrita + limites das partes), FC,
  Cadência, Parciais agrupadas. Eixos, unidade, grade, toque com tooltip; sem gráfico vazio.
- **Potência (sample type 4)**: NÃO implementada — semântica/unidade não confirmadas em fonte oficial
  acessível (apêndice "Exercise sample types" não retornou ao consultar). Raw preservado. Pendência.
- Pendência: reprocessamento só ocorre ao abrir o detalhe; Histórico/Home não dependem da série.
  `analytics-instrumentation.spec.ts` segue falhando (pré-existente, não relacionado).

### 2026-10-04 — Pré-Garmin 1: desconexão, revogação de coleta e exclusão de dados de provider
- **Fonte canônica de consentimento**: `PolarConnection.disconnectedAt` (null = coleta autorizada). Ao desconectar:
  `accessTokenEncrypted` vira null (coluna passou a ser opcional), transaction aberta é limpa, `polarUserId`
  é mantido para o webhook identificar e descartar eventos tardios. Reconectar (novo OAuth) zera tudo.
- `POST /polar/disconnect` (JWT, só a própria conexão, idempotente): revoga localmente PRIMEIRO, depois chama
  `DELETE /v3/users/{id}` da AccessLink (documentada: 204 = desregistrado e token revogado); falha da Polar não
  impede a revogação local. **Não apaga histórico.**
- Todos os caminhos de entrada respeitam o estado: `runSync` (manual/polling/webhook/retry) recusa com 409,
  scheduler filtra `disconnectedAt: null`, webhook descarta. Toda escrita de dado coletado passa por
  `writeIfStillAuthorized` (SELECT … FOR SHARE na linha da conexão dentro da transação) e aborta se revogado
  no meio do sync.
- `DELETE /polar/data` (exige estar desconectado) → `ProviderDataDeletionService` (provider-agnóstico, em
  `activity-execution/`): apaga por (userId, provider) raw, ActivityLog, samples, série, vínculos, notificações de
  reconciliação e sessões sintéticas `device_extra` puras. Sessão sintética ENRIQUECIDA pelo aluno (RPE, dor,
  notas, tênis, status/valor editado) é MANTIDA (decisão de Elton, 04/10): permanecem os dados do aluno; são anulados
  distanceKm/durationMin/avgHeartRate/maxHeartRate quando ainda são a cópia da atividade (comparação com a
  ActivityLog antes de apagá-la), avgPaceSecondsKm derivado delas, e a hora de completedAt (volta ao dia da sessão);
  a sessão vira `student_extra` sem activityLogId/provider. Valor editado pelo aluno fica. Auditoria em
  `ProviderConnectionEvent` (sem token/payload).
- Limitação: backups não foram tratados; restaurar um backup pode trazer de volta linhas apagadas e
  `disconnectedAt = null` anterior (o token restaurado já foi revogado na Polar). Tratar no bloco de Backup.

### 2026-10-05 — Pré-Garmin 2: payload bruto de provider só para admin, com auditoria
- Modelo atual = treinador único (não há vínculo treinador-aluno; `coach` é global via `COACH_EMAILS`). Decisão de
  Elton: não criar `coachId`/carteira. Coach e admin seguem com listagem/resumo e `reclassify` de atividades externas.
- `GET /coach/students/:studentId/external-activities/:activityLogId/raw` (payload bruto + samples) passou a
  `@Roles('admin')`. Cada leitura grava `ProviderConnectionEvent` (`type 'raw_read'`: ator, papel, atividade, aluno,
  operação; sem payload/credencial) ANTES de devolver o dado (falha de auditoria nega a leitura). Posse do
  `activityLogId` pelo `studentId` já era checada na query e agora está coberta por teste.
- ATENÇÃO: o papel `admin` não é atribuível hoje em produção (`effectiveRole` só promove a `coach` por `COACH_EMAILS`;
  nenhum código cria `admin`). Logo a rota raw estava inacessível a todos.
- Resolvido: `ADMIN_EMAILS` (mesmo padrão de `COACH_EMAILS`; `src/common/staff-roles.ts`). Precedência admin > coach >
  papel persistido. Admin herda o que era checado literalmente como coach: isenção de `accountStatus` no login,
  relatório `/funnel` e destinatário dos avisos de feedback. Para ativar: definir `ADMIN_EMAILS` no EasyPanel.

### 2026-10-05 — Pré-Garmin 3: Termos/Política canônicos, consentimento e área "Privacidade e dados"
- **Divergência encontrada:** duas versões vigentes — `/legal/terms` e `/legal/privacy` (curtas, genéricas) e
  `/termos-de-uso` e `/politica-privacidade` (usadas pelo cadastro no app, pela landing e pelas lojas). Agora o
  conteúdo vive só em `apps/api/src/legal/legal-content.ts` (fonte canônica: Termos, Política e resumo do app);
  `/legal/*` redireciona 301 para as canônicas. `GET /legal/summary` alimenta a tela do app com as mesmas frases.
- **Política**: wearables (Polar e Strava hoje; sem Garmin), dados brutos × derivados, IA (Anthropic, inferência; o que
  o fornecedor faz com os dados depende dos termos dele — não afirmado), terceiros reais (Anthropic, Resend, Asaas,
  RevenueCat/lojas, Expo, Telegram, Meta quando configurado, hospedagem), desconexão ≠ exclusão, backups sem
  prometer exclusão imediata nem prazo. Removidas duas frases que o código não sustenta ("sob contrato de
  confidencialidade do provedor" e "não compartilhamos dados com terceiros para fins de publicidade" — há evento Meta CAPI).
- **App**: item de menu permanente "Privacidade e dados" (`PrivacyDataScreen`): dados, integrações, IA, gerenciar
  (desconectar e excluir dados da Polar com confirmação, via `PolarConnect` variants `status`/`manage`), links,
  terceiros, solicitações. Nenhuma regra nova de backend.
- **Consentimento**: `acceptedTerms` é booleano no DTO; o cadastro grava `acceptedTermsAt`/`acceptedPrivacyAt` e, desde o ajuste
  final (migration `20261005120000_add_accepted_legal_versions`), `acceptedTermsVersion`/`acceptedPrivacyVersion` = `LEGAL_VERSION`
  (legal-content.ts). Usuários antigos ficam NULL (sem backfill, sem reaceite forçado). Ao mudar o texto, atualizar `LEGAL_VERSION`.
- **Meta CAPI (fato conferido no código)**: só 2 envios — CompleteRegistration (e-mail em hash SHA-256, fbp/fbc, IP, user agent, event_id)
  e Purchase (e-mail em hash, fbp/fbc, valor e BRL, event_id); só se META_PIXEL_ID/META_ACCESS_TOKEN existirem. Nenhum dado de saúde/treino.
  Política descreve exatamente isso. Backup: política não menciona restauração de dados excluídos nem prazo.
- **Pendências de decisão/verificação externa**: base legal e prazos 5/15 dias (texto pré-existente, mantido); advogado
  (ver pending_legal_review); confirmar Resend em produção; decidir se Meta CAPI continua no cadastro.

### 2026-10-05 — Pré-Garmin 4: backup criptografado no R2, restauração fail-closed (tombstones pendentes)
- **Antes:** `pg_dump` completo (sem criptografia) anexado a e-mail via Resend, sem retenção, sem procedimento de
  restauração; erro do `pg_dump` ecoava a `DATABASE_URL` (comando) para log, Telegram e resposta HTTP.
- **Agora:** `pg_dump` sem shell e com a conexão por variáveis `PG*` → AES-256-GCM (`BACKUP_ENCRYPTION_KEY`, chave própria) →
  upload no Cloudflare R2 (cliente SigV4 próprio, sem dependência nova; vetor oficial AWS nos testes) → conferência
  (tamanho + MD5/ETag) → temporário removido. Retenção de 14 dias aplicada pelo código (+ regra de ciclo de vida no bucket,
  a configurar). `POST /coach/backup/run` virou admin-only. Resend voltou a ser só e-mail normal.
- **Restauração:** `pnpm backup:cli list|download|decrypt|restore|post-restore` (runbook `RUNBOOKS/2026-10-05-BACKUP-RESTORE.md`).
  `restore` = `pg_restore` + `postRestoreSafeguard` sempre (roda até se o pg_restore falhar): Polar ativa vira desconectada,
  Strava perde as linhas de token, sem chamadas externas. Recusa `TARGET_DATABASE_URL` igual a `DATABASE_URL`.
- **Pendente (aprovação):** ledger de tombstones fora do banco (conta/dados de provider excluídos depois do snapshot).
  **Pendente (operacional, Elton):** criar bucket/token/regra no R2, variáveis no EasyPanel, `ADMIN_EMAILS`, ensaio de
  restauração, limpeza manual dos backups antigos por e-mail, rotação da senha do Postgres. Strava com token em texto puro: bloco seguinte.

### 2026-10-05 — Pré-Garmin 4 (conclusão): tombstones externos no R2 + restauração com reconciliação
- **Ledger de tombstones** (`backup/tombstone-ledger.ts`): `panzeri-backups/tombstones/…tomb.enc`, JSON cifrado (v, type, userId,
  provider?, at; sem PII), AES-256-GCM com a `BACKUP_ENCRYPTION_KEY`. **Ordem: tombstone confirmado no R2 → exclusão local**;
  R2 indisponível = 503 "nada foi apagado" + alerta Telegram. Falha local depois do tombstone: tombstone mantido, evento
  `data_deletion_failed`, alerta. Integrado a `ProviderDataDeletionService.deleteProviderData` (a lógica de exclusão não foi
  duplicada: `executeProviderDataDeletion`). Desconexão simples NÃO gera tombstone (o fail-closed global pós-restore já cobre).
- **Restore:** `decrypt → pg_restore → fail-closed → carregar tombstones → reaplicar os posteriores ao snapshot` (margem de 5 min,
  idempotente). Data do snapshot = metadado `created` (início do pg_dump) do objeto no R2, salvo em `<dump>.snapshot.json`.
  Ledger indisponível ⇒ CLI sai com código 2 ("RESTAURACAO NAO CONCLUIDA"), banco fica fail-closed. Comando `apply-tombstones` retoma.
- **Lifecycle no R2 (manual):** duas regras independentes — `panzeri-backups/db/` 14 dias; `panzeri-backups/tombstones/` 365 dias
  (o código nunca apaga tombstones).
- **BLOQUEIO — exclusão de conta NÃO implementada:** `User` tem ~36 FKs (default Restrict) + 13 tabelas por userId sem FK e `BillingEvent`
  com `onDelete: Restrict` (registro de pagamento que a Política manda reter). `DELETE User` é inviável sem perder registros de
  pagamento; exige decisão (anonimizar o `User` e apagar o resto, por categoria). Aguardando decisão de Elton.

### 2026-10-05 — Pré-Garmin 4 (fecho): exclusão de conta com anonimização irreversível
- **Decisão de Elton (opção 1):** `POST /coach/students/:studentId/delete-account` (**admin-only**; confirmação `confirmUserId` + `"EXCLUIR CONTA"`).
  Fluxo: tombstone `account_deleted` confirmado no R2 → revoga Polar (falha externa não bloqueia) → UMA transação que apaga a categoria A,
  anonimiza o `User` (e-mail aleatório `.invalid`, sem PII/senha/tokens, `accountStatus='deleted'`) e preserva B. Pré-condição: assinatura não
  ativa (nunca executa ação financeira). Código: `account-deletion/account-deletion.service.ts`.
- **Mapa A/B (sem itens C):** A = 49 tabelas (saúde, feedbacks, prontuário, treino, atividades/raw/séries, Polar/Strava, tênis, notificações, mensagens,
  tokens, conquistas, funil da jornada, e-mail em `FreeTesterEmail`). B = `User` anonimizado, `BillingEvent`, `BillingSubscription` (só ids/datas do
  pagamento), `CouponRedemption`, `ProviderConnectionEvent`. Teste falha se surgir modelo com `userId` sem classificação.
- Login/refresh/JWT recusam conta excluída (JwtStrategy consulta o status ≤ 1×/min por usuário). Restore reaplica a mesma exclusão (local, idempotente,
  sem novo tombstone). Política (seção 13) ajustada ao comportamento real; removida a frase sobre "prazo mínimo da legislação fiscal" (não implementado).
- Julgamentos CONFIRMADOS por Elton: `CouponRedemption` em B; eventos de funil em A (perde parte do BI); registros financeiros em B (prazo de
  retenção a definir com advogado). Aceite dos termos/privacidade/aptidão (datas e versões) é ZERADO na anonimização — sem finalidade de retenção definida.

### 2026-10-05 — Conformidade Strava (auditoria externa → correções)
- **Isolamento (por proveniência Strava):** nada de Strava chega a treinador/Admin nem a IA. Removidos: agente de análise Strava (Anthropic) e seu agendador;
  `refreshStravaAnalysis`; contexto Strava no prompt do agente de prescrição (`minutosCorridosStrava…`, `analiseExecucao`, `analiseAprofundadaStrava`,
  `mediaStravaRecente`); ferramentas Strava do Gerente Técnico; uso de Strava no check-in semanal; atividades/derivados no detalhe do aluno (coach) e no
  painel Admin. `StravaModule` ficou sem `exports` (só o app e o próprio aluno). Teste-guarda lista os únicos arquivos autorizados a tocar tabelas Strava.
- **OAuth/tokens:** `StravaOAuthAttempt` (state aleatório, hash no banco, 10 min, consumo atômico, vínculo ao usuário); replay NÃO é sucesso; escopo único
  `activity:read_all` conferido no callback; tokens AES-256-GCM com `STRAVA_TOKEN_ENCRYPTION_KEY` (nova, obrigatória); tokens antigos migram sozinhos.
- **Webhook:** o Strava NÃO assina eventos (documentação atual). Implementado: verify token obrigatório (sem padrão), `subscription_id` = nossa inscrição,
  dono conhecido, janela de 24 h, dedupe (`StravaWebhookEvent`), throttle, conteúdo sempre rebuscado na API. Desautorização apaga toda a cadeia Strava.
- **Revogação/exclusão:** `POST /strava/disconnect` (aluno): para a coleta na hora, apaga a cadeia Strava e revoga em `POST /oauth/revoke` (melhor esforço).
- **Retenção:** cache Strava = 7 dias desde a última busca (`StravaActivity.fetchedAt`, cron diário + migration que já expurga). Dumps de backup agora
  EXCLUEM os dados das tabelas Strava (`pg_dump --exclude-table-data`) e a restauração purga qualquer resquício. Sem tombstone Strava: o fail-closed já cobre.
- **Migration `20261005200000_strava_compliance`:** tabelas novas, `fetchedAt`, expurgo >7 d, apaga `TrainingExecutionInsight`, zera `StravaAnalysisCache`,
  remove campos Strava de `TrainingPlan.inputSnapshot` e de relatórios de evolução já gerados. Resíduo: texto livre gerado antes pela IA pode citar o Strava.
- **UI:** "Em breve" removido; conexão com explicação de escopo/uso/retirada e botão "Desconectar e apagar". **Pendente:** colocar os arquivos OFICIAIS do
  Strava (botão Connect with Strava + selo Compatible with Strava) em `apps/mobile/assets/strava/` e apontar em `src/stravaBrand.ts` (links do zip retornaram 404).
- **Variáveis novas no EasyPanel:** `STRAVA_TOKEN_ENCRYPTION_KEY` (obrigatória; adicionar JUNTO do deploy, senão a conexão Strava falha) e, para criar
  webhook, `STRAVA_WEBHOOK_VERIFY_TOKEN`.

### 2026-10-05 — Apple Watch, Bloco 1: prova técnica HealthKit + WorkoutKit (código escrito, NÃO compilado nem testado em aparelho)
- **Escopo:** só prova. Nada vai para API/ActivityLog/IA/Training Intelligence; sem deduplicação, sem rotas/GPS, sem background.
- **Arquitetura:** módulo Expo nativo local `apps/mobile/modules/panzeri-apple-health` (Swift: HealthKit leitura de `HKWorkout` corrida + distância; WorkoutKit
  `WorkoutScheduler`, `SingleGoalWorkout` de corrida com distância, `WorkoutPlan(id: UUID)` = id do Panzeri Run) + config plugin `plugins/withAppleHealthProof.js`
  (entitlement HealthKit, `NSHealthShareUsageDescription`, iOS 17.0 mínimo) + tela de teste `src/appleHealthProof/AppleHealthProofCard.tsx` (só iOS nativo, flag
  `extra.appleHealthProof` em `app.json`). Android/web/PWA não têm o módulo e não mostram a tela.
- **RevenueCat no iOS (lacuna PRÉ-EXISTENTE, não resolvida aqui):** `isNativeStorePurchaseAvailable()` continua `Platform.OS !== 'web' && chave Android`; num build iOS nativo
  ela daria true e tentaria RevenueCat com a chave do Google Play (erro capturado/logado), desviando o fluxo de assinatura do Asaas. Decisão de compra iOS e chave
  RevenueCat iOS ficam pendentes — não mexidas pela prova Apple Watch.
- **Pendente (só o Elton):** conta Apple Developer + `eas device:create` + `eas build -p ios --profile preview` + teste no iPhone/Apple Watch. O app iOS nativo
  nunca foi buildado antes (iPhone usava PWA).

### 2026-10-06 — Apple, Etapa 1: ingestão HealthKit pela arquitetura canônica de atividade
- **Fluxo:** app iOS lê `HKWorkout` (corrida) → `POST /apple-health/workouts` (JWT; userId SEMPRE do token) → normalizer → `RawExternalActivity` + `ActivityLog`
  com `provider='apple_health'` (= canal de ingestão). Origem observada fica em `ActivityLog.providerMetrics`: `source{name,bundleId,family}` (family só `apple`/`strava`
  quando o bundle id permite; senão null), `device{...}|null`, `activityType`, `isIndoor`, `timeZone`, `hkWorkoutUuid`. HealthKit NÃO implica Apple Watch.
- **Idempotência:** `externalId = HKWorkout.uuid` (minúsculo) na chave única `(provider,userId,externalId)`; reimportar devolve `already_imported`; corrida de
  concorrência (P2002) é tratada. Só duplicação DENTRO do HealthKit — dedup cross-provider é a Etapa 2.
- **Deliberadamente NÃO feito:** `classify()`/reconciliação, notificações, samples/série temporal, dedup cross-provider, FC/calorias (exigiria novos tipos HealthKit).
  `ActivityLog` nasce com `executionClassification=null`: TI/evolução só leem `corresponding`/`alternative`, então a atividade Apple não alimenta nada ainda.
- **Pendências de privacidade/produto (não resolvidas):** política/termos ainda não citam HealthKit; não há exclusão de dados `apple_health` por desconexão
  (só exclusão de conta); atividades com source Strava vindas pelo HealthKit precisam de decisão (regras de isolamento do Strava) antes de alimentar qualquer coisa.

### 2026-10-06 — Apple, Etapa 2: identidade física cross-provider (deduplicação sem fusão)
- **Necessidade:** a mesma corrida chega por mais de um caminho (Polar direto; Polar→Strava→HealthKit→app). Cada registro continua em `ActivityLog` (provenance), mas o
  domínio precisa saber que são o MESMO evento. Não existia mecanismo de dedup/correlação reutilizável.
- **Estrutura mínima:** 4 colunas anuláveis em `ActivityLog` (migration aditiva `20261006120000_activity_physical_identity`): `physicalEventId` (uuid compartilhado
  só quando há ≥2 observações), `physicalIdentityStatus` (`unique`/`matched`/`ambiguous`; null = nunca avaliado), `physicalIdentityEvidence`, `physicalIdentityEvaluatedAt`.
  Nada é apagado, fundido ou reescrito; sem hierarquia de provider e sem métricas "escolhidas".
- **Matching** (`activity-execution/physical-activity-identity.ts`, função pura): mesmo atleta, modalidade compatível, observador diferente (dois registros do mesmo
  provider/source nunca são o mesmo evento), início, sobreposição de intervalos, duração e distância — níveis forte/fraco/não, tolerâncias graduadas que escalam com a duração.
  Resultado: `same` (≥3 sinais fortes, nenhum contrário), `distinct` (outro horário, modalidade incompatível, mesmo observador…), `ambiguous` (nunca força match).
- **Serviço** (`PhysicalActivityIdentityService`): avalia a nova observação contra TODAS da janela (±12h), une grupos que passam a se tocar, serializa por usuário com
  advisory lock, nunca desagrupa sozinho, rival do mesmo observador → ambíguo. Chamado (best-effort) após a ingestão Polar e Apple; backfill por aluno em
  `POST /coach/students/:id/external-activities/evaluate-identity`. Validador offline sem banco: `apps/api/scripts/validate-physical-identity.ts`.
- **Quarentena mantida:** não altera `executionClassification`, não liga a `TrainingSession`, não toca TI/evolução/aderência.
- **ATENÇÃO (consumidor a tratar depois):** `SessionExecutionLinkService.classify()` considera `executionClassification=null` como "rival" no mesmo dia — uma duplicata
  Apple (null) pode tornar uma atividade Polar `ambiguous`. A identidade física agora permite excluir duplicatas desse cálculo, mas isso NÃO foi alterado aqui.

### 2026-10-06 — Apple, Subetapa 3A: observação canônica por evento físico + ecossistema primário por período
- **Antes (commit separado `e65ec3b`):** identidade física passou a ser função pura do CONJUNTO de observações (recomputa o cluster a cada avaliação; um
  registro conflitante tardio desfaz o grupo antigo e todas as ordens de chegada convergem). Esta etapa só trata a canônica.
- **Estrutura:** `ActivityLog.physicalCanonicalActivityLogId` (todo membro de um evento aponta para a mesma observação real; `unique` aponta para si; `ambiguous` = null) +
  `physicalCanonicalReason` (regra, primário vigente NA DATA DO EVENTO, motivo do fallback, candidatas) e a tabela `AthletePrimarySource` (ecossistema primário do atleta
  POR PERÍODO, `effectiveFrom`). Migration aditiva `20261006180000_physical_canonical_observation`.
- **Regra:** (1) primário do atleta na data do evento, se houver observação válida dele (canal direto antes de relay do mesmo ecossistema); (2) senão fallback
  determinístico entre as válidas (mais completa, depois canal direto, depois id) — SEM hierarquia universal de provider; (3) registra o porquê. Nenhuma métrica é
  copiada entre observações. Ecossistema de uma observação HealthKit só vale quando o bundle da ORIGEM pertence a um ecossistema conhecido (`com.polar.*`, `com.garmin.*`,
  `com.apple.*`, `com.strava.*`); senão null (não se inventa o dispositivo original).
- **Primário do atleta:** linha explícita vigente na data > histórico de `WorkoutDelivery` (enviada/entregue) até a data > nenhum. Trocar de relógio = novo período
  (`POST /coach/students/:id/primary-source`), eventos anteriores continuam resolvidos pelo período antigo.
- **Fora de escopo (3B/3C):** reconciliação por evento, consumidores, UI, composição de métricas.

### 2026-10-06 — Apple 3A revisada (regra v2): canônica automática por PAPEL da observação, sem fonte primária manual
- **Decisão (Elton):** o aluno só conecta o que usa; o Panzeri Run escolhe. Princípio: gravador nativo antes de cópia/relay — papel da observação NAQUELE evento, nunca hierarquia de marcas.
- **Papéis** (`physical-canonical.ts`): `native_recorder` (integração direta Polar/Garmin/…; HealthKit com origem Apple + device Apple, ex. Apple Watch), `relay` (só com evidência:
  HealthKit de app X + gravação nativa DIRETA de X no MESMO evento; Strava nunca é promovido) e `unknown` (HealthKit de app de terceiro sozinho — Strava, Polar Flow, Garmin Connect —,
  origem Apple sem device, agregador). Sensor (cinta de FC) não é observador. Não se inventa origem.
- **Seleção:** nativo vence (entre nativos: override excepcional > completude > id; alternativas registradas); sem nativo → `best_available` (não é erro); `sole_observation` para uma só.
  `physicalCanonicalReason` v2: `rule`, `nativeObservationPresent`, `tieBreak`, `nativeAlternatives`, candidatas com `role`/`roleBasis`.
- **`AthletePrimarySource`** deixou de ser seletor: só override excepcional (desempata nativos equivalentes) e registro histórico. **`WorkoutDelivery` não entra** (prova destino, não correspondência
  — ganha força na 3B). Pendência: confirmar com dados reais se o `device` do HKWorkout distingue gravação nativa de cópia importada.

### 2026-10-06 — Apple Etapa 3B (núcleo): reconciliação por PhysicalEvent ↔ TrainingSession
- **Modelo:** `SessionExecutionLink` continua sendo a única estrutura; `activityLogId` aponta para a observação **canônica** atual do evento
  (para `unique`, a própria observação). Sem migration. Observações não-canônicas não carregam vínculo nem classificação automática (conta uma vez).
- **`SessionExecutionLinkService.reconcileEvent(id, {dryRun})`** resolve evento → canônica; decisão humana (`coach`/`student`) prevalece e
  conflito vira linha `revoked` inerte (`automatic_conflict_with_human_decision`); vínculo automático ativo é estável e só acompanha a canônica
  (`automatic_canonical_follow`, com supersessão); estados automáticos não vinculados (`alternative`/`ambiguous`) são recalculados.
  `classify()` virou plano (`planClassification`) + aplicação; para evento `matched` delega a `reconcileEvent`.
- **Correções semânticas:** modalidade canônica (`canonical-modality.ts`) também na reconciliação; observações do mesmo evento e não-canônicas de
  outros eventos não são rivais; sessões sintéticas `device_extra` não concorrem como candidatas; atividade alternativa já materializada é preservada.
- **Histórico:** `reconcileUserHistory(userId, {dryRun})` (idempotente); endpoint `POST /coach/students/:id/external-activities/reconcile-history`
  (SIMULAÇÃO por padrão; só grava com `{"dryRun": false}`, após avaliar a identidade). **Não executado em produção.**
- **Disparo:** Polar (`classify` após `evaluateSafely`) e Apple (`evaluateSafely` → `reconcileEvent`). Identidade `ambiguous` não é reconciliada.
- **Fora desta etapa:** consumidores (3C), TI, UI do aluno, Garmin/COROS. Sem botão no Admin para a reconciliação histórica (próximo passo pequeno).

### 2026-10-07 — Apple bidirecional (envio de treino ao Apple Watch): fechamento da fase
Pipeline implementado: `TrainingSession` → `CanonicalWorkout` → `AppleCustomWorkoutSpec` → Swift `CustomWorkout` → `WorkoutDelivery` → `WorkoutScheduler`.
- **Camadas (todas independentes de provider, exceto o adaptador Apple):** `training-plans/canonical-workout.ts` (representação canônica: ordem, repeatCount,
  distância em metros, work/recovery, `activity` só quando explícito, prescrito × derivado, perdas/avisos), `workout-delivery/apple-custom-workout-spec.ts`
  (tradutor Apple; recusa o que exigiria inventar informação; sem alertas de pace; banda ±20 s nunca enviada), `workout-delivery/apple-workout-eligibility.ts`,
  `AppleWatchDeliveryService` (uma entrega ativa por sessão, `planId` estável, idempotência, `specHash`), módulo nativo
  `CustomWorkoutSpecBuilder.swift` + `scheduleCustomWorkoutSpec`. O teto de 100 km é regra do adaptador Apple, não do `CanonicalWorkout`.
- **Validado em iPhone real:** `CanonicalWorkout`; `AppleCustomWorkoutSpec`; `CustomWorkout` compilado (builds iOS preview, Swift sem erros) e executado;
  contínuo `1×[work 8000 m]`; intervalado `6×[work 400 m, recovery 200 m]`; misto `1×[2000] → 5×[1000, 400] → 1×[2000]`; **`IntervalBlock` com único passo `work`
  aceito** pelo WorkoutKit; **`dataRepresentation`** serializou nos três casos (sonda temporária da Etapa 6, depois removida).
- **Fluxo real pelo `WorkoutDelivery`** (treino estruturado de 10,8 km): validado **até `WorkoutScheduler.requestAuthorization`**.
- **Resultado da autorização no iPhone do treinador (sem Apple Watch pareado): `WorkoutKit não autorizado (notDetermined)`.** Decisão: **não contornar** — a
  autorização do agendador depende de um Apple Watch pareado; o erro nativo real fica preservado na entrega (`failed` + `errorMessage`) e no card.
- **PENDENTE (teste final):** `WorkoutScheduler → Apple Watch → execução → HealthKit → PhysicalEvent`, com **aluno que tenha Apple Watch**. Só ali se prova que o
  agendamento é aceito, que o treino aparece no relógio, e o retorno do `workoutPlanId` (HKWorkout.workoutPlan.id) relacionado à `TrainingSession`. Hoje, `sent`
  = "WorkoutKit aceitou e o plano consta em `scheduledWorkouts`"; **nunca** `delivered_to_device` sem evidência; nenhuma inferência de execução a partir do delivery.
- **Incidente resolvido no caminho:** HTTP 500 na elegibilidade = drift Prisma × banco (`WorkoutDelivery.deliveredAt`/`canceledAt`) por migration editada depois de
  aplicada; corrigido com a migration `20261007200000_workout_delivery_add_missing_columns` (aditiva) e guarda de drift em teste. Outras migrations também foram
  editadas após a criação (`20260705120000`, `20260710120000`, `20260729160000`, `20260916164659`): drift **não verificado** nelas — auditoria separada recomendada.
- **Fora desta fase:** alertas de pace, passo por tempo, pausa passiva, esteira, `CustomWorkout` com `displayName` (iOS 18+), Polar, Garmin, remoção de treino do relógio
  quando a prescrição muda depois do envio (hoje: sinalizado como desatualizado, sem reenvio automático).

### 2026-10-08 — Dispositivos e integrações: hub central + Wahoo (OAuth validado em produção; leitura de atividades pronta)
- **Hub (Etapa 2, publicado):** menu único "Dispositivos e integrações"; catálogo no servidor `GET /me/integrations` (disponibilidade × capacidades × conexão do aluno); rota antiga `strava` abre o hub na tela do Strava; com a API fora do ar o hub ainda mostra Polar e Strava.
- **Wahoo, OAuth (Etapa 3, publicado e validado com a conta do Elton):** `state` aleatório (hash, 10 min, uso único) + PKCE S256 + `client_secret` + troca em JSON — a Wahoo **devolve o `state`** (não documentado; provado em teste real) e aceita PKCE junto com o secret. Tokens cifrados com chave própria (`WAHOO_TOKEN_ENCRYPTION_KEY`); refresh rotativo com trava (lease) por aluno. **Nunca** chamar `DELETE /v1/permissions` em caminho de erro (revoga o app para a conta Wahoo inteira); só na desconexão explícita. Porta de habilitação `WAHOO_ENABLED_USER_IDS` (vazio = ninguém; `*` = todos).
- **Wahoo, leitura de atividades (Etapa 5, no código, NÃO publicada):** resumos de treino (lista + `workout_summary`) → `RawExternalActivity`/`ActivityLog` pelo mesmo caminho da Polar (identidade física, reconciliação, aviso). Só a partir de `collectFrom` (conexão − 7 dias). Gatilhos: botão "Sincronizar agora", webhook (`POST /wahoo/webhook`, autenticado só por `webhook_token` no corpo; o conteúdo do evento nunca vira dado) e rotina de segurança (3 h, teto de 100 conexões, para no 1º limite da API; produção: 200/5 min, 1000/h, 5000/dia). Escopos pedidos: `user_read workouts_read offline_data` — quem conectou antes precisa reconectar. Limitações: a Wahoo **não compartilha treinos de apps de terceiros**; sem FIT/série temporal (só o resumo); cadência/potência ficam só no bruto.
- **Privacidade:** Wahoo entra na exclusão de conta, nas tabelas fora dos dumps de backup (restauração = desconectado), em "Privacidade e dados" (desconectar / excluir dados importados) e nos textos legais (versão 2026-10-08, **aguardando aprovação e revisão jurídica antes de publicar**).
- **Pendente:** Etapa 4 (envio de treino) bloqueada até a Wahoo responder (dispositivos de corrida, alvo `speed`, entitlement `plans_*`); parser de FIT.

### 2026-10-09 — Wahoo liberada a todos os alunos (decisão de Elton); sync automático desligado
- **Decisão (Elton, 09/10):** Wahoo disponível para todos já neste deploy (`WAHOO_ENABLED_USER_IDS=*` no EasyPanel; poucos alunos, provavelmente nenhum com Wahoo). Revoga a restrição só-minha-conta de 08/10. A disponibilidade continua dependendo das 4 credenciais Wahoo no servidor.
- **Webhook e rotina automática DESLIGADOS por padrão:** `WAHOO_WEBHOOK_ENABLED=true` (+ `WAHOO_WEBHOOK_TOKEN` + webhook ligado no portal da Wahoo) e `WAHOO_FALLBACK_ENABLED=true` ligam cada um; o botão "Sincronizar agora" funciona sempre, independente das duas flags.
- **Honestidade na interface:** importação apresentada como "recurso novo, em validação com atividades reais" (nenhuma atividade real importada até 09/10). Falhas reais de sync gravam `ProviderConnectionEvent` tipo `sync_failed` (só nome do erro e status HTTP).
- **Textos legais publicados com este deploy:** versão 2026-10-09 (Wahoo nas listas de serviços/terceiros, parágrafo próprio, desconectar/excluir dados). Revisão jurídica ainda pendente (ver pendência jurídica).
- **Para ativar o sync automático depois:** validar uma atividade real pelo botão; definir `WAHOO_WEBHOOK_TOKEN`; ligar o webhook no portal (URL `/wahoo/webhook`); `WAHOO_WEBHOOK_ENABLED=true`; opcional `WAHOO_FALLBACK_ENABLED=true` (padrão 3 h, limite da API 1000 chamadas/h).

### 2026-10-09 — Inteligência, Etapa 1.1: informações do aluno chegam ao Prescritor (sem migration)
- **Contexto:** auditoria (Astra/Claudinho) achou perdas entre Relator → prontuário → Prescritor. Etapa 1.1 corrige o fluxo; 1.2 (pacote de evidências/rastreabilidade) e as Etapas 2–3 aguardam autorização.
- **Corrigido:** (1) histórico semanal agora é de 4 **semanas** (não 4 planos) e conta só o plano mais recente de cada semana — sessões-fantasma de planos regenerados não inflam mais prescrito/"sem registro" (`selectHistoryWeeks`); (2) `StudentReportEntry` (interpretação do Relator) passa a chegar ao Prescritor: persistentes de qualquer idade + relevantes (120 d) + resolvidos (180 d), cronológicos, com data (`relatosEstruturadosDoAluno`); (3) relatos ainda sem interpretação e eventos do prontuário não condensados chegam em **texto bruto** (`relatosAindaNaoInterpretadosDoAluno`, `eventosDoProntuarioAindaNaoCondensados`) — a falha da condensação não faz mais o evento sumir (`refreshProfileDetailed`); (4) análises do Relator paradas há >10 min são reprocessadas antes da geração (`retryStalledAnalyses`); (5) a regeneração de **um dia** (corrida e força) passou a receber prontuário, relatos, pendências e entrevista (antes não recebia nada disso); (6) observações do aluno chegam com data; (7) falhas de recuperação (estado do atleta, ciclo, prontuário, relatos) viram `lacunasDeContexto` no contexto da IA, `inputSnapshot.informationContext` e aviso Telegram ao treinador (severidade "degradado") — a geração não é bloqueada.
- **Regra de precedência no prompt (não no código):** relato mais recente prevalece no mesmo assunto; RESOLVIDO encerra restrição anterior; PERSISTENTE_ATE_CONTRARIO vale até relato posterior dizer o contrário; restrição real × preferência × dificuldade de execução × comportamento recorrente.
- **Não alterado:** modelos de IA, treinos já prescritos (nada é regravado por novos relatos), banco (sem migration), Strava/Polar/Wahoo/Apple.
- **Limites conhecidos:** não há tabela estruturada de "fatos do aluno" (tipo/escopo/validade) — a distinção restrição × preferência depende da interpretação do Relator e do prompt; a regeneração de um dia não recebe a matemática longitudinal nem o check-in; a influência real de cada campo na decisão só se prova com experimento (Etapa 3).

### 2026-10-09 — Etapa 1.1 aprovada por Elton; push de 44f865d; deploy NÃO feito; 3 pendências registradas
- **Decisão (Elton, 09/10):** Etapa 1.1 aprovada; push autorizado; **deploy em produção suspenso** até validação em ambiente de teste (sem regressão em geração semanal e regeneração de um dia). Os 31 testes de `student-information-flow.spec.ts` passam a integrar a suíte de regressão. Etapa 1.2 só com nova autorização.
- **Validação local feita:** `tsc` verde (api/mobile); suíte completa 1353 ok + 1 falha pré-existente (`legal-content`, tela Privacidade) + 1 suíte pré-existente (`analytics-instrumentation`); 10 suítes de geração/histórico/relator = 105 testes ok. **Não existe ambiente de teste com banco** (sem Postgres/Docker local nem staging no EasyPanel): as consultas novas só foram verificadas por tipos e mocks — ver pendência de ambiente abaixo.
- **Pendências para as próximas etapas (a tratar com autorização):**
  1. **Precedência entre informação atual, antiga e resolvida** não deve depender só do prompt: hoje é regra de prompt + ordenação cronológica; precisa de critério determinístico/estruturado (ex.: fato com assunto/escopo, vigência e substituição explícita — provavelmente exige migration, `StudentFact`).
  2. **Regeneração de um dia** deve receber também o contexto matemático longitudinal (Athlete State/contexto compacto) e o check-in pertinentes (hoje recebe só o contexto textual).
  3. **Critérios objetivos de falha de contexto:** definir quais lacunas permitem prescrição conservadora e quais devem **impedir a geração** (hoje todas só avisam o treinador e instruem a IA a ser conservadora).
  - Ambiente de teste (staging com Postgres isolado + restauração de backup comprovada) para validar queries e fluxos reais antes de qualquer deploy de mudança de IA/prescrição.

### 2026-10-09 — Inteligência, Etapa 1.2a: rastreabilidade determinística das prescrições (migration `20261009120000_prescription_trace`; NÃO publicada)
- **Aprovação (Elton, 09/10):** desenho de 2 tabelas (`PrescriptionEvidencePackage`, `PrescriptionDecision`) e divisão 1.2a (sem IA) / 1.2b (a IA declara intent/expected/basis, só após teste de custo aprovado). Deploy em produção suspenso.
- **Ambiente de teste:** PostgreSQL 17.11 portátil (EnterpriseDB, `postgresql-17.11-5-windows-x64-binaries.zip`, 381.531.864 bytes, sha256 `80379b2c…df82f`), cluster descartável em 127.0.0.1:55432, **nunca** produção. Testes `*.int.spec.ts` (`npm run test:integration`, guard recusa host não-loopback e banco sem `_test`; README em `apps/api/test/integration/`).
- **Migrations antigas "modificadas" — achados:** `20260705120000` e `20260729160000`: conteúdo **idêntico** à primeira versão no Git (só BOM/fim de linha); `20260710120000`: tornada idempotente (`IF NOT EXISTS`), mesmo estado final; `20260916164659`: a versão ORIGINAL (617788a) **falha** depois da `20260915120000` (coluna `firstPaidAt` já existe — explica a migration travada) e a atual passa (evidência em teste). Nada foi reescrito. Aplicar as 88 migrations do zero funciona; sobram divergências migrations × `schema.prisma` já conhecidas e travadas em teste (FK `MenstrualCycleLog_profileId_fk`, `BillingEvent.value` numeric(10,2) × Decimal(65,30), defaults de `updatedAt`/`evidence`/`adjustmentReasons`, nome de índice truncado) — **não corrigidas**; precisam de migration nova e autorização. **Em produção** a situação real só se confirma lendo `_prisma_migrations` (checksum/finished_at) e as colunas — consulta read-only a cargo do Elton.
- **Backup/restauração provados em ambiente isolado:** `pg_dump` real com as exclusões de produção + `pg_restore` real em outro banco + fail-closed (Polar desconectada/sem token; Strava/Wahoo fora do dump) + reaplicação de tombstone de exclusão de conta; a trilha de rastreabilidade entra no backup e some junto com a conta.
- **Implementado (1.2a):** pacote de evidências por geração semanal e por regeneração de um dia, gravado na **mesma transação** do plano/treino (sem plano sem trilha); `agentInput` = texto EXATO enviado à IA (hash conferível; jsonb reordena chaves, por isso guarda-se a string); índice de evidências com `delivery` (entregue / entregue sem processar / ausente) e `storage` (completo / parcial / só referência); decisões determinísticas (resumo da sessão, `changeFromPrevious`, justificativa livre da IA como DECLARADA) com `traceStatus=absent`; resultado lido por vínculo (`WorkoutCompletion` + atividade canônica), sem cópia; `GET /coach/students/:id/prescription-trace` (coach/admin; `agentInput` só com `includeAgentInput=true`); retenção `PRESCRIPTION_TRACE_INPUT_RETENTION_MONTHS` (padrão 12, `off` desliga; diária + uma vez após cada subida); exclusão de conta e backup integrados; exclusão EXPLÍCITA de dados de provedor redige os itens derivados dele (desconectar não toca a trilha).
- **Prompts e modelos congelados:** hashes dos 6 prompts de sistema idênticos aos do commit 54b5427 (teste); nenhum modelo alterado; diff do agente = só hoisting + parâmetro opcional de registro.
- **Limites:** `basis`/`intent`/`expected` ficam vazios até a 1.2b; itens de evidência de atividade de provedor ainda não existem (o dado de dispositivo entra por variáveis agregadas, não atribuíveis a provedor); revisão independente com contexto separado (CLAUDE.md) **não** foi feita; texto legal ainda não menciona a trilha nem a retenção de 12 meses (levar à revisão jurídica).

### 2026-10-09 — Etapa 1.2a aprovada; push de 7842ecf e e009384; revisão do Astra pendente
- Elton aprovou os resultados e autorizou o push (feito). **Sem deploy.** Resumo para revisão independente em `REVISAO_ASTRA_ETAPA_1_2A.md` (inclui divergência da migration 0916 e consulta SQL somente leitura para produção).
- **Pendência antes do deploy:** atualizar Termos/Política (registro do texto enviado à IA, retenção de até 12 meses, exclusão com a conta e redação ao excluir dados de provedor). 1.2b e Etapa 2 só após a revisão do Astra.

### 2026-10-10 — Etapa 1.2a: correções após a revisão independente do Astra (NÃO publicada; sem deploy)
- **Falhas bloqueantes corrigidas:** (1) exclusão explícita de dados de um provedor agora alcança o texto enviado à IA (`agentInput`) e os agregados do índice, com proveniência por pacote (`sourceProviders`), marcador auditável (`agentInputRedactions`, só metadados) e sem tocar em outras fontes/alunos; (2) cada versão de sessão regenerada é preservada por inteiro (`PrescriptionDecision.sessionSnapshot`), com vigência e resultado por versão (atividade objetiva pela hora de início; registro do aluno pela última versão, por invariante de ciclo de vida — a regeneração agora trava a linha da sessão e relê o registro na transação); (3) rastreabilidade obrigatória (`PrescriptionTraceService` sem `@Optional`, `requireTrace()` recusa antes de qualquer chamada de IA).
- **Migration nova (aditiva):** `20261010120000_prescription_trace_hardening`. A `20261009120000` (já no GitHub) não foi alterada.
- **Material entregue ao Elton:** `VERIFICACAO_MIGRATIONS_PRODUCAO.md` (consulta somente leitura + verificador offline de checksums; cinco migrations tiveram o arquivo editado: onboarding_interview, coupons, strava_analysis_cache, data_layer_phase_0, workout_delivery) e `RASCUNHO_TEXTOS_LEGAIS_RASTREABILIDADE.md` (textos legais em rascunho, NÃO publicados). Detalhes em `REVISAO_ASTRA_ETAPA_1_2A.md` (seção final).
- **Limites declarados:** agregados de dispositivo são removidos por inteiro (média sobre o conjunto de atividades); `WorkoutCompletion` não tem instante de criação confiável; resultado da consulta de produção continua desconhecido até Elton rodá-la. Deploy continua proibido; 1.2b e Etapa 2 seguem sem autorização.

### 2026-10-10 — Etapa 1.2a: `weekly_training_load` na exclusão de dados de provedor (implementado; NÃO publicado; sem deploy)
- **Decisões de Elton:** D1 invalidar agregados históricos sem recalcular; D2 valor copiado do relógio é derivado do provedor mesmo sem edição; D3 ACWR invalidado se qualquer componente da janela depende do provedor excluído; D4 Política (rascunho) avisa que a exclusão pode invalidar indicadores históricos derivados.
- **Implementado:** proveniência por provedor na geração (`collectProvenance`), mapa variável→tipo de contribuição, invalidação no índice e no texto guardado com marcador auditável; `volumePrescribedKm`, treinos prescritos e registros independentes preservados (hash idêntico em teste). Sem migration. Bug corrigido no caminho: exclusões sucessivas de provedores diferentes no mesmo pacote.
- **Pendente:** revisão final do Astra; revisão jurídica dos textos; consulta de migrations em produção (Elton); 1.2b e Etapa 2 sem autorização.

### 2026-10-10 — Etapa 1.2a: exclusão de provedor alcança historicoSemanal e toda a classe de valores de execução (implementado; NÃO publicado; sem deploy)
- **Bloqueio do Astra:** a exclusão não alcançava `historicoSemanal` no `agentInput`. Corrigido pela classe: inventário de TODOS os campos do prompt (`PROMPT_FIELD_CLASSIFICATION` + teste de cobertura), proveniência de dispositivo calculada ao montar o contexto (`sessionDerivation`), registro no pacote (`schemaVersion` 2), redação por campo/índice com marcador auditável e preservação de índices para exclusões sucessivas.
- **Descoberta relevante:** o prontuário condensado e os eventos pendentes podem carregar o resumo do relatório de evolução (evento `REASSESSMENT_COMPLETED`), texto de IA derivado do estado/volume; agora são invalidados quando derivados. Prompt do dia (corrida/força) também registra proveniência.
- **Limite:** relatório de evolução/reavaliação/prontuário vivos não foram alterados; pacotes v1 são invalidados de forma conservadora. Rascunho da Política atualizado (narrativas invalidadas).

### 2026-10-10 — Etapa 1.2b: raciocinio declarado pela IA (intent / expected / basis) na trilha (implementado; NÃO publicado; sem deploy)
- **Autorização:** Elton encerrou a 1.2a (`bd20e27`), aprovou a invalidação integral das narrativas derivadas e autorizou a 1.2b. Sem migration (colunas `intent`, `expected`, `basis`, `traceStatus` já existiam desde a 1.2a).
- **Contrato do Prescritor:** cada sessão (semana: corrida e força; dia de corrida; dia de força) devolve `reasoning` (nullable): `intent` (≤160), `expected` (≤160), `basis` (≤3 itens `{source, note≤100}`; `source` = enum fechado de campos do contexto). Sem `.max()` no schema: o tamanho é truncado em código, nunca rejeita a resposta. Instrução curta única (`REASONING_INSTRUCTION`) nos três prompts; `max_tokens` do dia 2000→2600 (corrida) e 3000→3400 (força); semana inalterado (48000).
- **Gravação:** o CÓDIGO liga cada fonte declarada aos itens do índice de evidências (`evidenceRefs`, `delivered`, provedores). Registrado como "declaração da IA, não prova de influência" (`nature`). `traceStatus`: complete (objetivo+esperado+≥1 fundamento) / partial / absent. Registros sem os campos continuam válidos (absent).
- **Provedores:** o texto declarado que se apoia em evidência derivada de um provedor sai na exclusão explícita (objetivo, esperado e a entrada), com marcador; fontes independentes ficam.
- **Prompts:** a única mudança é o bloco `REASONING_INSTRUCTION`; removendo-o, cada prompt volta bit a bit ao hash anterior (teste). Modelos inalterados.
- **Limite:** a IA pode citar valor de dispositivo em `intent`/`expected` sem declarar a fonte — não detectável sem heurística; a invalidação cobre o que ela declarou como fundamento.

### 2026-10-11 — Etapa 2.1: análise determinística da execução, relatório por treino e semanal (implementado; NÃO publicado; sem deploy)
- **Entregue:** matemática pura de execução (tempo observável por faixa, cobertura, estrutura A–F, intensidade), relatório por treino e semanal sem IA, consolidação no ponto existente de `generateWeekLocked` (indicadores ao Prescritor + retrato gravado com o programa + exibição no app), 4 variáveis longitudinais, exclusão de dados do provedor integrada e correção visual do gráfico. Migration aditiva `20261011120000_execution_analysis`. Detalhes, critérios e limites em `ETAPA_2_1_ANALISE_DE_EXECUCAO.md`.
- **Limites:** validado com séries sintéticas (sem séries reais no repositório); prescrição por tempo sem alinhamento por bloco; limiares não calibrados com dados reais; indicadores vivos recalculados ao abrir treino/semana (sem gancho na sincronização).


### 2026-10-09 — Etapa 2.2 Analista de Treinos (local, sem push)
Analista determinístico (0 chamadas de IA) com contrato training-analysis/1 persistido em TrainingAnalysis; evidência enxuta no prompt semanal; ver ETAPA_2_2_ANALISTA_DE_TREINOS.md.

### 2026-10-09 — Etapa 3: ajuste dos agentes (local)
Regeneração de dia recebe o retrato do Analista; seleção por foco; fundamentação com decides; evento TRAINING_ANALYSIS_FINDINGS no Prontuário; prompts ajustados. Ver ETAPA_3_AJUSTE_DOS_AGENTES.md.

### 2026-10-10 — Classificação individual de tendências + Polar fora do Perfil (local)
changePattern (estável/oscilação/mudança recente/sustentada/insuficiente) por histórico individual; direção exposta agora é a sustentada; desempate de observações no mesmo dia; instância PolarConnect removida do Perfil. Ver AJUSTE_CLASSIFICACAO_DE_TENDENCIAS.md. Duplicidades Polar/Apple: investigação só de leitura (sem acesso a dados reais).

### 2026-10-10 — Atividades externas × treinos: modalidades oficiais, extras sem contaminar km, correção pelo aluno (local)
Ver ETAPA_ATIVIDADES_EXTERNAS_E_VINCULOS.md e RUNBOOK_CORRECAO_MUSCULACAO_30-09_01-10.md (correção de dados de produção preparada, aguardando autorização).

### 2026-10-10 — Rotina/entrevista/objetivo/relatos (local)
Rotina salva por PUT /me/availability; WA fonte unica; nada regenera treinos entregues; objetivo atual unico; routine_observation/additional_info chegam ao Relator. Ver AJUSTE_ROTINA_ENTREVISTA_E_RELATOS.md.

### 2026-10-11 — Check-in semanal rejeitado pela API (corrigido; 7bfb128)
Desde 07/10 o status do check-in devolvia `additionalActivities` e o app reenviava o resumo inteiro; a API (forbidNonWhitelisted) respondia 400 e a aluna não conseguia gerar o treino. DTO passou a aceitar o campo; o app envia só os 4 números. Teste de regressão com o mesmo ValidationPipe da produção.

### 2026-10-11 — Identidade física: origem do Health Connect, D1 (ambiguidade) e D2 (membros afetados) (bd04b4b, 6ec9fd1)
`observerKeyOf`/`baseProvenanceProfile` reconhecem o canal Health Connect (app de origem + dispositivo gravador quando informado; nunca presume Galaxy Watch). D1: `classify()` não classifica a 2ª observação de um par ambíguo se a outra já conta; D2: a avaliação informa as observações afetadas e os adaptadores (Polar/Wahoo/Apple) e a troca de fonte primária reconciliam só o que mudou. Adaptador Health Connect ainda NÃO implementado.

### 2026-10-12 — Confirmação de atividades ambíguas pelo aluno/treinador (local; sem deploy)
Exceção, não etapa obrigatória: só o par de observações que o sistema não resolveu (identidade `ambiguous`) vira pendência; matched/unique nunca perguntam. Decisão humana gravada em `ActivityLog.physicalIdentityEvidence.humanDecisions` (autor, horário, pares, estado applied/suspended, reversão com quem/quando) — sem tabela nova; a avaliação de identidade lê e preserva (suspende "mesma atividade" se nova evidência objetiva for decisivamente contrária). Aluno: aviso discreto na Home + seção "Atividades para confirmar" no Histórico (só pares recentes; 3+ registros e conjunto misto ficam com o treinador). Treinador: decidir (mesma/outra), reverter e indicadores (`GET /coach/data/identity/quality`). Corrigido junto: conjunto misto (observação ambígua × evento já confirmado) contava duas vezes. Serviço: `IdentityConfirmationService`; modelo puro: `physical-identity-pending.ts`/`physical-identity-decisions.ts`.

### 2026-10-12 — Confirmação de atividades: verificação final (efeito não concluído, reversão com feedback, conferência visual) (local; sem deploy)
Decisão humana ganhou o carimbo `processedAt` (gravado só depois de identidade + reconciliação concluírem); sem ele a resposta fica "em atualização" e é reprocessada sozinha na próxima leitura (Home/Histórico do aluno ou lista do treinador), de forma idempotente; resposta repetida do mesmo tipo reaproveita a decisão. O app distingue "aguardando resposta" de "atualizando" e nunca diz que atualizou quando `applied=false`. Reversão de "atividades diferentes" é BLOQUEADA (409, nada alterado) quando as duas execuções têm registro do aluno (feedback na sessão prescrita, sessão materializada ou decisão manual) — evita dupla contagem silenciosa; com só uma protegida, a outra volta a ficar preservada sem contar. Interface conferida localmente (375 e 320 px); distância passou a 2 casas.

### 2026-10-11 — Integração Health Connect (Android): implementada e testada em ambiente sintético; validação física pendente (local; sem deploy)
Canal de entrada de atividades no Android (`react-native-health-connect@3.5.3` + `expo-health-connect`; minSdk 24→26; só leitura de sessões de exercício, distância e FC). App: card em Dispositivos e integrações (Conectar / Sincronizar agora / Desconectar, 7 estados, última sincronização) + sincronização automática ao abrir (mín. 15 min, só se já autorizado, sem segundo plano). API: `POST /health-connect/exercises` (JWT) → `RawExternalActivity`/`ActivityLog` reaproveitando identidade física, vínculo/classificação e confirmação humana existentes (sem lógica nova de dedup; sem mudança de schema). Origem preservada em camadas (canal × app de origem × dispositivo × método de gravação); nada presumido (Samsung/Polar). Contrato completo e tabela implementação × validação física em `HEALTH_CONNECT_CONTRATO.md`. **Pendente:** novo build Android (versionCode 11+), validação em aparelho real (Polar Flow, Samsung Health, revogação Android 14+) e formulário de declaração do Health Connect na Play Console (manual do Elton). Nada foi publicado na Play nem feito deploy.

### 2026-10-11 — Health Connect: build 11 enviado ao teste fechado (alpha) e em revisão do Google
API com deploy feito (endpoint `/health-connect/exercises` responde 401 sem login). Build Android versionCode 11 gerado no EAS e enviado à faixa alpha junto com a declaração de Apps de saúde (atividade/condicionamento; READ_EXERCISE, READ_DISTANCE, READ_HEART_RATE). Decisão do Elton: deixar chegar às testadoras e aguardar relatos de uso real. Validação física (Polar Flow, Samsung Health, revogação no Android 14+) segue pendente e depende desses relatos. Gatilho de revisão: primeiro relato de duplicidade, atividade ausente ou erro de sincronização.

### 2026-10-11 — Exclusão de conta pelo aluno dentro do app (implementada, SEM commit/deploy; aguardando revisão)
Exigência da Apple (5.1.1(v)). API: `GET /me/account/deletion-info` e `POST /me/account/delete` (JWT, limite 5/min, id sempre do token) reutilizando o motor existente (tombstone R2 de 365 dias antes de apagar, anonimização irreversível, transação única). Exige senha atual (403, não 401) + frase EXCLUIR CONTA. **Não bloqueia por assinatura**: consulta a situação real no Asaas (`getSubscriptionExposure`) e, havendo cobrança possível (ativa ou incerta) ou assinatura de loja, exige escolha explícita — cancelar no Asaas junto (a pedido do aluno; se o Asaas falhar, 502 e nada é excluído) ou seguir ciente (o treinador recebe aviso Telegram sem dado pessoal). Loja (Google Play): só orientação de como cancelar. Rota do admin mantém a trava. **Defeitos corrigidos junto**: webhook Asaas/RevenueCat e cron diário reprocessavam conta excluída (reativavam status, geravam notificação/e-mail/treino/Meta); agora só registram o financeiro anônimo e alertam. Conta excluída passa a `subscriptionStatus='canceled'` (não conta como assinante) com transição registrada. App: `src/accountDeletion/` (lógica pura + seção em Privacidade e dados). Rascunho da política das lojas atualizado (seção 13). Política canônica `/politica-privacidade` ainda descreve só exclusão por e-mail (a unificar após aprovação). Pendências de decisão: IA, terceiros, retenção e transferências internacionais antes de publicar.
- **Endurecimento (11/10/2026, mesma entrega):** cancelamento no Asaas só vale com confirmação efetiva (`deleted=true` ou nova consulta mostrando não-ativa; senão 502 e conta intacta); seguir sem cancelar exige aceite específico (`chargesAcknowledged`, exigido pelo servidor também); falha local depois do cancelamento confirmado não é reportada como falha de cancelamento. Validação manual local: `tools/validacao-exclusao-iphone/LEIA-ME.md` (API real + banco `_test` local, Asaas/R2 simulados por cenário).
- **Cobranças já emitidas (Asaas) — verificado na documentação oficial em 11/10/2026:** remover a assinatura (DELETE) encerra a recorrência E exclui as cobranças pendentes/vencidas dela (as já pagas permanecem); suspender (INACTIVE) NÃO remove as existentes, e o Asaas gera a próxima cobrança com antecedência. Consequência no código: "assinatura não ativa" deixou de significar "sem cobrança" — `getSubscriptionExposure` agora também consulta cobranças PENDING/OVERDUE (`pendingCharges: yes/no/unknown`; falha de consulta = unknown) e trata 404 como assinatura removida; a tela avisa antes da confirmação e o cancelamento só é aceito com confirmação efetiva (`deleted=true`, reconsulta não-ativa ou 404). Texto da tela Privacidade e dados corrigido (não diz mais que a exclusão é manual). Não verificado: formato exato do corpo do DELETE no ambiente real do Asaas (o código tolera as variações acima).

### 2026-10-11 — Pagamento no iOS por In-App Purchase (RevenueCat), SEM commit/deploy/build (aguardando configuração externa)
Decisão do Elton: iOS = IAP da Apple; Android e web/PWA seguem no Asaas. Reaproveitado o RevenueCat já existente (webhook provider-agnóstico, idempotente, separado do Asaas). Novo: chave iOS por plataforma (`extra.revenueCatIosApiKey`, vazia até o Elton fornecer), "Restaurar compras", preço real da loja, CPF oculto no app nativo, aviso de renovação automática + links (Apple 3.1.2), `POST /billing/store/sync` (valida no RevenueCat com `REVENUECAT_SECRET_API_KEY`, só no servidor; nunca rebaixa Asaas/grant manual), tratamento de TRANSFER (restauração em outra conta) e orientação de cancelamento pela loja certa na exclusão de conta. Pendente: App Store Connect (acordo de apps pagos, produto de assinatura), RevenueCat (app Apple, chave .p8, offering, chave iOS pública e chave secreta no EasyPanel), build/deploy.

### 2026-10-12 — Ajustes finais para a App Store v1.0 (implementado, SEM commit/deploy/build)
iPad removido (`supportsTablet:false`); cadastros do app iPhone não vão à Meta (cabeçalho `X-Client-Platform: ios-app` no build 6 + dedução por user agent para o build 5; site/Android inalterados); Polar não armazena amostras de localização/GPS (filtro por tipo e por conteúdo); cancelamento: assinante da loja (`storeManaged`) abre a gestão da Apple/Google e o servidor recusa `/billing/cancel` para eles; texto do Asaas e histórico de faturas ocultos no iPhone; link "Ver assinatura pela App Store" (com aviso de segunda cobrança) para a revisão testar a oferta sem trocar a conta de demonstração; política única na URL oficial `/politica-privacidade` (rascunho antigo redireciona); aviso interno de pagamento da loja agora R$ 19,90. Ordem: deploy da API → build 6 → selecionar build 6 na versão 1.0.

### 2026-10-13 — Medalhas de volume: contagem canônica e reconciliação em produção (commits 9eb8b76 e 5ac409a; já em produção)
Passagem técnica recebida do Elton (trabalho feito em outra sessão). **Causa:** medalhas semanais, mensais e de sustentação somavam as séries `corrida` e `esteira`; a mesma atividade importada podia entrar duas vezes. **Correção:** `getRunSeries()` (evolution-metric.service.ts) reúne corrida+esteira numa série canônica, com precisão de km antes de comparar com o limiar; períodos com identidade/vínculo ambíguo são sinalizados e não concedem medalha sozinhos. `volume-reconciliation.ts` planeja `keep/create/update/retract/review`; `reconcile-volume.cli.ts` roda em prévia por padrão e só aplica com hash do plano + confirmação de backup. **Produção:** backup criptografado enviado ao R2 antes (13/10/2026 ~17:11 UTC, 4.909.800 bytes; **restauração não testada**); prévia em 74 contas; 136 ações aplicadas em transações por usuário (4 retratadas sem exclusão: evidência original fica em `UserAchievement.evidence._volumeReconciliation`); após o segundo commit, nova prévia: 191 manter, 0 criar/atualizar/retratar, **15 review**. **Pendente:** as 15 ações `review` ficaram intactas (período, versão ou evidência não permitem decisão automática segura — não são 15 medalhas inválidas); recomendado acrescentar ao CLI um diagnóstico por usuário/código/período sem dados sensíveis. **Não** usar `/me/medals` como consulta diagnóstica (pode avaliar e persistir). Escopo: só volume semanal/mensal/sustentação; distância única, acumulada e outras categorias não foram alteradas.

### 2026-10-14 — Meta de prova: aviso no Telegram + Prontuário em TODA meta nova, e erros claros no app (implementado, SEM commit/deploy/build)
Caso da aluna Thalita: "Nao consegui salvar essa meta." sem explicação. **Causa do texto genérico:** o servidor recusa por validação devolvendo uma LISTA de mensagens (ex.: `targetSeconds must not be greater than 172800`) e o app só mostrava o texto do servidor quando vinha como string simples. Causa mais provável da recusa: tempo-alvo > 48 h (minutos digitados no campo de horas); não confirmado (sem acesso a logs/banco de produção). **Mudanças:** (1) `POST /me/target-races`: toda meta criada agora SEMPRE envia UMA mensagem ao Telegram (com contexto 1–10 e, se houver, motivos de risco na mesma mensagem) e grava um evento `TARGET_RACE_REGISTERED` no Prontuário (fato estruturado, sem IA); falha de qualquer um não derruba o cadastro; edição de data/distância mantém o alerta só-de-risco. (2) App: valida o tempo-alvo antes de enviar (máx. 48 h, min/seg ≤ 59, inteiros) e traduz a recusa do servidor em frase clara (`src/targetRace/messages.ts`). Não coberto: edição de status e remoção de meta (sem aviso). Ambiente local: `node_modules` do clone com link de `@nestjs/platform-express` quebrado para o Node do Windows (reinstalação de 13/10) — impede `app-boot` e a API local de teste; produção (Docker) não é afetada.

### 2026-10-14 — Metas de prova: editar, reabrir, remover com confirmação e avisos/Prontuário em toda alteração (etapa 2; implementado, SEM commit/deploy/build)
Sequência do commit 261af5c. **Servidor:** `PATCH /me/target-races/:id` agora avisa o treinador (Telegram, uma mensagem com "campo: antes -> depois"; "Status ... alterado" quando muda o status; motivos de risco só se data/distância mudaram) e grava `TARGET_RACE_CHANGED` no Prontuário; reenvio sem mudança não avisa. `DELETE` avisa e grava `TARGET_RACE_REMOVED` (a linha do Prontuário permanece após apagar a meta). Falhas de aviso/Prontuário nunca desfazem a ação; a aluna não recebe mensagem. **App:** botões Editar (mesmo formulário preenchido; salva por PATCH; campo apagado vai como null), Reabrir (para metas concluídas/arquivadas) e Remover com confirmação (window.confirm na web, Alert no celular). Não cobre: arquivamento automático por data vencida (feito pelo sistema, sem aviso). Depende de build novo para as alunas verem Editar/Reabrir; o aviso/Prontuário só dependem do deploy da API.

### 2026-10-14 — Aba Conta: data de nascimento sem o dia a menos + "Excluir conta" dentro da aba (implementado, SEM commit/build)
"Nascimento" em Meus dados lia a data com getters do fuso do aparelho (`formatFullDate(new Date(...))`); como a data é guardada como meia-noite UTC, no Brasil (UTC-3) aparecia o dia anterior, divergindo do campo de edição (que já lia em UTC). Agora usa `formatDateFromApi` (UTC). O dado salvo nunca esteve errado. Também: `DeleteAccountSection` agora aparece na aba Conta logo após "Sair da conta" (além de Privacidade e dados), pois foi onde a revisão da Apple procurou. Só chega às alunas com build novo.

### 2026-10-14 — Indicadores de cansaço/resposta pós-treino paravam em 01/10 (feedback V3 descartado pelo leitor) — corrigido no servidor (SEM commit/deploy)
**Causa confirmada:** `ObservationReaderService` só emite observação quando `completion.feedbackVersion` está listado em `VARIABLE_REGISTRY[...].versions`. O feedback V3 (01/10/2026) só trocou a pergunta 12 (`executionVsPrescribed` → `executionBehavior`); `WorkoutCompletionsService` grava no V3 as mesmas colunas do V2. Mas as variáveis `workout.*` só declaravam as versões 1 e 2 (apenas `executionBehavior` tinha a 3) — todo completion V3 era descartado (`if (!spec) continue`). Estresse (tabela própria `StressCheckin`) e ritmo (atividades) não passam por esse casamento, por isso seguiam até 14/10 e 13/10. **Correção:** versão 3 declarada, idêntica à 2, em 15 variáveis `workout.*` (exceto `executionVsPrescribed`, congelada, e `sleepScheduleIrregularity`, substituída). Textos interpretativos usam a mesma série (`GET /me/observations/:variableId`, consumo puro no app), então PWA e iOS corrigem só com o deploy da API, sem build. Nenhum dado do banco alterado. Sobreposição de datas nos gráficos: tarefa separada (não feita).

**2026-10-15** — Correção de vínculo × análises derivadas (lotes 1 e 2, só local, sem commit/deploy). Achado: nenhuma correção
de vínculo (vincular/desvincular/confirmar) recalculava `SessionExecutionAnalysis`, e os leitores (variáveis `execution.*`,
Analista, relatório da sessão) usavam a linha antiga como evidência atual. Feito: (1) defesa de leitura fail-closed em
`analysis-validity.ts` (linha cujo vínculo ativo atual diverge é descartada, nunca apagada); (2) `recomputeAfterCorrection` em
`SessionExecutionLinkService`, chamado fora da transação após cada correção humana (inclui confirmação de identidade);
reanalisa as sessões afetadas pelo próprio histórico de vínculos, não grava "não feita" para sessão sem feedback e sem
vínculo, marca como `stale` só o retrato vivo do Analista e nunca toca retratos entregues, vínculos, classificação, aderência
nem RPE. Falha de recálculo é logada (erro) e não desfaz a decisão do aluno. Pendente (não autorizado): `forDayRegeneration`
e `WeeklyExecutionReport` reutilizam retrato entregue anterior à correção (opção A aprovada, recalcular só para leitura com
rastreio da evidência corrigida); pergunta de atribuição do feedback no app (próximo build); filtrar/exibir `stale` em
`TrainingAnalystService.read` (painel).

**2026-10-15 (lote 3, só local, sem commit/deploy)** — Regeneração de um dia após correção de vínculo. `forDayRegeneration` agora compara o
retrato entregue (`TrainingAnalysis` week/longitudinal, histórico intacto) com o histórico de vínculos: se um vínculo que o retrato toca
(sessões/atividades da evidência) foi criado/revogado depois dele, a evidência é **recalculada só para leitura** (`recomputeForRead`:
mesma semana do programa, semana anterior vinda do `WeeklyExecutionReport` entregue, `buildForGeneration(..., {persist:false})`) e o
Prescritor recebe um aviso `correcaoDeVinculo`. Fail-closed: se o recálculo ou a verificação falhar, o retrato antigo é retirado (nada
obsoleto segue). O pacote de evidências ganhou o item `training_analysis_correction` (correções consideradas, o que segue na evidência
atual e o que saiu, e se foi recalculada). `TrainingAnalystService.read` anota cada linha com `atualidade` (`atual`,
`desatualizada_por_correcao_de_vinculo`, `retrato_entregue` + `correcoesPosteriores`, `invalidada`) sem esconder nada. Prompts de sistema
inalterados (congelados por hash). Testes de integração com banco não executados: não há PostgreSQL de teste isolado nesta máquina.
Dois testes preexistentes seguem vermelhos e fora de escopo: `legal-content.spec.ts` (texto de `App.tsx`) e `analytics-instrumentation.spec.ts`
(exports ausentes em billing/funnel).

**2026-10-15 (etapas 1–3 do plano de medalhas/correções, só local, sem commit/deploy)** — (1) `isAwardRevoked` (volume-reconciliation.ts) é a leitura
única do estado de uma medalha (marcador de retração de volume, e no futuro a coluna `status`); telas, progresso e reconciliação usam só ela.
(2) `recomputeAfterCorrection` virou o ponto central (agora com `activityLogIds`, `sessionIds`, `forceSessionIds`) e `analysis-recompute.ts`
refaz as análises deterministas das sessões afetadas: as mais recentes na hora (25), o resto em segundo plano; falha vai para nova tentativa;
a leitura descarta linha obsoleta e agenda a recuperação (intervalo mínimo de 60 s por aluno); sessão sem feedback e sem vínculo nunca ganha linha
"sem registro". Fluxos do treinador ligados: reclassify, reconcile-history (aplicado), primary-source, evaluate-identity (só se
`affectedActivityLogIds` ≠ vazio — `evaluateUserHistory` agora devolve esse campo) e edição material de treino (force). Nenhum deles gera treino.
(3) `medal-award-decision.ts`: função pura `planAwardReevaluation` (keep/create/adjust/revoke/reactivate/review por semântica de categoria,
versão da regra, incerteza e escopo da correção); NÃO está ligada a nenhum fluxo e `allowRevocation` é falso por padrão (só recomenda 'review').
Ordem pós-correção prevista (etapas 6–7, ainda não feitas): grava a decisão → marca reavaliação pendente → tenta reavaliar medalhas na própria
requisição (usa só vínculos/feedbacks já gravados, não depende das análises) e recalcula análises em paralelo (massa em segundo plano) → limpa o
marcador se nada mais recente → leituras de medalhas concluem a pendência antes de responder. Pendente por decisão do treinador: evento
EXECUTION_LINK_CORRECTED (inclui edição de treino com feedback), medalhas na exclusão de dados de provedor (ausência de dado ≠ prova), histórico de
transições e migrações (etapas 4–11 não autorizadas).

**2026-10-15 (etapas 4–11 do plano de correções/medalhas, só local, sem commit/deploy/migração aplicada)** — Sistema de correções concluído e integrado.
(a) **Migração** `20261015120000_medal_award_transitions_and_pending_reevaluation` (aditiva): colunas `status/statusChangedAt/revokedAt/revokedReason` em
`UserAchievement`, tabelas `UserAchievementTransition` (histórico append-only: granted/revoked/reactivated/adjusted, com motivo, causa, antes/depois e versão da regra) e
`CorrectionReevaluation` (pendência durável por aluno: sessões de análise + escopo de medalhas, versão, lease, tentativas); conversão idempotente das retrações de volume
antigas (marcador mantido). **Não foi executada em banco algum** (validada só estruturalmente: `prisma validate`, `prisma migrate diff` e teste do arquivo).
(b) **Medalhas**: `planAwardReevaluation` (decisão pura, por semântica de categoria, versão da regra e incerteza) + `applyAwardActions` (transacional, trava por aluno,
CAS contra mudança no meio) + `MedalEvaluationService.reevaluateForPending`; só categorias afetadas; revoga só quando o critério deixa de ser atendido; mantém/ajusta quando
outro treino/período/sequência comprova; reativa na mesma linha; exclusão de dados do provedor nunca revoga/ajusta (ausência ≠ prova). `GET /me/medals` ganhou `revoked` e
`pending`; novos `GET /me/medals/revoked` e `/history`.
(c) **Pendência durável** (sem fila em memória): ordem = correção gravada → ganchos marcam (`markPending`) → `processPendingReevaluation` (lease por CAS; só remove a linha se
nenhuma marcação nova chegou) → leitura conclui pendência antes de responder (`settlePendingReevaluation`) ou devolve dado PROVISÓRIO; varredor a cada 2 min retoma o resto
(inclusive após reinício). Nunca gera treino.
(d) **Prontuário**: evento `EXECUTION_LINK_CORRECTED` (quem/quando/o que mudou/o que passa a valer/refs; resumo em massa; edição de treino pelo treinador com feedback);
só com mudança efetiva; nunca para exclusão de dados; sem medalhas. (e) **Prompts** (consciente, hash-test atualizado): `LINK_CORRECTION_INSTRUCTION` nos 3 prompts do
Prescritor e bloco no Condensador do Prontuário. (f) **App**: MedalsScreen com conquistadas/reativadas/revogadas (motivo)/em atualização + histórico; cartão do relatório de
treino "em atualização" (`sessionReportsUpdating`). (g) Fluxos do treinador e exclusão de dados do provedor ligados ao ponto central; CLI de volume grava status/transições.
**Falhas preexistentes mantidas, fora de escopo:** `legal-content.spec.ts` e `analytics-instrumentation.spec.ts`; `ios-store-compliance.spec.ts` é instável por tempo sob carga
(passa isolado).

### 2026-10-14 — Correções de atividades/medalhas: validação em PostgreSQL real e UI (pronta para publicar; NÃO publicada)
Validado em PostgreSQL 17 descartável (127.0.0.1, bancos `_test`, sem produção): migração `20261015120000_medal_award_transitions_and_pending_reevaluation` aplica limpa, converte medalhas antigas retratadas para revogadas (uma transição cada), idempotente. Teste de integração `correction-medals.int.spec.ts` (3 testes) cobre concessão/revogação/reativação com histórico, correção sem gerar programa novo, pendência durável após reinício e concorrência; 12 suítes de integração existentes verdes. Tela de conquistas verificada no PWA local (conquistadas, reativada, em atualização, revogadas com motivo, histórico). PWA: service worker network-first/no-store, reabrir basta (não testado em iPhone real). Typecheck API e mobile verdes. Pendente: autorização de Elton para push, deploy da API (roda a migração) e do PWA; builds nativos depois.

### 2026-10-15 — Revitalização do painel admin, Fases 0 a 7 implementadas (local; verificar e publicar por lote)
Plano em `PLANO_REVITALIZACAO_ADMIN.md`; números auditados em `DICIONARIO_METRICAS_ADMIN.md`. Decisões de Elton: um único usuário (papéis = formas de ver os mesmos dados); estrutura de código/dados não muda, só o layout; exportação sempre anônima (código, idade, sexo, altura, peso); acesso do painel pelo celular fica por ÚLTIMO (Trilha A, não feita).
**Feito:** (0) escala única `--escala` 0.88, tema claro/escuro (inversão provisória), seletor de visão, menu por áreas, tela Ferramentas, abas da aluna em largura total; (1) população única das métricas sem arquivadas (`STUDENT_METRICS_POPULATION`); causa das divergências: Financeiro contava arquivadas; (2) calendário de vencimentos (`GET /coach/finance/due-dates`), números clicáveis, recebido contra projetado; (3) aba Avaliação refeita e lista de alunas; (4) Evolução: seções antigas de estado/experiência e Explorar relações saíram, grade com gráficos abertos, Intelligence embutido (volume, sono, RPE), variação semanal à vista, nomes em português, Timeline e Contexto dentro da Evolução, exportação anônima (`ti/anonymous-export.ts`), Training Intelligence fora do menu (código mantido); (5) funil de pessoas lido do banco (`GET /coach/funnel/people`) — o funil por eventos conta sessões e "Iniciou entrevista"/"Pagou" não são confiáveis; (6) tela "Programas e IA" (`GET /coach/ai/overview`); (7) panorama do negócio no topo da Visão geral.
**Pendente:** conferir cada tela no `.bat` e relatar problemas; confirmar no banco que as divergências eram contas arquivadas; Trilha A (admin online para o celular, risco alto: autenticação); valores categóricos em inglês no Intelligence ("none"); limites de "atenção" são de Elton e ainda não existem na interface.

### 2026-10-15 — Ajustes após a primeira conferência de Elton (admin)
Gráficos de Evolução de alunos e Receita viraram colunas lado a lado; tema escuro refeito (inversão exata, fundo azul-marinho, cards grafite, detalhes neon ciano); aba "Provas e objetivos" por aluna (Prova alvo saiu do Cadastro); submenu em Prospectos (Geral, Só acessaram, Cadastraram, Responderam as perguntas iniciais, Cobrança gerada e não pagou) com colunas diárias, média móvel de 7 e 21 dias e faixa habitual (percentis 25–75 da janela) via `GET /coach/prospects/series`; Avaliação com cabeçalhos coloridos e ícones. Build do admin passou a ser o gate (`next build` roda ESLint; só `tsc` não basta).
**Pendente (pedido de Elton):** quando houver reavaliação, gráfico comparativo (inicial contra reavaliação) para as notas de autoavaliação, peso, distância corrida e pace confortável.

### 2026-10-18 — Assinatura da loja (Apple/Google) vencida continuava "Ativa" (corrigido localmente; NÃO publicado; sem deploy)
**Causa:** o servidor só consultava o RevenueCat na compra/restauração; `GET /billing/me` e o botão "Atualizar situação" só liam o status salvo, e o webhook (EXPIRATION/CANCELLATION) não chegou. **Correção:** `GET /billing/me` reconcilia contas da loja (`reconcileStoreSubscription`, respeita `expires_date`/tolerância de cobrança), com controle de frequência (60 s automático, 10 s no botão `?force=1`); app reconcilia ao abrir e ao voltar ao primeiro plano (máx. 1 vez/5 min); cron próprio a cada 6 h (`refreshAllStoreSubscriptions`), separado do Asaas. Falha de consulta preserva o estado, sinaliza `syncError` e registra log; ausência de assinatura NÃO é expiração (só revoga quando a origem de uma transferência pede). Telas distinguem ativa / renovação cancelada com acesso vigente / assinatura expirada. Grants manuais e override continuam protegidos. **Testes:** `store-subscription-reconcile.spec.ts` (12). **Falhas já existentes, fora deste escopo:** `legal-content.spec.ts` (PolarConnect na tela Privacidade) e `analytics-instrumentation.spec.ts` (exports ausentes no HEAD).

**Complemento 18/10/2026 (local; NÃO publicado):** (1) tolerância de cobrança não conta como pagamento (pendente segue pendente), chave `REVENUECAT_SECRET_API_KEY` ausente e data de expiração inválida viram falha de sincronização (estado preservado), sync pós-compra do app só conta sucesso com HTTP 2xx; (2) conta da loja cancelada com assinatura vigente confirmada pelo RevenueCat volta a ativa por RENEWAL, na leitura e na rotina de 6 h (nunca Asaas, grant manual, override ou quem não foi da loja); (3) webhook EXPIRATION só revoga se a loja confirmar a expiração — vigente, tolerância, ausência ou falha de consulta preservam o estado e a rotina reconcilia depois; REFUND inalterado. (4) recuperação automática (leitura, rotina de 6 h e consulta ao abrir/voltar do app com `?auto=1`) NÃO dispara "Pagamento recebido" nem e-mail de confirmação (evento interno `reconciliation_recovery`); compra/restauração explícita e eventos do webhook continuam notificando. Testes: `store-subscription-reconcile.spec.ts` (31).

### 2026-10-18 — Assinatura da loja: a Apple passa a confirmar a expiração (local; NÃO publicado até o commit)
Caso real: aluno de teste cancelou na Apple, mas o RevenueCat seguiu "ativa/renova" (cancelamento nunca chegou a ele), e o Panzeri Run repetia o RevenueCat. Agora, com as variáveis `APPLE_IAP_KEY_ID`, `APPLE_IAP_ISSUER_ID`, `APPLE_IAP_PRIVATE_KEY` e `APPLE_BUNDLE_ID` no servidor, a reconciliação (leitura de `/billing/me`, rotina de 6 h e checagem do webhook EXPIRATION) consulta a App Store Server API (`apple-store-status.ts`): Apple confirmando expirada/revogada encerra o acesso mesmo com o RevenueCat vigente. A Apple só confirma expiração; nunca concede acesso; falha/404/resposta vazia preserva o resultado do RevenueCat. Sem as variáveis, comportamento anterior. Testes: `apple-store-status.spec.ts` (10).

### 2026-10-18 — Reenvio à Apple (build 8) após rejeição 1.4.1 / 2.1.0 / 5.1.1
Versão 1.0, build 8 (commit 03ed6fe) reenviada às ~20:00 BRT. Conta de revisão: aluno Testando (eltonpanzeripersonal@yahoo.com) com assinatura Sandbox realmente expirada — app mostra "Assinatura expirada" e o painel lista em Ex-alunos ("Assinatura caiu sozinha"). A expiração só foi reconhecida depois da consulta direta à App Store Server API (c926070, 8800aa9); o RevenueCat seguia "ativa" (renovou no Sandbox apesar do cancelamento). Não renovar nem alterar essa conta até a revisão terminar. Correções do item 5.1.1(iv) (botões "Continuar") e 1.4.1 (31 referências verificadas) estão na build 8. Pendências: resultado da revisão; recuperar o eltonpanzeri@gmail.com como cortesia segue como está.

### 2026-10-19 — Central Universal de Integrações: arquitetura e Passos 1, 2 e 2b (Zepp/Amazfit)
**Objetivo (decisão de Elton):** uma central única de integrações para receber treinos hoje e, no futuro, dados de saúde (sono, FC de repouso, passos), sem reconstruir o Panzeri Run. **Decisões:** só provedores NOVOS usam a estrutura genérica (Polar, Wahoo, Strava, Apple Health e Health Connect NÃO migram e o registro recusa esses ids); capacidades do conector são opcionais; o pipeline `RawExternalActivity → ActivityLog → identidade física → vínculo com a prescrição`, a deduplicação e a exclusão por provedor ficam intactos; nada de dado da Zepp é recebido antes da resposta oficial da Zepp.

**Arquitetura (código em `apps/api/src/provider-hub/` e `apps/api/src/zepp/`):**
- `ProviderConnector` (contrato com capacidades opcionais: `consent`, `oauth`, `webhook`, `events`, `sync`, `revocation`, `dataDeletion`) e `ConnectorRegistry` (recusa ids legados, id repetido, webhook sem `events`, OAuth sem documento de consentimento, grupo com categoria não declarada).
- **Passo 1 — fila de eventos** (`ProviderInboundEvent`): idempotente por `(provider, dedupeKey)`, reivindicação atômica com trava (lease), cerca por tentativa, espera crescente (30 s até 6 h), 8 tentativas e depois `dead`, payload zerado ao concluir/descartar, limpeza (concluídos 7 dias, `dead` 30). Rotina de processamento (`ProviderHubWorkerService`) **desligada por padrão** (`PROVIDER_HUB_WORKER_ENABLED=true` liga).
- **Passo 2 — conexão genérica** (`ProviderConnection`, `ProviderOAuthAttempt`, `ProviderConnectionService`): `state` de uso único (só o hash no banco), tokens cifrados com AES-256-GCM e chave PRÓPRIA do provedor, renovação serializada por lease, uma conta externa só liga a um usuário, desconexão encerra o lado local primeiro (tokens apagados, eventos pendentes descartados) e só depois avisa o provedor, exclusão de dados exige estar desconectado, auditoria em `ProviderConnectionEvent` sem token. Exclusão de conta encerra as conexões e apaga as tabelas novas; as tabelas de token/state não entram nos dumps de backup.
- **Passo 2b — consentimento aplicado:** o conector serve o texto (versão, seções, grupos, finalidades). O pedido de conexão só vale com aceite expresso (`acknowledged === true`), versão e hash do texto exibido (texto desatualizado ⇒ 409) e grupos coerentes (obrigatório presente; GPS exige atividades). A conexão guarda categorias, finalidades, versão, hash e data. **A Zepp não tem escopos por categoria, então a restrição é aplicada no Panzeri Run:** `getAccessToken(provider, userId, categoria)` e a fila (`ProviderInboundEvent.category`) consultam `ProviderConsentService` a cada uso (desconectado, categoria ou finalidade fora do consentido ⇒ negado); `ProviderConsentService` e `ProviderConnectionService` são os únicos que leem `providerConnection`. Teste fixa que só eles leem a tabela.
- **Zepp/Amazfit** (`src/zepp/`): OAuth conforme a documentação oficial (autorização em `user.zepp.com/oauth2/index.html`, sem `scope` e sem PKCE; troca em `auth.zepp.com/v2/oauth2/access_token`; renovação com o REFRESH token no Bearer; revogação em `api-open.zepp.com/users/-/thirdparty/unauthorize`). Conector declara só `consent`, `oauth` e `revocation`: SEM webhook, eventos, sync, FIT, sono ou saúde. Rotas `/zepp/{consent,connect,status,disconnect,data,callback}`; as autenticadas exigem JWT + papel coach/admin e a porta `ZEPP_ENABLED_USER_IDS` (fail-closed). A conta conectada é sempre a do usuário logado.
- **Minuta de consentimento 1.0 (19/10/2026)** em `src/zepp/zepp-consent.ts`: 4 grupos (Dados básicos da conta — obrigatório; Atividades físicas; Percursos e GPS — depende de atividades; Sono e recuperação — sono e FC de repouso). Finalidades: histórico, acompanhamento, comparação com treinos prescritos, indicadores, visão do treinador. **IA, treinamento de modelos e qualquer outro uso NÃO estão autorizados** (teste fixa a lista). **A minuta NÃO é documento juridicamente aprovado:** precisa de revisão jurídica (LGPD: controlador, contato do titular, retenção, compartilhamentos) antes de qualquer aluno.
- **Página temporária de teste** no painel admin (Ferramentas): `apps/admin/app/zepp-test-panel.tsx`; usa só as rotas genéricas, mostra texto, grupos, aceite, status, conta mascarada, categorias, data, últimos eventos, desconectar e excluir dados. Para remover: apagar o arquivo e a linha `<ZeppTestPanel />` em `page.tsx`.

**Migrations:** `20261019180000_provider_inbound_event` e `20261019210000_provider_connection` — **aplicadas e verificadas em produção por Elton (19/10/2026)**, tabelas acessíveis e vazias, sem rollback. `20261019230000_consent_enforcement` (3 colunas nuláveis: `ProviderConnection.consentTextHash`, `ProviderConnection.grantedPurposes`, `ProviderInboundEvent.category`) — **preparada, validada só localmente, NÃO aplicada em produção**.

**Estado por camada (19/10/2026):**
- *Verificado em produção:* Passo 1 e Passo 2 publicados; API no ar; rotas `/zepp/*` respondem (401 sem login; callback sem `state` ⇒ 400); `PROVIDER_HUB_WORKER_ENABLED` ausente (rotina desligada); integrações existentes respondendo às verificações de autenticação.
- *Implementado e testado só localmente (SEM commit/deploy):* Passo 2b (consentimento aplicado, colunas novas, restrição a coach/admin, página de teste). Testes: 430 aprovados em 25 suítes (provider-hub, conexão, Zepp, DI, exclusão de conta, backup, Polar, Wahoo, Strava, Apple Health, Health Connect, schema de raciocínio da IA); `tsc --noEmit` da API e do admin; `next build` do admin em cópia isolada. Não rodei a suíte completa nem o teste de integração de backup (precisa de banco).
- *NÃO validado:* conexão com uma conta Amazfit REAL (nunca testada); formato de erro dos endpoints de token da Zepp; nome do campo de validade na renovação (só `expires_in` é aceito; ausente ⇒ validade de 10 min); se erro pode vir com HTTP 200; a página de teste não foi vista em navegador real; a injeção de dependências do `AccountDeletionModule` não é testável em teste isolado (estouro de pilha já existente, não causado por estas mudanças).

**Limitações / pendências:** (1) a restrição por categoria vale no acesso a token e na fila; **filtro por CAMPO do payload (ex.: descartar GPS de um FIT quando "Percursos e GPS" não foi autorizado) ainda não existe** e só poderá ser escrito junto com a importação, depois de a Zepp confirmar contrato, campos e transporte; (2) respostas oficiais da Zepp pendentes: FIT atual × APIs legadas, campos autorizados, autenticação do webhook, retenção, treinador e IA, limites e profundidade de histórico; (3) revisão jurídica do consentimento; (4) Zepp ainda não aparece no catálogo "Dispositivos e integrações" nem no app (precisa de atualização do app); (5) filtro de eventos só vale para conectores com documento de consentimento.

**Próximos passos para a primeira conexão real:** aplicar a migration `20261019230000` em produção (com autorização), cadastrar o redirect no console da Zepp, criar as variáveis `ZEPP_*` no EasyPanel, deploy, abrir Ferramentas no painel e executar o procedimento de teste; depois aguardar a resposta da Zepp antes de qualquer recebimento de dados.

### 2026-10-19 — Central Universal, Lote 1: elegibilidade de dados para IA + consentimento 1.1 (local; SEM commit/deploy; migration NAO aplicada)
**Contexto:** a Zepp (Jeff Fu) respondeu oficialmente: usar Activity Events (webhook `text/plain`, array de strings JSON; `summaryId` estável = idempotência; **sem HMAC/IP allowlist**), download do FIT com Bearer do aluno (URL de 24 h, uso único), Backfill API (30 dias, 50 req/h, volta pelo mesmo webhook), Workout API; **não usar** APIs legadas; FIT pode conter FC/cadência/elevação/potência ("campos autorizados" — confirmar por escrito); sono via Sleep Events (`summaryId` pode ser nulo); **FC de repouso não existe hoje** (Daily Events indisponíveis); **enviar dado Zepp a provedor externo de IA exige atualizar as informações de privacidade e contatar a Zepp antes.** Decisão de Elton: o Atlas (agentes de IA) faz parte da primeira entrega, mas o envio real de dados Zepp à Anthropic fica BLOQUEADO até regularizar.

**Decisões de produto (Elton):** não armazenar o FIT original (só dados extraídos, autorizados e normalizados); backfill inicial de até 30 dias só com autorização do aluno; GPS e sensores só com permissão efetiva; sem APIs legadas; arquitetura universal (sem regra exclusiva da Zepp); integrações atuais não mudam de comportamento.

**Implementado (código em `apps/api/src/ai-governance/` e pontos de leitura):**
- `AiDataEligibility` — decisão por (usuário, provedor, categoria, destino `external_ai`/`internal_ai`). Provedores **legados** (Polar, Wahoo, Strava, Apple Health, Health Connect) = elegíveis como antes. Provedor da Central: exige conexão ativa + categoria + **finalidade separada** (`ai_external`/`ai_internal`) e, para envio externo, a **trava dupla**: constante `EXTERNAL_AI_APPROVED_PROVIDERS` (hoje **vazia**, alterar exige mudança de código revisada) + variável `<ID>_EXTERNAL_AI_ENABLED`. Provedor desconhecido com histórico no aluno = bloqueado (fail-closed). `scopeFor()` calcula a lista de provedores bloqueados do aluno.
- Escopo de IA por `AsyncLocalStorage` (`ai-scope.ts`): os pontos de entrada que montam contexto para agentes (geração da semana, regeneração de um dia, reavaliação/Agente de Evolução, Gerente Técnico) rodam dentro do escopo; leitores tratam dados de provedor bloqueado como inexistentes. Fora do escopo (telas, painel, medalhas, cálculos internos) nada muda.
- **Antes da escolha da observação canônica:** `evolution-metric` (`fetchRealizedActivities`/`fetchRawSessions`), `observation-reader` (atividade objetiva e análise de execução), `training-analyst` (extras e linhas de análise), `execution-analysis` (visão `forAi`: recalcula a análise SEM o provedor bloqueado e nunca grava; o relatório persistido continua completo, só o que vai ao Prescritor usa a visão para IA). Se a canônica de um evento é de provedor bloqueado, o evento passa a ser representado pela observação elegível (fallback para outra fonte autorizada). Cópias do relógio no feedback do aluno (`classifyMaterializedCompletion`) e sessões sintéticas do relógio (`device_extra`) de provedor bloqueado saem da visão da IA (`ai-session-filter.ts`); o que é do aluno (esforço, dor, notas) permanece.
- **Proteção final:** `AiQueueService.run(task, { agent, deviceData })` é o único portão para a Anthropic (7 chamadas em 4 agentes). `deviceData:true` sem escopo válido, com destino errado, escopo velho (>30 min) ou **consentimento revogado no meio da geração** → `AiEgressBlockedError` ANTES de ocupar vaga/enviar, com auditoria (`ai_egress_blocked`, sem payload). Relator declara `deviceData:false` (teste estrutural prova que não lê dado de dispositivo).
- **Proveniência dos eventos do prontuário:** `StudentProfileEvent.sourceProviders` (migration `20261019240000_ai_governance`, coluna nula). Evento derivado de provedor bloqueado não é condensado nem entregue ao Prescritor (continua visível para pessoas).
- **Consentimento 1.1** (`zepp-consent.ts`, hash muda): sai FC de repouso; entram "Sensores das atividades" (`activity_sensors`) e a seção 2.3 de IA; finalidades OPCIONAIS e separadas: `history_backfill` (30 dias, só ao conectar) e `ai_external` (concedível/revogável depois, sem reconectar, `POST /zepp/purposes`). Conceder IA exige aceite expresso sobre o texto vigente (versão + hash) e é **recusado enquanto o provedor estiver bloqueado**; revogar vale na hora, sem aceite. Página de teste do admin atualizada.
- Registro de conectores recusa OAuth sem documento de consentimento, grupos com categoria não declarada e finalidades opcionais repetidas.

**Biblioteca FIT (avaliada, NÃO instalada no projeto):** escolhida `fit-file-parser` 6.2.2 (MIT, Node ≥ 20 — produção usa Node 22 —, CJS+ESM, 1 dependência, ~140 mil downloads/mês, última versão 11/10/2026, leitura estrita com CRC, GPS já em graus). Validada em pasta temporária com FIT sintético (round-trip e rejeição de arquivo corrompido). Descartada: `@garmin/fitsdk` (licença própria da Garmin: uso interno permitido, redistribuição/uso por terceiros restrito, Garmin pode exigir a versão mais recente e recebe licença ampla sobre feedback).

**Testes (local):** 172 suítes; 169 passam, **2144 testes passam**. **Falhas pré-existentes (não tocam arquivos alterados, já falhavam antes do Lote 1):** `analytics-instrumentation.spec` (exports ausentes em billing/funnel), `correction-pipeline-guards.spec` ("migration mais recente" fixada em 20261015…), `legal-content.spec` (texto do app mobile). Testes novos: `ai-governance`, `ai-scope-seams`, `ai-governance-structure` (estruturais), `provider-purposes`, `training-plans-ai-scope`, mais ajustes em `provider-hub`, `provider-connection`, `zepp-oauth`, `provider-hub-di`. Corrigidos (efeito de mudanças nossas): `declared-reasoning` (schema agora aceita fonte fora da lista e normaliza para "outro") e `prescription-trace` (nova dependência opcional no construtor).

**Limitações / pendências conhecidas:** (1) contagens do check-in semanal confirmadas pelo aluno derivam de vínculos com dispositivo e são tratadas como atestado do aluno (não filtradas); (2) artefatos persistidos derivados de IA (relatório de evolução, resumo do prontuário, instantâneos do Analista, pacotes de evidência) **não são reprocessados** quando a autorização é retirada depois — hoje nada da Zepp pode estar neles (trava), mas **é pré-condição para liberar o envio externo**; (3) provedores legados não têm consentimento de IA por provedor (achado para a revisão jurídica); (4) filtro por CAMPO do payload (ex.: descartar GPS quando "Percursos e GPS" não foi autorizado) será feito junto da ingestão FIT (Lote 3); (5) o envio externo de dados Zepp segue bloqueado: faltam regularização com a Zepp, atualização da política de privacidade, revisão jurídica do consentimento 1.1 e termos de processamento da Anthropic.

**Falta para a primeira corrida Amazfit ser analisada pelo Atlas:** Lote 2 (webhook + fila + download seguro, sem HMAC), Lote 3 (parser FIT, filtro por consentimento, ActivityLog/série temporal com GPS — migration —, entrada no pipeline), Lote 4 (backfill 30 dias e correções), Lote 5 (sono), reprocessamento de artefatos na revogação, liberação formal do provedor (constante + variável) e uma conexão real validada.

### 2026-10-20 — Painel do aluno: calendário em "Semanas anteriores" (Fases 1+2; local, SEM commit/deploy)
- Aba "Semanas anteriores" virou calendário (Mês padrão, Semana, Lista), só leitura, a partir de 01/08/2026. Chips coloridos por status (feito/ajustado/não feito/sem registro/a fazer), coluna de resumo por semana, atividades do relógio fora do programa ("extra"/"a confirmar"). Clique no dia abre os treinos no MESMO cartão da aba Treinos (sem editar/excluir) com prescrito, execução do relógio e resposta da aluna.
- API: `GET /coach/students/:id/calendar?from&to` (máx. 70 dias, corte 01/08/2026), `coach/student-calendar.ts` + `coach/history-session.ts` (mapeamento extraído de `student()`, mesmo formato). Semana segue `selectHistoryWeeks` (mesma regra da IA); status segue a precedência de `EvolutionMetricService.classifySession`; resumo = `summarizeSessions`. Nada escreve, nada chama IA.
- Admin: `app/student-calendar.tsx`, `SessionExecutionPanel` extraído de `EditableSession`, `HistorySessionCard`; clique no calendário de bolinhas da Evolução foca a semana no calendário.
- Pendente: Fase 3 (painel do dia com sub-abas Prescrito x Realizado / Resposta / Análise / Relógio). Gates: tsc api+admin verdes, 18 testes novos, `next build` ok em cópia isolada. Sem migration.

### 2026-10-20 — Calendário do aluno, Fase 3: painel do dia com sub-abas (local, SEM commit/deploy)
- Clique no dia abre, para cada treino, 4 sub-abas: Prescrito x Realizado (prescrição + relógio + tabela por bloco), Resposta da aluna (mesmo painel da aba Treinos), Análise (relatório determinístico de execução) e Relógio (resumo, gráfico FC x velocidade, parciais por km). Análise/Relógio só habilitam se há atividade vinculada.
- API: `GET /coach/students/:studentId/activities/:activityLogId/detail` → reutiliza `ActivityDetailService.getDetail(studentId, …)` (posse pelo próprio studentId; atividade de outra conta = 404). Efeito colateral já existente do serviço: cache idempotente da série/análise; sem IA. `ActivityDetailService` agora exportado pelo módulo.
- Admin: `HistorySessionDetail` em page.tsx; detalhe carregado só ao abrir sub-aba que precisa. Sem migration. Gates: tsc api+admin verdes, 34 testes coach verdes, next build ok.

### 2026-10-20 — PWA: botões do feedback sem resposta após vincular atividade (causa NÃO confirmada)
- Relato: aluna/Elton vinculou atividade do Polar (confirmação via `window.confirm`) e depois nenhum botão do formulário de feedback respondeu; sem banner de "feedback travado" (então não era o modo `locked`). iPhone PWA.
- Hipótese (não provada): `window.confirm` no PWA standalone do iOS deixa a tela sem receber toque. Mitigação: `ActivityLinkControls` (apps/mobile/App.tsx) agora confirma DENTRO do app na web (painel Confirmar/Cancelar); nativo mantém Alert. Se o problema persistir, coletar: fechar/reabrir o app resolve? outros toques funcionam? Registrar em dossiê na 4ª tentativa.
- Bug separado, ainda NÃO corrigido: "Registrar feedback" numa atividade alternativa cria um registro automático vazio (`source: device_extra`) que o app trata como feedback salvo e abre o formulário travado.

### 2026-10-20 — Painel: gráficos de volume/aderência ignoravam treino vinculado ao relógio sem feedback (CORRIGIDO, local)
- Sintoma: semana 12/10 com 10,15 + 10 + 5,5 km (25,7). O gráfico azul do Intelligence (ActivityLog) mostrava certo; Carga Semanal, Volume semanal, Aderência, calendário de bolinhas e a lista de alunos mostravam 15,6 km e a terça como "sem registro". Mesmo erro na Duane; afeta todos os alunos com treino vinculado sem feedback.
- Causa: `summarizeSessions` e `mapHistorySession` (coach) liam só `completion` (feedback digitado), nunca `executionLinks`. Regra do resto do sistema (EvolutionMetricService.classifySession, app da aluna): vínculo ativo basta para "feito" e o km vem da atividade.
- Correção: `coach/objective-execution.ts` (`objectiveExecutionOf`); `summarizeSessions` e `mapHistorySession`/plano atual passam a usar o vínculo (feito, km, tempo, pace; vínculo prevalece sobre "não fiz" e sobre km digitado, sem somar duas vezes); `student()` e a lista do dashboard incluem os vínculos ativos. Sem migration. Teste: `objective-execution-summary.spec.ts`.
- Não coberto: atividade "alternativa" não materializada em sessão não entra nesses gráficos (só no Intelligence); contadores agregados do topo do dashboard (`workoutCompletion.count`) seguem só por feedback.
- 20/10 (2ª parte, caso Duane): `summarizeSessions` também somava o km de treino marcado "não fiz" (o formulário da aluna guarda o km prescrito como rascunho no completion) → realizado inflado (semana 12/10: 33,9 em vez de 20,0; 28/09: 27,6 em vez de ~16,7). Agora km/tempo/pace realizados só contam com relógio vinculado ou feedback feito/ajustado (`completedMetrics`). PENDENTE de aprovação (entra em contexto de IA): `reassessment.service.ts:182` (`actualKm`) tem o mesmo erro.

### 2026-10-20 — Painel: gráfico de Esforço percebido (RPE) com filtro de modalidade em todas as visões (local)
- Filtro de modalidade agora também em "Por sessão" (antes só Semana/Mês). Média móvel, canal de tendência, tendência linear e média geral são calculados SÓ com a modalidade filtrada (legenda explícita). "Por mês" ganhou média móvel de 3 meses e canal (6 meses, mín. 4). Só admin (`EffortSection`), sem API.

### 2026-10-20 — Aviso da Supabase (Data API, 30/10/2026): sem ação para o Panzeri Run
- Verificação somente leitura: nenhuma referência a Supabase/supabase-js/PostgREST/GraphQL no repositório (api, admin, mobile, tools, docs, dependências). Todo acesso ao banco é Prisma → PostgreSQL via `DATABASE_URL` (PostgreSQL do EasyPanel). Migrations sem GRANT/RLS. Nada alterado.
- Pendente de conferência de Elton: se o aviso veio de projeto da Supabase de OUTRO app (Estúdio Panzeri Fitness, PANZ FIT, Leo), checar naquele repositório.

### 2026-10-20 — Zepp confirma IA externa, Workout API V2 e campos do FIT; plano técnico revisado (SÓ PLANEJAMENTO, sem código)
- Confirmação oficial (Jeff Fu): (1) dado Zepp autorizado pode ir a Anthropic/outro fornecedor de IA, sem aprovação adicional da Zepp, mas o Panzeri Run precisa explicar IA/processamento externo no acordo de uso e na privacidade e obter aceite expresso; (2) Workout API V2 (`POST /users/-/workouts?version=2.0.0`, janela de 7 dias, sem aprovação separada); (3) FIT: FC, cadência, elevação, potência, GPS e dados básicos, se cobertos pela autorização do aluno.
- Decisão de Elton: publicar treino no relógio entra na PRIMEIRA entrega (ciclo prescrever → enviar → executar → importar → Atlas → ajustar). O bloqueio de envio de dado Zepp real à Anthropic continua até consentimento implementado, privacidade atualizada e requisitos de proteção de dados atendidos; só sai a espera pela Zepp.
- Documento: `PLANO_TECNICO_ZEPP_ATLAS.md` (lotes revisados: 2 envio ao relógio, 3 importar, 4 fechar ciclo, 5 Atlas com dado real). Reaproveita `CanonicalWorkout` + `WorkoutDelivery`. Pontos em aberto na Zepp: unidades de pace/distância/FC/potência no V2, listas de enums, limites, se a atividade executada traz o `workoutId`, rotina diária de janela. Aguardando aprovação de Elton.

### 2026-10-20 — Zepp/Amazfit Lotes 2, 3 e 4 + Atlas (desenvolvimento LOCAL; SEM commit/deploy; migrations NÃO aplicadas)
**Autorização de Elton (20/10):** desenvolver localmente os Lotes 2 (envio ao relógio), 3 (importar) e 4 (fechar o ciclo), preparando o caminho até o Atlas com dado sintético; sem commit/push/deploy/migration em produção. O e-mail com as perguntas técnicas já foi enviado ao Jeff (Zepp). Envio de dado Zepp real à Anthropic CONTINUA bloqueado (constante vazia + variável + consentimento + privacidade + LGPD).

**Lote 2 — envio de treinos (código em `apps/api/src/zepp/zepp-workout-*.ts`):** tradutor `CanonicalWorkout` → Workout V2 (só traduz; recusa o que depende de resposta da Zepp, nunca inventa unidade); perfil de unidades `zepp-workout-profile.ts` TODO `null` (só se preenche com a resposta escrita da Zepp); janela de 7 dias (end = start+6, reenvio da janela inteira; lista vazia só por pedido explícito `POST /zepp/workouts/clear {confirm:true}` ou quando o aluno retira a finalidade com a conexão ativa; desconexão só cancela localmente); publicador por RECONCILIAÇÃO (compara o que deveria estar no relógio com o que a Zepp aceitou; idempotente, uma publicação por aluno por vez, relê após enviar) + rotina a cada 30 min; reaproveita `WorkoutDelivery` (provider `zepp_workout_v2`, `sent` = Zepp aceitou; nunca `delivered_to_device`); consentimento 1.2 com finalidade opcional `watch_delivery`; `workoutId` inteiro vem de sequence (migration `20261020120000_zepp_workout_id_sequence`, só uma sequence). Gate: `ZEPP_WORKOUT_PUBLISH_ENABLED=true` + perfil confirmado + `watch_delivery` concedido.

**Lote 3 — importar:** `POST /integrations/zepp/webhook/<ZEPP_WEBHOOK_SECRET>` (text/plain, array de strings JSON — formato oficial; sem HMAC da Zepp, então segredo na URL em tempo constante + corpo ≤ 64 KB + callbackURL só do host oficial + só conta ativa vira trabalho; 404 sem segredo; 204 rápido) → fila existente (`ProviderInboundEvent`, idempotente por summaryId) → `ZeppActivityEventService` (revalida consentimento e período `collectFrom`, descarta atividade manual, baixa o FIT com o Bearer do aluno SEM seguir redirecionamento, lê com `fit-file-parser` 6.2.2 estrito, filtra por campo conforme o consentimento DENTRO da trava de gravação, grava RawExternalActivity → ActivityLog → série → identidade física → classificação). **O FIT original nunca é guardado** (só memória). `authorizationChange/delete` encerra a conexão local. Migration `20261020130000_activity_series_gps_power_elevation` (4 colunas nulas em `ActivityTimeSeriesPoint`: latitude, longitude, elevationMeters, powerWatts). Cadência do FIT NÃO é gravada até confirmar o fator passos/min (`ZEPP_FIT_PROFILE.runningCadenceMultiplier = null`). Fuso vem da mensagem `activity` do FIT (senão `utcOffsetMinutes` fica nulo, registrado).

**Lote 4 — fechar o ciclo:** vínculo exato pelo `workoutId` publicado (`ZeppExactLinkService`, DESLIGADO: `ZEPP_EXECUTED_WORKOUT_ID_FIELD = null` até a Zepp confirmar o campo; nunca sobrescreve decisão/ vínculo existente); sem ele vale o mecanismo existente (classify/identidade física). Backfill de 30 dias (`ZeppBackfillService`): um pedido por conexão, só com `history_backfill` + categoria Atividades, nunca antes de `collectFrom`, teto interno 40/h (Zepp: 50/h), 429 não marca como feito; `ZEPP_BACKFILL_ENABLED=true`. Comparação prescrito × executado reaproveita `ActivityDetailService` (série do relógio já preenchida).

**Atlas:** novas variáveis `activity.powerAvgWatts` e `activity.elevationGainMeters` (registro + leitor); FC/pace/volume já chegam pelo ActivityLog/série/análise de execução; sono/recuperação = Lote 5 (não feito). Elegibilidade/procedência do Lote 1 intactas; teste prova que dado Zepp real segue bloqueado para IA externa.

**Pendente da Zepp (perguntas enviadas):** unidades de pace/distância/FC/potência no V2, enums, limites, tipo de "sem meta", se a atividade traz o `workoutId`, rotina diária da janela. **Novas perguntas a fazer:** convenção da cadência de corrida no FIT; se o FIT sempre traz a mensagem `activity` (fuso); se a Zepp reenvia o mesmo summaryId quando a pessoa edita a atividade.
**Para ligar (nada disto é feito por mim):** aplicar as 2 migrations; `ZEPP_WEBHOOK_SECRET` + cadastrar a URL no console da Zepp; `PROVIDER_HUB_WORKER_ENABLED=true`; preencher o perfil do Workout V2 e só então `ZEPP_WORKOUT_PUBLISH_ENABLED=true`; testar com UMA conta Amazfit real.

### 2026-10-20 — Consentimentos Zepp/Amazfit e Atlas IMPLEMENTADOS (telas, textos, registros, revogação, Política/Termos) — local, SEM commit/deploy; migration NÃO aplicada
**Pedido de Elton:** implementar (não só planejar) as telas e os textos de autorização da Zepp/Amazfit e do Atlas, a tela de permissões, a Política/Termos e os bloqueios. A Zepp já autorizou o uso com a Anthropic; **o envio de dado Zepp real à Anthropic continua BLOQUEADO** (lista `EXTERNAL_AI_APPROVED_PROVIDERS` vazia) até: contrato/DPA e transferência internacional confirmados e publicados, revisão jurídica, migrations aplicadas, teste com conta real e autorização expressa de Elton.
- **Texto/versões:** consentimento Zepp 2.0 (`zepp/zepp-consent.ts`): tela da conexão (título "Conecte seu Amazfit ao Panzeri Run", ack obrigatório, histórico opcional) + telas PRÓPRIAS, com versão e hash próprios, para `watch_delivery` ("Receba seus treinos no relógio") e `ai_external` ("Personalize seus treinos com o Atlas"). Saiu o grupo de sono (não implementado). Nenhuma caixa marcada; envio de treinos e Atlas não podem ser marcados na conexão (servidor recusa).
- **Mecânica:** `ProviderConnection.purposeConsents` (migration `20261020140000_provider_purpose_consents`, 1 coluna nula, NÃO aplicada): versão/hash/data por finalidade; finalidade com tela própria só vale sobre o texto vigente (`isPurposeCurrent`, também na elegibilidade para IA); texto da conexão mudou ⇒ importação suspensa até "Confirmar o texto atualizado" (`reconfirm`, `isConnectionConsentCurrent`). Novos: `updateGroups`, `permissions`, `consentLog`, `reconfirm`; `updatePurposes` por finalidade e uma por vez; histórico pode ser concedido depois de conectar (janela de 30 dias). Auditoria de cada decisão (aluno, item, versão, hash, data, decisão).
- **Revogação efetiva:** retirar envio de treinos ⇒ publicador remove os treinos da Zepp na hora; retirar Atlas / retirar "Atividades" / desconectar / revogação pela Zepp ⇒ `ProviderDataDeletionService.invalidateAiArtifacts` (relatório semanal e retratos do Analista entregues, pacote de evidências e texto enviado à IA com agregados removidos, raciocínio declarado, relatórios de evolução e resumo do prontuário derivados; análises vivas e registros de pagamento/auditoria ficam). Exclusão de dados Zepp também limpa o registro dos treinos enviados (`ZeppDataDeletionService`).
- **Telas (app):** `apps/mobile/src/zepp/ZeppIntegration.tsx` — conexão, cartões do envio de treinos e do Atlas (Atlas mostra "ainda não disponível" enquanto travado), "Privacidade e permissões" (4 autorizações separadas com retirada própria e confirmação dentro do app, histórico das decisões, desconectar, solicitar exclusão com explicação do que é apagado/mantido/consequências). Zepp no catálogo de integrações (porta por aluno `ZEPP_ENABLED_USER_IDS`); rotas `/zepp/*` abertas ao aluno, fail-closed.
- **Documentos:** `legal/legal-content.ts` — Política (5A Zepp/Amazfit, 7A Atlas e Anthropic, direitos da LGPD, fornecedores Zepp Health/Anthropic, exceção do GPS) e Termos (cláusula 7 Atlas, integração Zepp), versão 2026-10-20; sem prazo, mecanismo de transferência ou garantia contratual inventados. Documento de revisão com TODOS os textos como o aluno verá, pendências e requisitos: `CONSENTIMENTOS_ZEPP_ATLAS.md`.
- **Pendências jurídicas/institucionais** (detalhe no documento, seção 7): controlador/CNPJ/endereço/encarregado, retenção, instrumento de transferência internacional, DPA e retenção/treino da Anthropic, base legal do dado sensível, prazos de resposta, menores, revisão do advogado.

### 2026-10-21 — Apple 3.1.2(c) (build 8 rejeitado): nova tela de assinatura da loja — local, SEM commit/build
Nova `apps/mobile/src/subscription/StoreSubscriptionPaywall.tsx`, usada em App.tsx nos 3 pontos de compra do app nativo (Semana, programa travado, Cobrança) via `StoreSubscriptionOffer`; só quando `isNativeStorePurchaseAvailable()` (web/Asaas inalterado). Benefícios (4, textos do Elton) antes do preço; plano/preço/período/teste vêm do produto real (`loadStorePlanViews` → `pickStorePackage`), nada fixo; "Assinar {nome}" desabilitado até o preço carregar; renovação automática, cobrança pela loja, Termos, Privacidade e Restaurar compras visíveis. Fluxo de compra, produtos e preços intocados. Exige NOVO build iOS para a Apple ver.

### 2026-10-21 (tarde) — Apple 3.1.2(c): builds 10→13, causa da conta "ativa", reenvio ("Atualizar revisão")
- **Build 9** falhou (`pnpm-lock` sem `fit-file-parser`; corrigido, commit `ad13431`). **Build 10** (tela da loja) → TestFlight. **Build 12** (período "por mês" quando o iOS devolve `subscriptionPeriod` nulo). **Build 13** (`ccccaef`): "Ver planos e preços" na Cobrança para assinante ativo, assim o revisor sempre vê a tela. Perfil de submit em `eas.json` (`ascAppId` 6805618958). Starter do Expo contratado (cota gratuita de iOS esgotada, 15/15); renova 21/11.
- **Conta "Testando" voltava a "Ativa"**: (1) `APPLE_IAP_PRIVATE_KEY` no EasyPanel precisa ficar em UMA linha com `\n` literais (EasyPanel lê o Ambiente linha a linha; em várias linhas a chave chegava vazia e a consulta direta à Apple ficava desativada); (2) o teste da Apple renova por dia (compra 17/10 20:27 UTC, renovações diárias, ~6 renovações) e o cancelamento no sandbox não as impediu; (3) RevenueCat em "Transfer to new App User ID": a assinatura vai para quem está logado no aparelho (alias anônimo ⇒ "expirada"; login ⇒ volta). Log `veredito=active (sandbox=true)` prova que a Apple, não o código, dizia ativa. Elton usou "Apagar histórico de compras" do testador no App Store Connect.
- **Reenvio**: Elton clicou "Atualizar revisão" na versão 1.0 com o build 13 e notas novas (como ver a tela: sem assinatura ⇒ Semana/Cobrança; ativa ⇒ Cobrança → "Ver planos e preços"). Pendente de validação em aparelho: o link "Ver planos e preços" do build 13 e o "por mês" do build 12 não foram vistos rodando.

### 2026-10-21 (noite) — Zepp Workout V2: confirmações oficiais incorporadas (local, SEM commit/deploy/migration/flag)
Resposta de Jeff Fu: tempo s, distância m, **pace = velocidade m/s**, inteiros, `workoutDate` AAAA-MM-DD local, recuperação caminhando = etapa de recuperação, a Zepp NÃO estende a janela de 7 dias, Activity Event/FIT NÃO trazem o `workoutId`.
- `zepp-workout-profile.ts`: `distanceUnit 'm'`, `paceUnit 'm_per_s'`; o resto (passo sem meta, pace único, limites) segue `null` e recusa só o passo afetado. `zepp-workout-spec.ts`: inteiros em tempo/distância; caminhada só como RECOVERY dentro de corrida.
- Publicador: republicação **diária** da janela completa mesmo sem mudança (status `republished`), carimbo do aceite da API em `providerMetadata` (nunca "recebido no relógio"); lista vazia continua só por ação explícita; `status()` agora devolve `acceptedByZepp`/`windowAcceptedToday` (saiu `onWatch`).
- Vínculo prescrito×executado: removido `ZeppExactLinkService` e o parse de `publishedWorkoutId`; só o mecanismo existente (automático = inferido; aluno/treinador = confirmado). Chave de idempotência do webhook passou a `activity:{summaryId}:{hash da URL}` para a reentrega do Backfill não ser engolida pela linha antiga.
- FIT expirado/404: `ZeppBackfillService.requestRecovery` (janela estreita, 1 pedido por atividade, só dentro do período e da categoria Atividades autorizados, não exige a finalidade de histórico, teto 40/h compartilhado).
- Testes: 223 passando (zepp, provider-hub, ai-governance, integrations); tsc e eslint limpos. Sem migration nova. Atlas/Anthropic continua bloqueado (lista vazia).

### 2026-10-21 (noite) — Zepp: ritmo SEMPRE em min/km para o aluno; m/s só no payload (local, sem commit/deploy)
Regra do Elton: o aluno nunca vê m/s. A Zepp exige velocidade em m/s só como unidade de comunicação entre sistemas.
- **Corrigido:** `paceToTarget` arredondava a 3 casas (3,333 m/s) — agora SEM arredondamento (5:00/km = 1000/300 m/s exato; ida e volta recupera 300 s/km). A prescrição continua em s/km no `CanonicalWorkout`; a tela lê dela.
- **Auditado:** nenhuma tela (app do aluno, painel) escreve m/s; o valor convertido só existe em `WorkoutDelivery.providerMetadata.zeppWorkout` (nenhum endpoint, tela, Atlas ou prompt o lê). Teste estrutural novo varre `apps/mobile` e `apps/admin/app` contra `m/s`, `PACE_LAP`, `targetValue*`. Atividade importada: velocidade do FIT vira `speedKmh` na série e o app do aluno converte para min/km (`3600/speedKmh`, `activityDetail.tsx`); comparação prescrito×executado e Atlas usam s/km/min/km (nenhuma velocidade chega ao Atlas).
- **Limitação registrada (não presumida):** como o relógio/app Zepp exibe a meta de pace (`PACE_LAP`, numérico em m/s) é controlado por Zepp/firmware/unidade escolhida pelo usuário no app Zepp; o schema não documenta a exibição. Só se confirma com um Amazfit real. Opção futura (não feita): campo opcional `description` da etapa com o ritmo em texto min/km.
- **Observação (não é m/s):** gráfico do painel do treinador (`apps/admin/app/page.tsx`) ainda plota "Velocidade (km/h)" para qualquer atividade importada; esteira também usa km/h por regra antiga do produto.
- **Pedido seguinte do Elton: "deixe tudo em ritmo de pace min/km"** — app do aluno: removida a coluna "Velocidade" da prescrição (e o "| Velocidade (...)" das etapas); prescrição que só traz velocidade (ex.: esteira "10,7 a 11,5") é convertida para pace na apresentação (`paceRangeFromSpeedText`); "Isso equivale a um pace de X" sem km/h na meta de prova; vVO2max do teste de 3 km (escondido) em pace. Painel do treinador: gráfico da atividade agora plota "Ritmo (min/km)" (eixo invertido, mais rápido = mais alto) em vez de km/h. Teste estrutural: nenhum `km/h` em texto de interface do app (`zepp-workout.spec.ts`). NÃO mexido (coach-facing/entrada): editor de prescrição do painel ainda tem modo "Velocidade" e exibe a velocidade da etapa quando o treinador prescreveu assim.

### 2026-10-21 (noite) — Decisões do Elton sobre a Zepp: uso real direto, Atlas liberado, pausa ativa extremamente leve (local, SEM commit/deploy/variáveis)
- **Uso real sem teste prévio:** Elton libera aluno a aluno (`ZEPP_ENABLED_USER_IDS`) e relata; passos de ativação entregues no chat (migrations, `ZEPP_*`, `PROVIDER_HUB_WORKER_ENABLED`, `ZEPP_WEBHOOK_SECRET`, flags, webhook no console da Zepp).
- **Jurídico:** Elton considera nada pendente. Texto da Política (7A) trocado: sem "ainda sendo confirmado"; afirma só fatos (empresa estrangeira, transferência internacional, regras do fornecedor dependem dos termos dele). `LEGAL_VERSION` → 2026-10-21.
- **Atlas LIBERADO** ("manda ver no Atlas", 21/10/2026): `EXTERNAL_AI_APPROVED_PROVIDERS = ['zepp']`. A segunda trava continua: variável `ZEPP_EXTERNAL_AI_ENABLED` ligada no servidor (decisão/ação do Elton no deploy) + autorização própria do aluno sobre o texto vigente. Sem a variável, nada vai à Anthropic.
- **Pausa:** regra do treinador — nunca pausa passiva; sempre pausa ativa extremamente leve, com faixa de pace leve (permite envio ao relógio). Aplicada no conhecimento de metodologia (`panzeri-methodology-knowledge.ts`); treinos já gerados com pausa passiva continuam sem envio ao relógio (`no_target_unconfirmed`).

### 2026-10-21 (noite) — Zepp: SAÚDE E RECUPERAÇÃO completas (sono, diário, HRV) + Atlas — local, SEM commit/deploy/migration/variável
Pedido do Elton: aproveitar tudo o que a Zepp autorizou ("é pra pegar tudo"; contrato "Health Data Collaboration" aprovado). Doc operacional: `ZEPP_SAUDE_E_RECUPERACAO.md`.
- **Receber/guardar:** webhook aceita `sleeps`, `dailies`, `hrv` (push); filas `sleep_summary`/`daily_summary`/`hrv_summary` (`ZeppHealthEventService`); 3 tabelas novas (`WearableSleepSummary`/`WearableDailySummary`/`WearableHrvSummary`, migration `20261021200000_wearable_health_summaries`, NÃO aplicada). Identidade = aluno+provedor+dia local+início (summaryId pode ser nulo); dedupeKey inclui hash do conteúdo (resumo atualizado vira evento novo; regravação idempotente). Campo ausente/fora de faixa = nulo (nunca zero/estimativa). FC de repouso SÓ do diário (categoria própria `resting_heart_rate`); o evento de sono não a fornece. Corpo vazio no webhook = 204 (teste do portal).
- **Consentimento 2.1:** grupos `sleep` (Sono e recuperação), `daily` (Saúde diária), `hrv`, independentes das atividades; "Marcar todos os grupos" é atalho do aluno (nada pré-marcado). Atlas tela v1.1 cita sono/HRV/saúde diária. Política 21/10 atualizada.
- **IA:** `AiScope.blockedHealth` (pares `provedor:categoria`); `isHealthBlockedForAi` nos leitores; guard de saída aborta se categoria de saúde for retirada no meio da geração; fail-closed sem avaliação. Variáveis `wearable.*` (sono, HRV, FC de repouso, passos, kcal ativas) no registro, no domínio sleepRecovery/physicalState do snapshot (minutos = s/60 sem arredondar; HRV na unidade da Zepp, não especificada).
- **Exclusão/revogação:** exclusão de dados Zepp e da conta apagam as 3 tabelas; retirar grupo de sono/HRV/diário invalida artefatos de IA derivados.
- **Lacunas contratuais (ver doc):** HRV NÃO consta nos "Requested Data Items" aprovados; Dailies está "[Upcoming]" na documentação; Backfill só cobre atividades. Callbacks "Unconfigured" no portal: cadastrar a MESMA URL do webhook em todos.
- **Não feito (de propósito):** telas do aluno/treinador para ver sono/HRV (os dados já chegam à IA e ficam gravados); API de perfil (nickname/avatar/gênero) — não usada.

### 2026-10-21 (noite) — Zepp: fechamento (receptores completos, fontes unificadas para o Atlas, orientação ao aluno) — local, SEM commit/deploy/migration aplicada/IA ligada
Pedido do Elton: encerrar a integração Zepp de ponta a ponta antes da central longitudinal (sem novos agentes, telas analíticas ou relatórios).
- **Receptores completos:** `WearableMetricRecord` (genérico, provider-neutro) + parser/fila `metric_summary` para SpO2, temperatura da pele, composição corporal, nutrição e carga de estilo de vida (todos "Upcoming" na doc); campos e unidades ORIGINAIS preservados; categorias novas no vocabulário (`pulse_ox`, `skin_temperature`, `body_composition`, `nutrition`, `lifestyle_load`); NENHUM grupo de consentimento as oferece ainda ⇒ nada é gravado até existir o texto. Sono agora também preserva `sleepScores` e deslocamentos de respiração/SpO2. Migration NOVA e separada `20261021210000_wearable_metric_records_and_sleep_extras` (a `20261021200000` já está no GitHub e não foi alterada).
- **Fontes unificadas para o Atlas (estrutura existente):** `VariableDefinition.evidenceKind` (self_report | device_measurement | device_estimate | manufacturer_score | system_calculation) → `variableLegend[id].evidenceKind` no contexto compacto; `paired-evidence.ts` junta esforço percebido × FC/ritmo/potência/cadência da MESMA sessão (vínculo confirmado por pessoa ou inferido) e sono percebido × sono do relógio na mesma data (pareamento por data = hipótese), respeitando o escopo de IA; vai em `pairedEvidence` no snapshot e no contexto compacto.
- **Orientação ao aluno:** o único texto de IA que o aluno lê é `recommendation` ("Orientação da semana"); novo bloco `INTEGRATED_SOURCES_INSTRUCTION` (só no prompt da semana, removível no teste de prompts congelados) manda ler as fontes juntas, separar FATO de HIPÓTESE, proporcionar à qualidade do dado e responder (1) como foi o treino (2) como o corpo respondeu (3) o que mudou vs. histórico (4) o que fazer agora, sem jargão, ritmo em min/km, sem diagnóstico.
- **Callbacks "Unconfigured":** a documentação pública NÃO descreve o cadastro (passo "Configure Callback Endpoint" no Developer Console, sem telas); ação do Elton/suporte Zepp registrada no relatório. Nada validado ainda com dado real da Zepp.

### 21/10/2026 — Painel do treinador: Aluno > Integrações (somente leitura)
- Nova aba "Integracoes" no cadastro do aluno (`apps/admin/app/student-integrations.tsx`) alimentada por `GET /coach/students/:studentId/integrations` (`coach/student-integrations.service.ts`, guarda coach/admin da controladora). Reaproveita as tabelas existentes (ProviderConnection, Polar/Wahoo/Strava, RawExternalActivity, ActivityLog, Wearable*, ProviderInboundEvent, WorkoutDelivery); nenhum segundo sistema, nenhum fluxo de conexão alterado.
- Mostra por provedor: estado (conectada/desconectada/autorização expirada/com erro/nunca conectou/dados sem registro de conexão), última sincronização com a BASE (sincronização concluída, último evento processado ou último dado — nunca data presumida), categorias autorizadas x o que de fato chegou (com data do último recebimento), falhas traduzidas e agrupadas (erro bruto da fila nunca exibido), e a autorização do Atlas separada da importação.
- Segurança: consultas só com `select` de colunas de estado; nenhum token/segredo/id de conta sai; `hasRefreshToken` é só booleano; Strava mostra apenas "conectada" (dados do Strava nunca vão ao treinador/IA); sem rota de escrita nem de consentimento.
- Testes: `test/student-integrations.spec.ts` (25 casos). Sem commit/push/deploy.

### 21/10/2026 — Foto de perfil do aluno + redesenho da aba Integrações
- **Foto de perfil:** tabela nova e isolada `UserProfilePhoto` (1 linha por aluno = referência central; JPEG ≤ 60 KB guardado no banco; migration `20261021220000_user_profile_photo`, ADITIVA, **ainda não aplicada em produção**). API: `GET/PUT/DELETE /me/photo` (aluno, sempre o id do token) e `GET /coach/students/:id/photo` (treinador/admin, só leitura); listagem do painel devolve só `photoUpdatedAt`. Entra em `ACCOUNT_DELETE_ORDER` (apagada com a conta). O servidor só valida (bytes JPEG reais, ≤ 60 KB, 64–1024 px); o app corta quadrado, reduz a 320 px e comprime.
- **App:** `src/profilePhoto/*` (avatar, cartão no Perfil com escolher/trocar/remover, avatar no cabeçalho). Dependências novas: `expo-image-picker` e `expo-image-manipulator` (+ plugin no app.json) → **exige novo build nativo** (Android/iOS); no PWA funciona ao atualizar.
- **Painel:** `student-avatar.tsx` (cache por aluno+versão) na lista de alunos e no cabeçalho do cadastro.
- **Integrações (só visual):** cartões em 2 colunas (1 no celular), todos os 6 provedores (nunca conectados em estado neutro), detalhes expansíveis. Logos oficiais **não** foram baixados: monograma da marca até o arquivo oficial ser colocado em `apps/admin/public/integration-logos/` e referenciado em `OFFICIAL_LOGO`.

### 21/10/2026 — Integrações: envio de treinos ao relógio em camadas (caso Duane)
- "Não autorizada" na linha de envio de treinos é a autorização INDIVIDUAL da aluna (finalidade própria `watch_delivery`, tela separada depois de conectar); o OAuth da Zepp não tem escopos, então nada a verificar ali e a conexão nunca autoriza o envio. O painel usa o mesmo predicado do publicador. Agora a linha mostra o diagnóstico por camadas: habilitação Zepp (não consultável), publicador ligado, perfil de unidades, conexão/token e autorização da aluna (nunca concedeu x texto antigo x ok). Nenhum estado é alterado.

### 22/10/2026 — Nome do treino enviado à Zepp: "Corrida 11 km · 25/10"
- Pedido do treinador: simplificar para tipo + distância prescrita + data (sem código, sem nome de aluna, sem texto da IA). `zeppWorkoutName()` em `zepp-workout-spec.ts`; distância só formatada (campo `distanceKm` da sessão), omitida se ausente. Caso Duane: payload enviado tinha `workoutDate` correto (2026-10-25) e nome "Corrida"; "Letícia" e o dia adiantado vieram do lado da Zepp (hipótese: fuso do servidor da Zepp; aguardando prints da aluna/resposta da Zepp). Treinos já publicados são reenviados uma vez com o nome novo.

### 22/10/2026 — Health Connect: todas as categorias, com autorização por categoria (local, SEM commit/deploy/migration)
- **Decisão de Elton:** pegar tudo (treino e saúde) do Health Connect/Samsung Health/Galaxy Watch e **perguntar todas as autorizações já agora**, mesmo as que o app/Google/Samsung ainda não liberaram; só se abre mão do que for proibido explicitamente. Atlas para o Health Connect: **ok** (autorização separada). Testadoras do alpha: **ok** reconsentir. Leitura em segundo plano: **OBRIGAÇÃO** — implementar assim que o primeiro dado real chegar e AVISAR Elton.
- **Servidor:** `health-connect-consent(.service).ts` (documento v1.0 + serviço; registro em `ProviderConnection` sem token), `health-connect-health(.service)/(-records).ts` (sono/dia/HRV/indicadores em `Wearable*`, provider `health_connect`), endpoints novos no `health-connect.controller.ts`, ingestão de exercícios agora exige `activity` (403 sem) e trata sensores como categoria própria + escalares novos (velocidade, potência, cadência, elevação, calorias). `ai-data-eligibility`: Health Connect saiu do atalho "legado elegível" (`DEVICE_CONSENT_PROVIDERS`), entrou em `EXTERNAL_AI_APPROVED_PROVIDERS` (segunda trava: `HEALTH_CONNECT_EXTERNAL_AI_ENABLED=true` a ligar por Elton). Novas categorias `vo2_max`/`respiratory_rate` no vocabulário. Painel do treinador: linha do Health Connect com autorizações x dados recebidos x Atlas.
- **App:** `categories.ts`, `healthRecords.ts`, `sync.ts` (guiado pelas autorizações, fail-closed), `HealthConnectConsent.tsx` (tela de autorizações), `useHealthConnect.ts`, gateway com leituras genéricas/agregados do dia; `app.json` com as permissões de leitura de todas as categorias + histórico. **Exige novo build Android** e declaração na Play Console (`HEALTH_CONNECT_PLAY_CONSOLE.md`). Política (seção 5) reescrita (revisão jurídica ainda pendente).
- **Pendente:** percurso GPS e temperatura da pele (sem leitura), validação em aparelho real, build + formulário Play, segundo plano. **Sem migration** (reusa `ProviderConnection` e `Wearable*`).

### 22/10/2026 — Anotado para implementar depois (SEM gastar build agora): percurso GPS e leitura em segundo plano do Health Connect
- Elton só PERGUNTOU por que não estavam feitos; **não** pediu implementação nem novo build. Nada foi alterado. O build Android 12 (versionCode 12) segue sem GPS/segundo plano.
- **Pendências registradas:** (1) percurso GPS (`ExerciseRoute`: permissão por sessão via `requestExerciseRoute`; gravar no `ActivityTimeSeriesPoint` com latitude/longitude, como a Zepp já faz; `hasRoute`); (2) leitura em segundo plano (`READ_HEALTH_DATA_IN_BACKGROUND`; exige tarefa em segundo plano no app) — **avisar Elton quando o primeiro dado real chegar**; (3) ambos entram juntos num próximo build e numa atualização do formulário da Play Console; (4) temperatura da pele (biblioteca atual não oferece o tipo).
- Regra: só implementar/gastar build quando Elton mandar.

### 22/10/2026 — Autorizações opcionais da Zepp ficavam escondidas (2 de 2 alunas conectaram sem passar por elas)
- **Problema (relato de Elton, alunas Duane e outra):** conectavam a Zepp e nunca davam a autorização de envio de treinos ao relógio nem a do Atlas; as telas existiam, mas ficavam abaixo da dobra e nada as destacava.
- **Correção (código local, sem build):** `GET /me/integrations` devolve `pendingAuthorizations` (Zepp conectada sem `watch_delivery`/`ai_external` vigentes); a lista "Dispositivos e integrações" mostra "Conectado — falta autorizar" em cor de alerta + "Pendente: … Toque para autorizar"; a tela da Zepp abre com o cartão "Falta pouco para terminar". As autorizações continuam em telas próprias e opcionais (nada é presumido nem concedido junto com a conexão). Valem no PWA após o deploy; no app Android só no próximo build.

### 22/10/2026 — Lista do PRÓXIMO build Android (Elton: "tudo junto num build só, quando eu mandar")
1. Percurso GPS do Health Connect (ainda NÃO implementado).
2. Leitura em segundo plano do Health Connect (ainda NÃO implementada; avisar Elton quando o 1º dado real chegar).
3. Destaque das autorizações opcionais pendentes da Zepp ("Conectado — falta autorizar" + cartão "Falta pouco"): JÁ implementado no código; só falta o build (no PWA vale após o deploy).
- Junto com o build: atualizar o formulário da Play Console (rota GPS e segundo plano) e só gastar build quando Elton mandar.

### 22/10/2026 — Envio de treinos à Zepp na hora (gatilhos) — caso Roberta
- **Problema:** autorizar o envio de treinos não publicava nada; só a rotina de 30 min (e a Roberta não achou nada no Zepp). O app também não tem botão "Sincronizar agora" (a rota `POST /zepp/workouts/sync` existe, o app nunca foi ligado a ela).
- **Correção (só API, sem build):** `requestZeppWorkoutSync(userId, motivo)` (`zepp/zepp-workout-trigger.ts`, sem injeção) chamado depois de gravar em: autorização do envio (`grant`, ~0,5 s), geração semanal, regeneração de dia, reagendamento, edição/remoção do treinador e abertura do app (`GET /training-plans/current`, máx. 1 vez/5 min por aluna). O `ZeppWorkoutSchedulerService` agrupa pedidos, só age para quem tem conexão + `watch_delivery`, e nunca atrasa/derruba quem chamou. A rotina de 30 min continua como rede de segurança.
- **Lista do próximo build Android (item 4):** cartão "Treinos no relógio" com último envio / "nenhum treino enviado ainda (sem corrida programada)" + botão "Sincronizar agora".

### 22/10/2026 — Cartão "Treinos no relógio" da Zepp (código pronto, vale após o próximo build Android; no PWA vale pelo deploy)
- `WatchWorkoutsCard` em `ZeppIntegration.tsx`: último envio aceito (`lastAcceptedAt`, novo em `GET /zepp/workouts/status`), contagem de treinos enviados/aguardando, motivo quando não há treino de corrida programado e botão "Sincronizar agora" (`POST /zepp/workouts/sync`). Aviso fixo: aceite da Zepp ≠ relógio recebeu; a aluna sincroniza o relógio no app da Zepp. Item 4 da lista do próximo build: implementado.

### 22/10/2026 — Primeira publicação REAL de treino na Zepp confirmada (Roberta) + limite do Amazfit Active Edge
- **Confirmado com dado real:** o treino publicado pelo Panzeri Run aparece no app da Zepp da Roberta em *Meu calendário de treinamento → Agenda → "Plano de treinamento de terceiros"* como "Corrida 4 km · 22/10" (4,00 km, alerta de ritmo 07'00"–07'20"/km): nome, data, distância e pace corretos.
- **Limite do lado da Zepp:** o modelo dela, **Amazfit Active Edge**, aparece em *Meus dispositivos* como **"Não suportado"** e o treino NÃO é sincronizado ao relógio. Não é falha do Panzeri Run. Pergunta a fazer ao Jeff Fu: quais modelos aceitam treinos estruturados via Workout API (para avisar a aluna antes de conectar). Enquanto isso a aluna segue o treino pelo app.
- O treino também aparece na tela do Panzeri Run; "aceito pela Zepp" continua não significando "relógio recebeu".

### 22/10/2026 — ESCOPO DEFINIDO do próximo build Android (build 13) — NÃO gerar antes de implementar tudo e Elton mandar
**Build 12 (já enviado por Elton à Play Console em 22/10; declaração de apps de saúde em análise no Google) contém:** Health Connect com autorização por categoria (todas as categorias + histórico), foto de perfil, nome do treino Zepp "Corrida km · data". **NÃO contém:** itens 1–5 abaixo.

**Escopo do build 13 (somar tudo):**
1. Health Connect — **percurso GPS** (ExerciseRoute; permissão por sessão; gravar latitude/longitude em `ActivityTimeSeriesPoint` como a Zepp; `hasRoute`). *A implementar.*
2. Health Connect — **leitura em segundo plano** (`READ_HEALTH_DATA_IN_BACKGROUND` + tarefa em segundo plano). *A implementar; só validável em aparelho real; avisar Elton quando o 1º dado real chegar.*
3. Zepp — destaque "Conectado — falta autorizar" + cartão "Falta pouco" (commit 7ff75bf). *Pronto no código.*
4. Zepp — cartão "Treinos no relógio" com último envio e botão **Sincronizar agora** (commit d9dd105). *Pronto no código.*
5. Cartão **Samsung / Galaxy Watch** passa a apontar para o Health Connect (os dados da Samsung chegam por ele). *A implementar.*
6. **Garmin e COROS:** esconder ou manter "Indisponível"? *Decisão de Elton pendente.*
7. **Formulário da Play Console** atualizado com `READ_EXERCISE_ROUTES` e `READ_HEALTH_DATA_IN_BACKGROUND` (e manifesto) junto com o build 13.
8. Fora do escopo (limite técnico): temperatura da pele (a biblioteca `react-native-health-connect@3.5.3` não oferece o tipo).
- **Antes de dar o build por pronto:** testar com Galaxy Watch real (Samsung Health → compartilhar com Health Connect ligado); gates (tsc, lint, testes) e revisão independente do que mexer em permissão/saúde; só então gerar UM build e subir.
- **Regra:** ao receber "gera o build", conferir esta lista e avisar Elton do que ficaria de fora ANTES de gerar.
- **Decisão de Elton (22/10/2026), item 6 do build 13:** Garmin e COROS continuam como "Indisponível" (manter). Escopo do build 13 FECHADO; implementação dos itens 1, 2, 5 e 7 só quando Elton disser "vai".

### 22/10/2026 — Build 13: Health Connect COMPLETO implementado no código (SEM commit/build ainda)
- **Percurso GPS** (app lê rota por exercício; `POST /health-connect/routes`; só com `activity_route`+`activity`; retirar apaga os pontos; nunca vai à IA), **leitura em segundo plano** (`expo-background-task`/`expo-task-manager`, `READ_HEALTH_DATA_IN_BACKGROUND`, botão ligar/desligar no cartão, sessão relida ao voltar ao app), **cartão Samsung/Galaxy Watch → Health Connect** (catálogo: samsung `available`), dica do Samsung Health no cartão, botão **Sincronizar agora** (interativo, confirma GPS), texto de autorização **v1.1** e Política atualizados, `HEALTH_CONNECT_PLAY_CONSOLE.md` com o texto novo. Pacotes novos: `expo-background-task`, `expo-task-manager` (exigem novo build nativo).
- **Falta para dar o build 13 por pronto:** Zepp (itens 3 e 4 já no código) ✔; **autorizações para quem já está conectado em Polar/Wahoo** (em andamento, pedido de Elton); revisão independente do que mexe em permissão/saúde; teste em Galaxy Watch real.

### 22/10/2026 — Autorização do Atlas para quem JÁ estava conectado em Polar/Wahoo + correções da revisão independente do build 13
- **Problema (relato de Elton):** alunas conectadas em Polar/Wahoo nunca viram a autorização do Atlas ("Sem autorização específica" no painel). **Solução (sem perder dado):** módulo `legacy-consent` (`GET /legacy-consent/:provider`, `POST /legacy-consent/:provider/atlas`), decisão gravada em `ProviderConnection` (provider polar/wahoo, sem credenciais; nada altera a importação). **Regra de não-perda:** sem resposta = comportamento anterior (IA recebe, sem exigir variável); "autorizo" = registro com versão/hash; "não autorizo"/retirou = dados do provedor fora da IA e artefatos derivados invalidados. App: `LegacyAtlasConsentCard` nas telas Polar/Wahoo (só conectada); lista de integrações mostra "falta autorizar"; painel do treinador mostra não respondeu/autorizou/não autorizou. Strava (nunca vai à IA) e Apple Saúde não entram.
- **Revisão independente do build 13 (REPROVOU a 1ª versão; corrigido):** (1) recusa do Atlas se perdia na restauração de backup (`ProviderConnection` fora do backup) → a ÚLTIMA decisão em `ProviderConnectionEvent` (preservado) mantém a recusa; (2) altitude do GPS só com `activity_sensors` e retirar sensores zera a altitude dos pontos; (3) segundo plano NÃO renova mais a sessão (evita deslogar/ressuscitar logout); desconectar/sair encerra a tarefa; (4) "Retirar tudo" apaga o GPS e o apagamento vem ANTES da revogação (retry seguro); (5) tipo do percurso do módulo nativo é TEXTO ("DATA"/"CONSENT_REQUIRED"): corrigido, com negativa por exercício tratada e fila local pendente/negado/feito; (12) rota limitada a 1200 pontos. **Pendências menores registradas:** `setAtlas` last-write-wins (baixo), `weekly-checkin` conta atividades sem escopo de IA (contagem só), texto desatualizado do Atlas legado não aparece como "pendente" na lista.
- Verificado: export web do app (PWA) com os módulos novos compila e a tela de login renderiza.
- **Decisão de Elton (22/10/2026):** o build 13 só será gerado DEPOIS da resposta do Google sobre a declaração de apps de saúde (Play Console). Até lá: nada de build. Código do build 13 já está pronto e testado no repositório (GPS, segundo plano, Samsung, cartões Zepp, autorização do Atlas Polar/Wahoo). Ao receber "gera o build 13", conferir a lista de escopo e avisar o que ficaria de fora antes de gerar.

### 22/10/2026 — INCIDENTE: API fora do ar (502 / "Service is not reachable") após o deploy do Health Connect
- **Causa:** o `LegacyConsentModule` (importa `ActivityExecutionModule`) estava no INÍCIO dos imports do `app.module.ts`. Isso mudou a ordem de carregamento dos arquivos e criou dependência circular: `TrainingPlansService` não resolvia `NotificationsService` (índice 6) e a API não subia. Testes unitários passaram porque não sobem o `AppModule`.
- **Correção:** módulo movido para o FIM dos imports (com comentário de aviso). Verificado subindo a aplicação com banco falso: injeção resolve e rotas são mapeadas.
- **Prevenção:** novo `apps/api/scripts/boot-smoke.mjs` (`pnpm --filter api run smoke:boot`). Rodar SEMPRE antes de pedir deploy quando mexer em módulos/providers/imports.

### 22/10/2026 — Teto de tamanho do contexto da IA + PENDÊNCIA (janela curta de sono/HRV)
- **Feito:** `limitCompactAgentContext` (`compact-agent-context.ts`): se o contexto compacto passar do teto (`AI_CONTEXT_MAX_CHARS`, padrão 45.000), os dados de integrações (variáveis `wearable.*` e evidência pareada com o aparelho) saem POR INTEIRO; o resto nunca é removido. O treino é gerado normalmente, entra a lacuna `dados_das_integracoes` (degradado) e o treinador recebe aviso no Telegram (`reportDegradedContext`). Sem autorização da aluna não há lacuna nem aviso (dado tratado como inexistente). Teste: `test/compact-context-cap.spec.ts`. Teto inicial a CALIBRAR com o tamanho real de alunas com Health Connect.
- **PENDENTE (Elton pediu para explicar depois — NÃO implementar sem aprovação, risco alto: prescrição):** limitar sono/HRV enviados à IA a uma janela recente + linha de base, em vez do histórico completo. Campos novos do Health Connect (peso, sinais vitais, nutrição, condicionamento) seguem fora da IA até decisão.

### 23/10/2026 — Etapa 1: dados de relógio com matemática SEPARADA POR FONTE (local, sem commit/deploy)
- **Problema:** sono/HRV/diário podem chegar por Zepp e por Health Connect (que recebe de vários apps). A camada matemática juntava tudo numa série só (média, linha de base, tendência, faixa habitual, excursões), então fontes de métodos diferentes se misturavam e uma troca de aparelho parecia mudança fisiológica. Hoje em produção só há 2 registros de sono (Zepp): correção preventiva.
- **Decisões de Elton (22–23/10/2026):** todas as `wearable.*` são NÃO comparáveis entre fontes, sem exceção; registros originais intactos; fonte principal = preferência explícita (`AthletePrimarySource`) quando ativa, senão a de maior cobertura recente, SEM migração; atualidade conta (fonte ativa = dado nos últimos 7 dias; inativa nunca prevalece); sessão de sono mais longa NÃO é a noite inteira (limitação explícita); desligável por `WEARABLE_SOURCE_SEGMENTATION_ENABLED=false`; texto do prompt só com aprovação dele.
- **Implementado:** `wearable-source.ts` (chave da fonte, ranking, papéis das sessões), `crossSourceComparability` no registro, `sourceKey`/`sessionRole` no leitor, `getVariableSnapshot(..., sourceKey)` filtrando por fonte, `bySource`/`otherSources` no snapshot e contexto compacto (teto de 3 fontes secundárias), evidência pareada de sono pela fonte principal (dia sem a principal é pulado). Uma fonte só = saída idêntica à anterior.
- **Limitações registradas:** (1) `wearable.sleepDurationMin` e demais por noite usam UMA observação por SESSÃO; sono dividido ainda conta como mais de uma "noite" (revisar quando chegar sono real do Health Connect); (2) cobertura da fonte usa dia UTC (só desempate); (3) cada fonte secundária relê a tabela (custo baixo, limitado a 3 fontes); (4) `sourceKey`/`sessionRole` aparecem nas rotas de observações do treinador/aluno.
- **PENDENTE:** texto do prompt de prescrição (aprovação de Elton); revisão independente 2ª rodada; Etapa 2 (aba "Saúde e Recuperação") só depois de validar a Etapa 1; quando chegar o 1º sono/HRV real do Health Connect, rodar de novo as consultas de conferência (datas, sono dividido, método do HRV).
- **Testes vermelhos fora desta frente (não causados por ela):** `correction-pipeline-guards` (ordem da migration mais recente), `legal-content` (texto do PolarConnect), `analytics-instrumentation` (importa funções que não existem em billing/funnel).
- **Revisão independente da Etapa 1:** 1ª rodada REPROVOU (pareada de sono não voltava ao comportamento antigo com a separação desligada; trocava de fonte num dia; sem teto de fontes; fonte pedida ignorada com um grupo só) → corrigido; 2ª rodada APROVOU. **Exceção conhecida (deliberada):** com uma fonte só e separação ligada, uma noite com duas sessões na evidência pareada emite `additionalSessions`/`durationScope` (limitação explícita pedida por Elton); desligar a variável de ambiente remove esses campos. Fontes principais são escolhidas POR VARIÁVEL (sono pode ser uma e HRV outra).
- **23/10/2026 — texto do prompt de prescrição aplicado (aprovado por Elton, com 2 ajustes dele):** dois itens novos em `buildSystemPromptStable` (só no prompt da semana): (1) fontes diferentes não comparáveis / não ler troca de aparelho como mudança do corpo / manter a fonte identificada / NÃO presumir histórico curto na fonte atual (avaliar `evidence.n`, `observedSpan`, `lastObservationAt`) / ausência de fonte ≠ zero; (2) SONO (vale com uma fonte só): observação = UMA sessão, não a noite inteira; sessão curta não prova privação de sono. Hash congelado do prompt `stable` atualizado em `prescription-trace.spec.ts` (anterior 1d4f7543…); `run`/`strength` inalterados. Revisão independente do texto: aprovado (3ª rodada), com 2 correções já feitas. **Aberto:** os agentes de Evolução, Gerente Técnico e Reavaliação também recebem o contexto compacto (`mainSource`/`otherSources`) mas NÃO ganharam essa regra no prompt deles — decisão de Elton.
- **Gates da Etapa 1 (23/10/2026):** tsc limpo; lint = os mesmos 2 erros antigos de `athlete-state-snapshot.service.ts` (provado contra o código anterior à Etapa 1); suíte completa 2536 passam / 2 falham + 1 suíte não compila, todos pré-existentes e idênticos ao baseline (`correction-pipeline-guards`, `legal-content`, `analytics-instrumentation`); `smoke:boot` OK.

### 23/10/2026 — Pendências técnicas SEPARADAS (preexistentes; NÃO fazem parte da Etapa 1 nem do prompt)
Confirmadas contra o código de antes da Etapa 1 (`ea06bcb`): mesmas falhas, mesmas mensagens. Cada uma é uma tarefa própria; nenhuma foi corrigida aqui.
1. **`test/correction-pipeline-guards.spec.ts`** — espera que a migration mais recente seja `20261015120000_medal_award_transitions_and_pending_reevaluation`, mas a mais recente é `20261021220000_user_profile_photo` (foto de perfil, 21/10). Teste desatualizado; correção provável: atualizar a expectativa (ou torná-la independente da ordem). Risco: baixo.
2. **`test/legal-content.spec.ts`** (tela "Privacidade e dados") — espera `<PolarConnect accessToken={accessToken} variant="status" />` em `apps/mobile/App.tsx`, que não existe mais nessa forma (a string entrou em e63dab8/c4a3d1b). Decidir se o teste está obsoleto ou se a tela perdeu o status do Polar. Risco: médio (texto legal/privacidade; ligado à revisão jurídica pendente).
3. **`test/analytics-instrumentation.spec.ts`** — a suíte nem compila: importa `isFirstPaidAcquisition` (billing.service) e `buildCohortSteps` (funnel.service), que existem só em 3481c58 e foram APAGADAS em 617788a (incidente do espelho de 16/09, ver memória `mirror_divergence_617788a_incident`) e nunca restauradas. Investigar se a instrumentação do funil/aquisição foi perdida de verdade ou substituída pela Fase 0/1 do Data Layer (1236ac51/c7174dba). Risco: médio (métricas de aquisição/Meta CAPI).
4. **Lint** — 2 erros antigos em `apps/api/src/training-intelligence/athlete-state-snapshot.service.ts` (`'_observations'` e `'_obs'` declarados e não usados). Corrigir tirando a desestruturação com variável não usada.
5. **Testes instáveis sob carga** (passam isolados): `ios-store-compliance.spec.ts` e `backup-r2.spec.ts` falharam só na suíte inteira por lentidão. Considerar timeout maior ou isolar.
6. **`/health` com versão estática** (`2026.07.03-r7`, `planEngine: "rules-v6"`): não identifica o commit em execução (por isso não dá para confirmar, de fora, qual deploy está no ar) e o rótulo "rules" é enganoso (a prescrição é só por IA). Proposta: expor o hash do commit do build.

### 23/10/2026 — Etapa 2: aba "Saúde e Recuperação" no painel do treinador (local, sem commit/deploy)
- **O que é:** nova aba no perfil do aluno (admin). Sono, HRV, FC de repouso, passos e calorias ativas; período LIVRE (data inicial/final, atalhos opcionais 7/30/90/6 meses/todo o histórico), escolha de fonte, comparação entre dois períodos, fonte + última medição + última sincronização por indicador, estados (recebendo / sem dados / não autorizada / fonte sem o indicador). Somente leitura; sem tabela e sem migração.
- **Backend:** `GET /coach/students/:studentId/health-recovery?from=&to=&source=&compareFrom=&compareTo=` (`coach/student-health-recovery.service.ts` + funções puras em `coach/health-recovery.ts`). Estatísticas (n, média, mín., máx., primeiro/último, tendência por reta de melhor ajuste) e diferença entre períodos calculadas NO SERVIDOR com `MathLayerService`, sobre o período escolhido, sempre com `n`.
- **Privacidade (decisão):** a autorização vem do MESMO cálculo da aba Integrações (`StudentIntegrationsService.forStudent`: conexão ativa + texto vigente + categoria concedida). Categoria/fonte não autorizada ⇒ nada aparece e o estado diz "não autorizada". As duas conexões (Zepp e Health Connect) já têm a finalidade obrigatória `coach_view`. LACUNA encontrada e tratada: os textos de consentimento não diziam explicitamente que o treinador VÊ esses dados. Ajustes: Health Connect v1.1→1.2 (frase explícita; invalida autorizações antigas desse documento — fail-closed, build 13 ainda não liberado) e Política (treinador vê no painel os dados autorizados). **Zepp NÃO foi alterado de propósito** (mudar o texto suspenderia a importação das alunas já conectadas); fazer na próxima revisão do texto da Zepp, quando se aceitar pedir reconfirmação. Revisão jurídica da Política segue pendente.
- **Fontes:** nunca misturadas; um indicador por fonte por vez; fonte automática = a principal (mesma regra da Etapa 1: ativa vence parada, depois cobertura). HRV: nota de método por fonte (Zepp: média da noite, unidade não especificada; Health Connect: RMSSD em ms, média do dia).
- **Sono dividido (resolvido na tela):** sessões da mesma fonte/data → principal (maior), adicional (divisão noturna), cochilo (adicional entre 9h–19h no horário local da fonte, ou campo `napTotalSec` da Zepp — regra de EXIBIÇÃO, dita na tela). Total da noite só quando seguro: uma sessão; várias sem sobreposição somam; contida em outra não soma; sobreposição parcial/sem duração ⇒ total indeterminado com a limitação dita. Etapas só se todas as sessões contadas as informam. Nenhum registro descartado. Testes sintéticos cobrem os cenários ainda não vistos no Health Connect.
- **LIMITAÇÃO conhecida:** o ATLAS continua lendo uma observação por SESSÃO de sono (Etapa 1, com a limitação explícita no prompt); o total da noite sem sobreposição existe só no painel. Unificar exigiria nova variável/mudança de matemática da IA (alto risco) — decidir depois com dado real.
- **Verificação visual:** feita no navegador local com a API simulada (dados sintéticos), página temporária já apagada: sono (barras empilhadas por etapa, cochilo separado, noites sem total), HRV por fonte, troca de fonte, comparação, todo o histórico (150 dias), estado "não autorizada", celular.

### 23/10/2026 — Polar: saúde e recuperação (sono, HRV/Nightly Recharge, atividade diária) — LOCAL, sem commit/deploy, DESLIGADO por padrão
- **Auditoria:** a integração Polar só importava EXERCÍCIOS (fluxo por transação `exercise-transactions`, que a documentação oficial da AccessLink marca como OBSOLETO, apontando para `GET /v3/exercises`). Webhook só para `EXERCISE` e o método `register` nunca é chamado; quem sincroniza é a rotina horária. Endpoints oficiais para saúde (todos com o escopo que já temos, `accesslink.read_all`): `GET /v3/users/sleep` (28 dias), `/nightly-recharge` (28 dias), `/activities` (até 365 dias em janelas de 28), `/continuous-heart-rate`; a Polar NÃO tem FC de repouso diária.
- **PENDÊNCIA SEPARADA (não alterada nesta entrega):** migrar o fluxo de EXERCÍCIOS para `GET /v3/exercises` (os endpoints por transação estão obsoletos; sem data de desligamento publicada).
- **Diagnóstico administrativo TEMPORÁRIO (a remover depois de usar):** `GET /polar-admin/probe` (`polar-probe.*`), somente leitura, admin, 404 sem `POLAR_PROBE_ENABLED=true`; só roda com exatamente UMA conexão Polar ativa; devolve só estrutura (status HTTP, nomes de campos, formato de datas com dígitos mascarados, faixas numéricas e a conta da duração do sono). Nenhum dado gravado, nenhum log, nenhum token. **O resultado AINDA NÃO FOI OBTIDO**: exige deploy (nunca se roda a API local contra o banco de produção).
- **Autorização por categoria SEM reconectar:** linha própria `ProviderConnection` com provider `polar_health` (separada da decisão do Atlas, provider `polar`), grupos `sleep`, `hrv`, `daily_activity`, texto v1.0 com hash; sem registro = nada de saúde é importado (fail-closed). Retirar um grupo apaga os dados dele na mesma transação; desconectar a Polar encerra a autorização de saúde; excluir dados da Polar apaga a saúde importada. Rotas do app: `GET/POST /polar/health-consent`; cartão `PolarHealthConsentCard` na tela da Polar.
- **Importação:** `PolarHealthIngestionService` (`POLAR_HEALTH_ENABLED=true` para ligar; padrão desligado), gatilho = rotina horária da Polar + uma importação logo após autorizar. Grava em `WearableSleepSummary/HrvSummary/DailySummary` com provider `polar`, reconferindo a autorização DENTRO da transação (FOR SHARE). Mapeamento (a CONFIRMAR com o diagnóstico): duração do sono = leve+profundo+REM informados pela Polar; HRV = `heart_rate_variability_avg` do Nightly Recharge (média da NOITE, unidade não convertida); diário = passos, `distance_from_steps`, `active_calories`; sono sem fuso explícito é ignorado.
- **IA:** saúde da Polar (e Wahoo) fica SEMPRE bloqueada para o Atlas (`AiDataEligibility.scopeFor`); usar essa saúde na IA exigirá autorização própria e decisão de Elton.
- **Painel:** Polar aparece na aba Integrações (categorias de saúde autorizadas × recebidas) e na Saúde e Recuperação como fonte "Polar" (nota própria do HRV; nunca FC de repouso).
- **Próximos passos:** (1) Elton faz deploy, liga `POLAR_PROBE_ENABLED=true`, abre o diagnóstico logado como admin, copia o resultado; (2) conferir unidade do HRV, conta da duração e formatos de data; (3) ligar `POLAR_HEALTH_ENABLED=true` e Elton autoriza os grupos no app; (4) remover o diagnóstico; (5) opcional: webhook `SLEEP`/`ACTIVITY_SUMMARY` no lugar da rotina horária; (6) decidir se a saúde da Polar vai ao Atlas.
- **Revisão independente da Polar saúde (23/10/2026):** 1ª rodada REPROVOU (diagnóstico podia usar a conexão de outra conta e devolvia valores por noite; retirar grupos não apagava dados quando o texto mudava/desconectava; rotina podia ficar presa em linhas inelegíveis) → corrigido; 2ª rodada APROVOU. Mudanças: diagnóstico usa a conexão do PRÓPRIO admin (uso da conexão única só com `POLAR_PROBE_ALLOW_SINGLE_CONNECTION=true`) e devolve só diferenças agregadas; `set()` apaga sempre o que não está selecionado; rotina ordena por `lastSyncCompletedAt` e gira linhas inelegíveis; texto "normalmente os últimos 28 dias".
- **Guardas arquiteturais alargadas (decisão registrada):** `test/zepp-oauth.spec.ts` agora isenta `polar/polar-health*` da regra "pipeline Polar não cita ProviderConnection" e inclui `polar-health-consent.service.ts` e `polar-health-ingestion.service.ts` na lista de quem pode usar `.providerConnection.` (mesmo precedente do Health Connect). `polar.service.ts` (exercícios/conexão) continua SEM tocar na conexão genérica: delega ao serviço de saúde via `@Optional()`. Nenhum desses arquivos lê token da linha `polar_health`.
- **Variáveis de ambiente novas (todas desligadas por padrão):** `POLAR_PROBE_ENABLED`, `POLAR_PROBE_ALLOW_SINGLE_CONNECTION`, `POLAR_HEALTH_ENABLED`. **Antes de ligar `POLAR_HEALTH_ENABLED`:** rodar o diagnóstico, conferir unidade do HRV, conta da duração do sono e formatos de data; testar o `FOR SHARE` uma vez contra banco LOCAL de teste (nunca produção).
- **Gates:** tsc API/mobile limpos; lint sem erro novo; `smoke:boot` OK; 38 testes novos; suíte completa 2608 passam, 2 falham + `analytics-instrumentation` não compila (as mesmas 3 pendências antigas já registradas, sem relação).

### 23/10/2026 — Polar: RESULTADO DO DIAGNÓSTICO REAL (conta de Elton) e ajustes
- **Conexão existente serve SEM nova autenticação:** os 4 endpoints responderam 200 com dados reais (sono 28 noites, Nightly Recharge 26, atividade diária 29 dias, FC contínua 6 dias). Nenhum 403.
- **Formatos reais:** `sleep_start_time/sleep_end_time` = ISO com MILISSEGUNDOS e fuso (o mapeador já aceita); a lista de sono vem em `{nights}`, Nightly Recharge em `{recharges}`, FC contínua em `{heart_rates}` (amostras `heart_rate`/`sample_time`), atividade diária é um array SEM campo `date` (`start_time` sem segundos, ex.: dia no formato AAAA-MM-DDTHH:mm).
- **Duração do sono:** para noites completas, intervalo (fim − início) = leve + profundo + REM + interrupções (a diferença mínima foi 0); logo leve+profundo+REM é exatamente o tempo DORMINDO e `total_interruption_duration` é o tempo acordada. Decisão mantida: `durationSec` = leve+profundo+REM. Descoberta: a lista traz noites com TODAS as etapas = 0 e pontuação 0 (o relógio não mediu sono naquela janela); ficam FORA (ausência de medição, nunca "noite de 0 min").
- **HRV:** a métrica da Polar é o RMSSD calculado a partir dos intervalos batimento a batimento, medido nas PRIMEIRAS horas de sono (Nightly Recharge), não a média da noite toda. A documentação da API lida não declara a unidade, mas RMSSD é em ms e as faixas observadas são compatíveis (e `beat_to_beat_avg` em ms bate com a FC média). Na tela: "ms (RMSSD)" com nota dizendo que a unidade é inferida e que o método difere da Zepp (média da noite) e do Health Connect (média do dia).
- **Dado em aberto:** o campo `date` do sono (data de despertar ou de início) não pôde ser comprovado pelo diagnóstico agregado; usamos o `date` da Polar como está, só dentro da própria fonte.
- **Não importado (decisão):** FC contínua (5 em 5 min) e SleepWise/Cardio Load ficam para depois; FC de repouso diária não existe na Polar.
- **Próximo:** deploy deste ajuste → `POLAR_HEALTH_ENABLED=true` → Elton autoriza os grupos no app (conta de aluno) → conferir no painel → remover o diagnóstico (`polar-probe*`) e as variáveis `POLAR_PROBE_*`.

### 23/10/2026 — Carga de treino PRÓPRIA (aba "Carga (própria)" no painel) — LOCAL, em AVALIAÇÃO, o Atlas NÃO usa
- **O que é:** métrica descritiva do Panzeri Run, pedida por Elton para ficar EVIDENTE no painel. Carga da sessão = esforço percebido (1–10, informado pela aluna) × minutos (método sRPE, Foster), em UA. Semana (segunda–domingo) = soma. Aguda = últimos 7 dias; crônica = média semanal dos últimos 28 dias (soma ÷ 4); razão = aguda ÷ crônica (só com 28 dias de histórico). Treino não feito, sem esforço ou sem duração NÃO entra (nunca vira zero, nada é estimado) e aparece em "Ficaram de fora" com o motivo.
- **Onde:** nova aba no perfil do aluno, com selo roxo "NOVO · em avaliação", banner "MÉTRICA NOVA — EM AVALIAÇÃO", caixa "Como foi calculada" (fórmula, passos, exemplo com o treino mais recente, o que fica de fora), cada treino com "esforço × minutos = carga", gráfico semanal + razão (linha de referência 1,0, SEM faixa de bom/ruim) e uma caixa "Para você pensar e decidir" com 6 perguntas abertas.
- **Backend:** `GET /coach/students/:studentId/training-load?from&to` (`coach/student-training-load.service.ts` + funções puras `coach/training-load.ts`). Lê `WorkoutCompletion` (done/adjusted) + sessão; data = `scheduledDate` da sessão, ou a data local de São Paulo da conclusão. Somente leitura, sem tabela/migração, restrito a coach/admin. NÃO importado por nenhum arquivo da IA (teste garante).
- **Perguntas abertas (para Elton):** esforço × minutos é a medida certa? janela 7×28 dias? usar a duração da atividade importada quando a aluna não informa? separar força/fortalecimento da corrida? o Atlas deve ver esta carga (só descrição)? comparar com o Training Load Pro da Polar?
- **Limitação:** depende de a aluna informar o esforço e a duração; sem isso o treino fica de fora e a razão usa só o informado (a tela avisa).
- **Revisão independente da carga própria:** APROVADA COM RESSALVAS (nenhum ponto alto); ressalvas corrigidas: a barra da semana agora é recortada pelo período escolhido (bate com a lista; semana marcada como recortada); período no futuro é limitado a hoje; o texto da tela diz que a data é o DIA AGENDADO e que a crônica INCLUI a semana da aguda; frase corrigida para "usa o que está registrado no feedback do treino" (não afirma que não toca em relógio); minutos exibidos com a precisão usada na conta; razão calculada sem arredondamento em cascata; testes novos (semana cortada, futuro, data agendada, minutos fracionários, status desconhecido).

### 23/10/2026 — Carga (própria) v2: data real, visões por modalidade e duração da atividade vinculada (LOCAL, em avaliação, Atlas NÃO usa)
- **Pedido de Elton (3 ajustes), mantendo sRPE = esforço × minutos e a razão 7/28 só descritiva (sem faixa de risco nem recomendação):**
  1. **Data real:** a carga entra no dia em que o treino foi EXECUTADO = dia local da atividade importada com vínculo ATIVO (`SessionExecutionLink`); sem atividade, a data programada, marcada "só programada"; sem sessão programada, o dia do registro, marcado "só registro". Nunca se inventa data. A tela conta quantos treinos têm data real × só programada × só registro.
  2. **Modalidade:** visões Corrida (inclui esteira), Força (inclui fortalecimento de corredores), Outras e **Geral** — esta identificada na tela como "soma de cargas sRPE de modalidades diferentes". Barras, razão e janelas são calculadas por visão (servidor); filtro na tela.
  3. **Duração:** a informada pela aluna vence; se faltar e houver UMA atividade importada confirmada para o treino, usa a duração dela e a tela mostra a origem ("atividade Polar/Health Connect/..."). Só serve com: vínculo ativo; um único evento físico (observação CANÔNICA, `pickCanonicalPerEvent`; dois eventos distintos no mesmo treino = ambíguo, nada é usado); a mesma atividade nunca serve a dois treinos; nunca Strava (dados do Strava não são exibidos ao treinador). O esforço percebido NUNCA vem da atividade.
- **Versão do cálculo:** `carga-propria v2 (23/10/2026)`. Resposta da API agora traz `views` (geral/corrida/forca/outras) e `sources`.
- **Limitações a lembrar:** o dia real vem do início da atividade no fuso informado pela fonte (sem fuso, São Paulo); vínculo errado entre treino e atividade levaria a data/duração erradas (a reconciliação já existente é quem confirma o vínculo).
- **Revisão independente da v2 (aprovada com ressalvas; corrigidas):** (1) dia da atividade sem fuso informado é marcado "data real · fuso presumido (SP)"; (2) o deslocamento programado × executado aparece na tela ("programado dd/mm · executado +N dia(s)") e vínculo a mais de 6 dias do dia programado (mesmo limite do vínculo manual da aluna) é IGNORADO, vale a data programada com aviso "vínculo distante ignorado"; (3) a mesma atividade em dois treinos fica com o de dia programado mais próximo (empate: registrado primeiro), o outro recebe "atividade já usada por outro treino"; (4) sessão extra materializada de atividade (`source device_extra`) tem a duração rotulada como DA ATIVIDADE (não "informada pela aluna") e a data é a da atividade; (5) o rodapé de origem passa a seguir o filtro de modalidade e o filtro volta ao "Geral" se a modalidade some do período; modalidade bruta do provedor (ex.: RUNNING) usa a modalidade canônica. Perguntas abertas acrescentáveis: a razão por modalidade parte da 1ª sessão daquela modalidade (modalidade nova pode ter razão "completa" no 28º dia).

### 23/10/2026 — Carga (própria) v3: decisões de Elton aplicadas (LOCAL, em avaliação, Atlas NÃO usa)
- **Mínimo de 10 treinos:** a razão (aguda ÷ crônica) só existe com 28 dias de histórico E pelo menos 10 treinos que entraram na conta nos últimos 28 dias (por visão; `MIN_SESSIONS_IN_WINDOW`). Abaixo disso a tela diz "só X de 10 treinos". Elton: "se não teve pelo menos 10 treinos essa métrica não vale muito".
- **Duração:** com relógio sincronizado (UMA atividade importada corretamente vinculada) vale a duração DELA; sem atividade vale a informada pela aluna (o feedback só salva com ela). Se a informada for diferente da do relógio, a tela mostra as duas ("a aluna informou X min").
- **Vínculo:** automático a mais de 3 dias do dia programado é ignorado (valia 6); vínculo confirmado por PESSOA (origem `student`/`coach`) vale até 6 dias e fica marcado "vínculo confirmado por pessoa". O dia programado já reflete reagendamento. **Pendência/dúvida:** não encontrei no código a mensagem que pergunta à aluna "treino extra ou de outro dia" após 3 dias — só existem o vínculo automático do mesmo dia, o vínculo manual de até 6 dias e `rescheduleSession`. Perguntar a Elton se essa mensagem já existe em outro lugar ou precisa ser construída.
- Arquivos: `training-load.ts`, `student-training-load.service.ts`, `student-training-load.tsx`, `training-load.spec.ts` (46 testes). Gates: tsc api/admin ok, lint ok, smoke:boot ok, suíte completa só com as 3 falhas antigas (correction-pipeline-guards, legal-content, analytics-instrumentation).

### 23/10/2026 — Treino extra no app da aluna: resposta própria, verde escuro e pace automático (LOCAL, só `apps/mobile/App.tsx`)
- Pedido de Elton após registrar um treino extra vindo do Polar: (1) resposta "Esse foi um treino extra" no feedback (no lugar de "Fiz como estava planejado"/"mudei"; "Nao fiz" permanece; o valor enviado continua `done`, sem mudança de servidor); (2) cartão do extra feito em verde escuro (borda `#15803d`) com texto "✓ Treino extra realizado", distinto do verde claro da rotina; (3) pace calculava só ao mexer nas rodas: agora também é calculado ao abrir o formulário (tempo ÷ distância) quando não há dado `realized` do relógio e ao reabrir feedback salvo sem pace. Helpers `isExtraSession` e `isRunSession`.
- Limite conhecido: para atividade alternativa o pace vem de tempo÷distância, não do pace medido pelo relógio (a API de alternativas não entrega o pace). Aluna no PWA precisa reinstalar o ícone para ver (SW cacheia).

### 23/10/2026 — Equipamentos (tênis + relógios) e Inteligência de Equipamentos no painel (LOCAL, sem commit/deploy/migração aplicada)
- **Schema (migração aditiva `20261023120000_equipment_intelligence`, NÃO aplicada):** `Shoe.version`; tabelas `ShoeEvent` (append-only: registered/edited/retired/reactivated; backfill do cadastro e da aposentadoria já existentes), `ShoePhoto` (JPEG ≤60 KB, mesmo padrão da foto de perfil), `UserDevice` (fabricante ≠ modelo ≠ plataforma; colunas `observed*` = proveniência técnica nunca sobrescrita; `manual*` = correção do aluno; reconstruível das atividades). Exclusão de conta atualizada (shoeEvent, shoePhoto, userDevice).
- **API:** `src/equipment/*` (núcleo puro `equipment-core`, fatos `shoe-facts` em lote, `shoe-stats`, `equipment-analysis`, `devices.service`, `equipment-intelligence.service`). `ShoesService` reescrito sobre os fatos (km pela atividade canônica; mesmo evento nunca soma 2×; musculação fora; faixas exclusivas; pace = tempo total ÷ distância total; maratona/meia só com TargetRace no mesmo dia e distância plausível — corrida longa sem prova vira "candidata"). Rotas novas: `/me/shoes/:id/reactivate`, `/me/shoes/:id/photo`, `/me/equipment/devices` (GET/POST/PATCH), `/coach/equipment/options|intelligence` (coach/admin) e `POST /coach/equipment/refresh-devices` (admin).
- **Privacidade do painel:** só agregados; grupos e resultado com <3 alunas não saem (decisão desta data); pace só com ≥3 alunas; Strava nunca fornece dado (inclusive quando a observação canônica é Strava).
- **UI:** app do aluno `src/equipment/EquipmentScreen.tsx` (Tênis | Relógios; substitui "Meus tenis"); painel `apps/admin/app/equipment-intelligence.tsx` (menu Alunas > Equipamentos).
- **Revisão independente:** REPROVOU na 1ª rodada (Strava via canônica no volume; piso de privacidade só no pace; maratona sem teto; dedupe com escopo diferente entre lista e detalhe; chave de dispositivo; aposentar sem atomicidade) — corrigido e coberto por teste. Descartado com evidência: data da corrida sem atividade usa `completedAt` = "Data realizada" informada pela aluna.
- **Limitações abertas:** migração/backfill não executados contra banco (sem banco local); dispositivos só são reconstruídos quando a aluna abre a tela ou o admin aciona "atualizar base" (sem cron; histórico começa quando passa a ser reconstruído); `forStudent` relê as atividades do aluno a cada abertura; leitura de toda a base a cada consulta do painel (ok hoje, cachear antes de ~1000 alunos); volume do aluno só considera atividades importadas; "atividades" do relógio é histórico total; tela do aluno sem verificação visual (sem como mockar a API com segurança).

### 23/10/2026 — Equipamentos: ajustes finais (registro automático, privacidade, migração validada) — LOCAL, sem commit
- **Registro automático de dispositivos:** `DeviceRegistryService` (novo, módulo próprio `DeviceRegistryModule`). Polar, Wahoo, Zepp, Health Connect e Apple Saúde chamam `scheduleRefresh(userId)` depois de gravar a atividade (hook best-effort, não bloqueia nem derruba a ingestão; várias atividades do mesmo aluno em 20 s viram uma reconstrução). Rede de segurança: varredura diária às 04h e uma 2 min após cada boot (alunos com atividade recente ou com atividade e sem dispositivo; cobre histórico anterior). Reconstrução idempotente; proveniência (`observed*`) intocada; correção manual preservada; linha "sem modelo" absorvida pela identificada é removida (a correção manual migra). A tela do aluno não reconstrói mais nada; o botão admin continua como override.
- **Privacidade do painel (decisão de Elton):** contagens (alunos, equipamentos, marcas, modelos) sempre exatas, inclusive com base pequena. Só o DESEMPENHO (corridas, km, pace, faixas, km acumulado, atividades de relógio) é ocultado em grupo com menos de 3 alunas COM corrida e no total do resultado com menos de 3 alunas. Removido o "belowMinimum" e o piso nas opções de filtro. Risco aceito/registrado: diferença entre grupos pode revelar desempenho residual quando o total passa de 3 (revisor, A3); filtrar por marca/modelo raro mostra contagem de 1 aluna sem identificá-la (A5).
- **Migração validada num Postgres de teste (PGlite, WASM, sem produção):** estrutura anterior completa + tênis ativos/aposentados (um sem data de aposentadoria) + vínculos com atividades → migração → 23/23 verificações (nenhum tênis perdido, tabelas existentes idênticas por hash, eventos históricos corretos: 1 registered por tênis + retired só com data, nada além; FKs/unicidade das novas tabelas) + 31/31 com Prisma real e o código da aplicação (estatísticas, aposentar/reativar preservam estatísticas e vínculos, toque duplo = 1 evento, dispositivos idempotentes e correção manual preservada, painel e filtros, exclusão de conta sem violar FK). Scripts em `%TEMP%\...\scratchpad\migtest` (fora do repositório).
- **Verificação visual da tela do aluno (local, API de teste + banco de teste):** lista compacta, detalhe (km, corridas, pace, maratona/meia confirmadas, faixas, km por mês), aposentar com retrospectiva, reativar, aba Relógios com fabricante/modelo/plataforma e plataformas conectadas. Achados corrigidos: data de início aparecia um dia antes (fuso) e textos ("— acumulados", parênteses aninhados, "Atividades recebidas: —").
- **Gates:** tsc api/admin/mobile verdes; smoke:boot ok; equipment.spec 58 testes; suíte completa só com as 3 falhas antigas (analytics-instrumentation, correction-pipeline-guards, legal-content); lint: 2 erros antigos de variável não usada em polar/wahoo-activity-ingestion (não tocados). Revisão independente: aprovada com ressalvas; A1 (linha obsoleta) e A2 (critério por alunas com corrida) corrigidos e testados.

### 24/10/2026 — Inteligência de Equipamentos: redesenho visual e nomes de relógios (LOCAL, sem commit)
- **Redesenho (só apresentação; mesma API, mesmos cálculos e permissões):** `apps/admin/app/equipment-intelligence.tsx` + bloco `eq*` de `styles.css`. Três visões (Visão geral | Tênis | Relógios); KPIs com ícone; barras horizontais (marcas, modelos, fabricantes, plataformas com "enviando dados x sem envio") e colunas (km acumulado, faixas de distância); filtros num painel lateral (bottom sheet no celular) com período sempre visível no topo, etiquetas de filtros ativos removíveis (remover aplica na hora) e "Limpar todos"; comparação com período anterior (KPIs); detalhe de marca/modelo/fabricante em painel lateral (com modelos da marca, faixas, "só contagem" quando <3 alunas com corrida); tabelas detalhadas preservadas em seções recolhíveis; estados vazios. Modo escuro pelo mecanismo do painel (`data-tema="escuro"`). Sem dependência nova.
- **Nomes:** identificador técnico (ex.: `run.10092807.huami.com`, `Watch7,2`) nunca é exibido como modelo: `looksTechnicalIdentifier` + `effectiveDevice` mostram "Modelo não identificado" e preservam o identificador (`technicalId`; nos detalhes do painel e na tela da aluna). A fonte continua gravada como veio (proveniência); correção manual da aluna vale como modelo. "Não identificado" fica por último nos gráficos.
- **Verificação visual real:** página temporária (apagada) com dados sintéticos geradas pela análise REAL; desktop, celular, claro/escuro, filtros abertos/ativos, detalhes, estados vazio e de desempenho oculto. Achado corrigido: modelos da marca ignoravam variação de caixa ("Asics" x "ASICS") no painel de detalhes.
- **Atenção operacional:** `next dev` e o export estático do admin usam a mesma pasta (`apps/admin/.next-build`); rodar o dev sobrescreve o conteúdo que o `scripts/serve-static.mjs` serve. Para voltar a servir o build estático é preciso `next build` (não executado, sem autorização).

### 24/10/2026 — Bug: gráfico "Volume por semana" somava os extras duas vezes (CORRIGIDO, LOCAL, sem commit)
- **Sintoma (Elton):** semana 19–25/10 com 5 + 16 + 5 (extra) + 16 km: histórico, texto "O que os números de volume mostram" e cartão "Total" corretos (41,6 km), mas o gráfico marcava 47 km; "No período" (481 km) ficava MAIOR que o "Total" geral (473 km), o que é impossível.
- **Causa raiz (FATO):** a API define `kmPercorridos` JÁ INCLUINDO os extras (`evolution.types.ts`: "Já incluso em kmPercorridos"; `variable-registry`: "JÁ INCLUINDO sessões extras"; teste `evolution-metric-adherence-extra.spec`: 21 + 7 extras = 28). O app (`apps/mobile/App.tsx`) somava `kmPercorridos + kmExtras` em quatro pontos: série do gráfico, "No período", média por semana e "Melhor sem.". Inserido no commit e20ec79 ("percorrido inclui extras") quando o contrato ainda era outro; o contrato mudou (03/10, atividades objetivas) e o app ficou para trás. Só inflava semanas com extra (por isso as outras semanas pareciam certas).
- **Correção:** os quatro pontos passam a usar só `kmPercorridos`. Teste de contrato novo `test/evolution-volume-contract.spec.ts` (o app nunca soma `kmExtras` a `kmPercorridos` e usa o mesmo valor em gráfico/total/média/melhor semana).
- **Mesma classe, verificada:** demais consumidores corretos (API, medalhas, Training Intelligence usam `kmPercorridos`, e `kmPercorridos − kmExtras` para o "só prescrito"); o painel admin não consome esses campos.
- **RISCO ESTRUTURAL ABERTO (não alterado):** existem DOIS agregadores independentes de km semanal: `EvolutionMetricService.buildWeeklyVolumes` (gráfico/Evolução/medalhas/IA; atividade conta na semana da DATA REAL) e `TrainingPlansService.getStudentHistory` (`totalKmDone`, grade do Histórico; sessão vinculada conta na semana da data PROGRAMADA e soma qualquer modalidade com distância). Hoje coincidem nos casos comuns, mas divergem quando a corrida é feita em outra semana que a programada (ex.: programada domingo, feita segunda) e por modalidade. Proposta: fonte única de volume semanal consumida pelos dois — aguardando decisão de Elton.

### 24/10/2026 — Fonte única de km semanal, PWA que se atualiza sozinho e Observatório Panzeri Run (MVP) — LOCAL, sem commit
- **Km semanal (regra única):** `common/weekly-volume.ts` (`weekStartOf`); o total km da grade do Histórico (`getStudentHistory.totalKmDone`) passou a cair na semana do DIA LOCAL DA EXECUÇÃO (atividade canônica), igual ao gráfico da Evolução; a grade de sessões continua por data programada; treino manual sem atividade segue a data programada nos dois. Teste de consistência `weekly-volume-consistency.spec.ts`. **Divergências restantes NÃO alteradas:** modalidade (Evolução só corrida/esteira; Histórico soma qualquer modalidade com distância), corte histórico `TRAINING_INTELLIGENCE_DATA_CUTOFF` (só na Evolução) e classificação de execução (Evolução só `corresponding`/`alternative`).
- **PWA se atualiza sozinho:** `apps/mobile/src/appUpdate/*` (+ uma linha no `App.tsx`): só na web; compara o bundle em execução com o publicado (`fetch('/', {cache:'no-store'})`) ao abrir, ao voltar do segundo plano (≥30 s) e a cada 15 min; recarrega uma vez por versão se a aluna não estiver digitando, senão mostra faixa "Nova versão disponível — Atualizar". Teste `app-update.spec.ts`. Causa do problema antigo: no iPhone, sair e voltar só retoma o JS antigo em memória.
- **Observatório (MVP, desligado por padrão):** módulo isolado `apps/api/src/observatory/*` + `apps/admin/app/observatory.tsx` e `viz.tsx` (primitivas de gráfico compartilhadas com Equipamentos). Só admin; `OBSERVATORY_ENABLED=true` liga; sem `OBSERVATORY_REAL_DATA=true` serve SÓ dados sintéticos. Base canônica (`observatory-facts.ts`): evento físico deduplicado, dia local da execução, semana segunda–domingo, ambíguos fora (contados), Strava direto/indireto fora (e completion vinculada a atividade excluída nunca vira "treino manual"), extra sem soma dupla, manual×manual deduplicado. Dor (contrato de Elton): treino sem relato = 0, "sem dor" explícito = 0, relato = nota 1–10, relato sem nota = intensidade desconhecida; relatos por 1.000 km, intensidade média dos relatos (sem zeros) e geral (com zeros, por treino), pontos por 1.000 km, faixas 1–2/3–4/5–6/7–8/9–10 por 1.000 km, cobertura; PainReport↔painFlag sem duplicar; exposição anterior de 28 dias (só dados anteriores ao treino). Pace = tempo total ÷ distância total; comparação entre grupos atuais e grupo fixo (8 primeiras semanas completas, nunca reclassificado). Privacidade: piso de 5 participantes distintos (cliente não reduz), células pequenas AGRUPADAS em "Demais grupos" (totais fecham), tamanho exato de grupo pequeno não sai (`participants: null`), pace só com ≥5 pessoas com pace, nada identificável. Dimensões sono/estresse/fadiga/recuperação/esforço/experiência/outras modalidades aparecem como "em preparação" (sem gráfico simulado).
- **Revisão independente (REPROVOU na 1ª rodada; corrigido):** Strava/ambígua entrando como treino manual; `participants` exato de linha suprimida; supressão complementar só com 1 célula; pace com 1 contribuinte; manual×manual; treino sem km inflando a taxa; "5:60/km"; floats nas faixas; parâmetros repetidos; período máximo 2 anos. **Riscos residuais conhecidos:** diferença entre consultas com filtros quase iguais ainda pode revelar subconjuntos pequenos (mitigado, não eliminado); o grupo fixo é definido dentro do período escolhido (mudar a data inicial muda quem entra); data do treino manual = data informada no registro; `loadRealFacts` lê ActivityLog com `providerMetrics` de todas as alunas no período (sem cache; ok no volume atual, a otimizar antes de escalar); filtro `accountStatus='active'` (viés de sobrevivência); sem trilha de auditoria de acesso.
- **Antes de habilitar sobre dados reais:** validar base legal, finalidade, transparência (termos) e contratos dos provedores; revisão jurídica de Termos/Política já está pendente. Verificação do carregador real feita contra Postgres de teste (PGlite), nunca produção.

### 24/10/2026 — Bug: "Registrar ciclo menstrual" sumiu do menu das alunas (CORRIGIDO, LOCAL, sem commit)
- **Causa (FATO, lida no código):** o menu mostra o ciclo só se `savedMe.sex === 'Feminino'`. O formulário "Suas informações" do Perfil (`Anamnese`, `PUT /me/anamnese`) enviava `sex: 'prefiro_nao_informar'` fixo (2 pontos, desde `01c5751`/`f41ad3f`) e o servidor gravava em `User.sex` — toda aluna que salvou esse formulário perdeu o "Feminino". A reconclusão da entrevista (`e9878e3`) não é a causa.
- **Correção:** app envia `savedMe?.sex` (3 pontos agora iguais); `updateAnamnese` no servidor nunca deixa o placeholder sobrescrever sexo já informado (protege PWAs antigos). Teste: `apps/api/test/sex-preservation.spec.ts`.
- **Dados já afetados (DESCONHECIDO quantas):** reparo preparado em `REPARO_SEXO_ALUNAS.sql` (passo 1 só lê; passo 2 restaura da entrevista) — NÃO executado, depende de autorização do Elton. Quem nunca preencheu entrevista com "Feminino" não é recuperado.

### 24/10/2026 — Apple (build 13 rejeitado: 2.1(a) contas com conteúdo + 2.1 conta expirada): contas de revisão sintéticas (LOCAL, sem commit; NADA executado em produção)
- **Diagnóstico:** a única conta de revisão (aluno "Testando") tinha histórico real na Apple/RevenueCat e oscilava entre ativa/expirada; conta expirada não mostra conteúdo. O app iOS só aceita `student` (treinador/admin = web), então só são necessárias duas contas. Build 13 = commit `ccccaef`; as correções são de **dados/servidor**, sem nova build.
- **Implementado:** `apps/api/src/app-review/{review-accounts,cli}.ts` — `node dist/app-review/cli.js status | seed --yes`. Conta A (ativa: `manual_active`, provedor `revenuecat`, override manual → "Gerenciar assinatura na loja", nada a revoga; 5 programas, 20 sessões, 19 execuções, tênis, prova alvo, ciclo) e B (expirada: `canceled` + `revenuecat`, sem registro de loja, programa travado). Idempotente, id derivado do e-mail, só e-mails `revisao-apple-*`, recusa e-mail de outra conta. Senhas só por variável de ambiente.
- **Validado (banco local `_test`, API real, app web exportado, login real):** A abre com treino de hoje, semana 3/4, gráfico, feedbacks, conquistas, prova alvo, menu com Ciclo e Equipamentos, Conta "Ativa" + "Gerenciar assinatura na loja"; B abre, mostra programa travado + oferta e "Assinatura expirada". Teste de integração `test/integration/app-review-accounts.int.spec.ts` (2) passa; `tsc` e eslint limpos.
- **Modelo de pagamento (fundamento):** IAP-only no iOS (3.1.1); assinante do site mantém acesso (3.1.3(b)); 3.1.3(d) NÃO se aplica (prescrição assíncrona). Compatível; sem mudança estrutural. Detalhes e textos para a Apple em `RUNBOOKS/2026-10-24-CONTAS-REVISAO-APPLE.md`.
- **PENDENTE (bloqueia "pronto para reenviar"):** Elton autorizar/rodar o seed em produção; validar no aparelho com a build 13 (loja com preço real, compra Sandbox, restaurar, "Ver planos e preços"); produto `panzeri_run_mensal` aprovado no App Store Connect; conferir `REVENUECAT_SECRET_API_KEY` em produção; reexecutar o seed na segunda-feira se a revisão atravessar a semana.

### 24/10/2026 (noite) — Contas de revisão da Apple: persistência sem seed semanal, compra Sandbox preservada, `check-store` (LOCAL, sem commit)
- **Persistência:** `ReviewAccountsSchedulerService` (cron 4h BRT + 45 s após subir) chama `refreshReviewContent`: se a semana virou e a conta de revisão não tem programa na semana corrente, reconstrói SÓ o conteúdo (nunca senha, assinatura, provedor, override). Marca `review_demo_kind` na entrevista identifica as contas. O seed deixou de reverter acesso: só define assinatura ao criar, se a conta foi excluída (recriada com o mesmo id) ou com `--reset-access`. Compra Sandbox legítima fica; a B volta a expirada sozinha quando o Sandbox expira (reconciliação, sem override).
- **RevenueCat (FATO, API real com a chave pública do app):** offering atual `default` → package `$rc_monthly` → produto `panzeri_run_mensal` (= `IOS_STORE_PRODUCT_ID`). Entitlement NÃO é lido por app nem servidor (acesso vem das assinaturas vivas do cliente). Servidor não filtra Sandbox. Não verificado (sem acesso aos painéis, login Apple): bundle id nos 3 lugares, webhook Sandbox+Production, Paid Apps Agreement, produto aprovado/vinculado.
- **`node dist/app-review/cli.js check-store`:** só lê; diz presença (sem valores) de `REVENUECAT_SECRET_API_KEY`, `REVENUECAT_WEBHOOK_SECRET`, `APPLE_IAP_*`, utilidade da `.p8` e se o RevenueCat aceita a chave secreta.
- **Testes:** integração do seeder 5/5; `store-subscription-reconcile.spec.ts` 32/32; `app-boot.int` OK (módulo novo); tsc e eslint limpos. Checklist VALIDADO/PENDENTE/BLOQUEADO e procedimento de teste em aparelho em `RUNBOOKS/2026-10-24-CONTAS-REVISAO-APPLE.md` §7–10. Nada de iOS foi validado (só web/banco local).

### 24/10/2026 — Ciclo menstrual sumiu de novo: dados reais + defeito da 1ª correção (LOCAL, sem commit)
- **Dados reais (consulta de Elton em produção):** 12 alunas com `sex='prefiro_nao_informar'` (9 delas atualizadas em 23–24/10), 26 vazias; 30 "Feminino" intactas. Passo 1: 11 com placeholder + 4 vazias tinham respondido Feminino/Masculino na entrevista. Passo 2 (UPDATE 15) rodado por Elton em transação em 24/10; `updatedAt` NÃO prova quando o sexo mudou (qualquer update da linha o altera). Por que 9 em dois dias: DESCONHECIDO (Jú e Lucelane dizem não ter mexido; só o "Salvar" do Perfil/Conta grava sexo).
- **Defeito encontrado na 1ª correção (meu):** `UpdateProfileDto.sex` só aceitava minúsculas; o app passou a enviar "Feminino" ⇒ `PUT /me/anamnese` e `/me/profile` dariam 400 para toda aluna com sexo preenchido (Conta já estava assim desde 04/10). Corrigido: DTO aceita as formas canônicas, `normalizeSex`/`resolveSexToSave` no servidor (placeholder nunca sobrescreve), `isFemaleSex` tolerante no menu. Teste `test/sex-preservation.spec.ts` agora valida o DTO de verdade (9). Lição: teste de contrato com o validador real, não regex no código.
- **PENDENTE:** commit/push/deploy (API + PWA); reconferir contagem de placeholder após alguns dias.

### 24/10/2026 — Painel admin não compilava (`next build`): 2 avisos de lint do Observatório tratados como erro (CORRIGIDO, LOCAL, sem commit)
- **Causa:** em `apps/admin/app/observatory.tsx`, import `Legend` e helper `painCell` (e o componente `Cell`, que só ele usava) sem uso ⇒ `@typescript-eslint/no-unused-vars` derrubava o `next build` (o `atualizar painel` do Elton falhou; o mesmo build roda no deploy do painel). Eu havia validado só `tsc` + preview em `next dev`, que não roda o lint do build — passei a rodar `next build` ao tocar o admin.
- **Verificado:** `tsc`, `eslint app` e `next build` do admin passam.

### 25/10/2026 — Observatório: tela sempre visível com dados sintéticos (LOCAL, sem commit)
- **Decisão do Elton:** "tem que aparecer tudo" — a chave `OBSERVATORY_ENABLED` deixou de ser necessária. `ObservatoryService.status()` agora é sempre `enabled: true`; só `OBSERVATORY_REAL_DATA=true` troca sintético por dado real (continua travado até a base legal/termos). Continua só administrador, com a faixa "Dados sintéticos". Teste do spec atualizado (36 passam); tsc/eslint limpos.

### 25/10/2026 — Prompt do agente de prescrição: diretriz desenvolvimentista do Elton (LOCAL, sem commit; efeito na IA NÃO verificado)
- **O que entrou:** `panzeri-developmental-directive.ts` (novo) inserido em `buildSystemPromptStable` logo depois de `PANZERI_METHODOLOGY_KNOWLEDGE` (só prompt semanal; o de força isolada não decide corrida). Norte geral: desenvolver volume, longão e intensidades; 10% não é limite absoluto; faixas de longão por objetivo/perfil (5/10/21/42 km); dor leve ocasional não interrompe; sono/oscilação isolada não reduz; contexto dinâmico; decisão PROGREDIR/CONSOLIDAR/RECALCULAR/RECUPERAR/REORGANIZAR registrada em `rationale` (campo interno; `notes` segue só objetivo da sessão). Diretriz individual do treinador continua soberana.
- **Conflito resolvido (único):** régua de dor da metodologia (ficou subordinada à seção 5). Tudo mais permanece (80/20, fases da prova, longão ondulado, consolidar degrau, idade/saúde, recorde quente/frio, primeira semana, 8:30/km).
- **Verificado:** `tsc`, `eslint`, teste de contrato do prompt (4) e `prescription-agent-athlete-state-integration` (18) passam. **NÃO verificado:** comportamento real da IA (nenhuma geração foi rodada); revisão independente (exigida para prescrição) pendente. Efeito esperado: semanas mais progressivas — acompanhar as primeiras gerações após o deploy.

### 26/10/2026 — Separação DEFINITIVA entre entrevista e rotina (LOCAL, sem commit/push/deploy/migration em produção)
- **Decisão (Elton):** entrevista e rotina são processos independentes — formulário, API e persistência próprios. A entrevista nunca cria, restaura ou altera `WeeklyAvailability`. Fluxo: perguntas rápidas → pagamento → entrevista → cadastro da rotina → primeira prescrição. Diagnóstico de origem: Astra (`auditoria-rotina-2026-10-26/`), confirmado no código.
- **Servidor:** comando único `RoutineService` (`apps/api/src/me/routine.service.ts`): substituição integral da semana (7 dias) ou alteração parcial de dias, em transação serializada por aluno (trava de aviso do Postgres), com revisão esperada (409 em escrita obsoleta), histórico antes/depois (`WeeklyRoutineChange`, só agenda) e efeitos secundários (aviso Telegram, relato, primeira geração) DEPOIS do commit — falha ali nunca vira erro de gravação. Validação única (`routine.rules.ts`): minutos inteiros 1–720, modalidade `[a-z0-9_]`, dia com treino exige modalidade e tempo, modalidades legadas preservadas.
- **Estado da rotina** (`common/routine-state.ts`, migration aditiva `20261026120000_weekly_routine_state`): "cadastrada" = existe linha de estado OU linhas em `WeeklyAvailability` (legado, revisão 0, nada é alterado). Semana inteira de descanso é rotina VÁLIDA (pausa), nunca "sem cadastro". `GET /me/routine` e `routine{configured,revision,allRest}` em `/me` e no detalhe do aluno do painel.
- **Legado neutralizado:** `POST /me/onboarding/complete-routine` → 410; `PUT /me/onboarding/answer` recusa chaves de rotina (400); `POST /coach/students/:id/sync-availability` → 410; `syncAvailabilityFromInterview`/`completeRoutineFromInterview`/conversão entrevista→rotina removidos; `PUT /me/anamnese` ignora `availability`; `POST /training-plans/week` ignora a disponibilidade do corpo (sem override do cliente).
- **Prescrição:** primeira geração exige entrevista + rotina cadastrada COM dias + acesso; sem rotina ou em pausa a geração recusa (`routine_required`/`routine_all_rest`) — sem dias fixos de reserva; o programa só é publicado se a revisão da rotina não mudou durante a geração (`assertRoutineUnchanged`, mesma trava); freshness compara a REVISÃO usada (`inputSnapshot.routineRevision`), sem exceção para override; regenerar o CONTEÚDO de um dia que saiu da rotina é barrado (use "Refazer nova semana"), salvo diretriz ativa. Regra pré-existente mantida: sessões fora da rotina só passam com diretriz ativa.
- **App:** formulário ÚNICO `RoutineEditScreen` (primeiro cadastro e menu): lê a rotina da API, nenhum dia vem preenchido no 1º cadastro, envia a revisão, 409 recarrega a rotina atual sem sobrescrever, só confirma "salvo" quando o servidor confirma e a rotina gravada bate com a enviada; entrevista sem nenhuma pergunta de rotina; ao concluir a entrevista (ou ao abrir o app) sem rotina cadastrada → formulário da rotina; Perfil não tem mais segundo editor (atalho). Modalidade legada (ex.: bike) preservada em `extras`, nunca vira corrida. Painel: reparo pela entrevista removido; edição envia revisão e trata 409.
- **Testes:** integração com PostgreSQL real `routine-separation.int.spec.ts` (11, incluindo gravação concorrente real) — pegou um defeito real (`pg_advisory_xact_lock` devolve `void`; corrigido com cast). Verificado na TELA (app web + API real + banco de teste local): 1º cadastro grava 3 dias (revisão 1, histórico `student`), conflito simulado devolve a mensagem de 409 sem falso "salvo" e sem sobrescrever a alteração mais recente. Suítes antigas que simulavam o banco foram atualizadas (construtores por posição, assinatura de `generateWeek`, hashes congelados do prompt após a régua de dor da diretriz desenvolvimentista). **Falhas pré-existentes (idênticas sem estas mudanças):** `analytics-instrumentation`, `correction-pipeline-guards` (migration "mais recente"), `legal-content` (PolarConnect), integração `correction-medals`.
- **Riscos/limites:** aplicativos NATIVOS antigos (iOS build 13, Android) ainda usam o cadastro da rotina pela entrevista (`complete-routine`, agora 410): alunos NOVOS nesses builds não conseguem cadastrar a 1ª rotina até atualizar o app (PWA atualiza sozinho); quem já tem rotina continua editando (PUT sem revisão é aceito, sem proteção). Antes de publicar: migration em produção (aditiva, só cria 2 tabelas), deploy API + PWA + painel. Não verificado: iOS/Android nativos, geração real de programa com IA.
- **Revisão independente (26/10): APROVADO COM RESSALVAS — todas aplicadas:** primeira geração refaz 1x se a rotina mudar durante ela; `generationStarted` do servidor (app e Telegram só dizem "sendo preparado" quando é verdade); reavaliação recusa chaves de rotina; mesclagem de alunos preserva o histórico de ambos e a revisão nunca regride. Testes: integração de rotina 20/20, unitários afetados 54/54, tsc api+mobile verdes.
- **Compatibilidade com apps antigos (26/10, mesma data):** `complete-routine` e as respostas de rotina em `/me/onboarding/answer` voltaram a funcionar SÓ para o primeiro cadastro de quem ainda não tem rotina, via `RoutineService` (fonte `legacy_app`, trava + histórico + revisão). Rascunho da sessão com carimbo (validade 48h; sessão nova descarta respostas antigas; apagado após gravar); quem já tem rotina nunca é alterado; respostas históricas da entrevista nunca viram rotina. Desliga com `LEGACY_ROUTINE_COMPAT=off` (volta 400/410). Cobre também PWA com bundle antigo em cache. Teste: integração 17.

### 26/10/2026 — Totais realizados da semana: prescrição × extras × total (LOCAL, lotes 1–2; sem commit/push/migration/deploy)
- **Problema (Astra):** o relatório semanal só olhava as sessões prescritas; a corrida extra (só em `ActivityLog` ou materializada) sumia do volume total (36,6 km mostrados, 41,6 km reais).
- **Decisões de Elton:** fuso `America/Sao_Paulo` quando não há offset (sem alterar histórico); aviso de importação tardia fica para fase posterior; relatório mostra resumo por modalidade + corridas extras individuais; a IA recebe os três blocos e interpreta (sem fórmula de carga; no lote 3 o prompt deve dizer que cumprimento ≠ volume total e que extra é exposição adicional, não determina sozinha fadiga/recuperação/mudança de carga).
- **Lote 1:** `activity-execution/weekly-realized-totals.ts` (função pura). **Lote 2:** adaptador `weekly-realized-totals.loader.ts`; `indicators.totals` OPCIONAL no `WeeklyExecutionReport` (sem migration; `EXECUTION_ANALYSIS_VERSION` continua 1 — bloco tem versão própria); `sources` do relatório inclui as extras (exclusão de dados de provedor continua invalidando); texto ao aluno só muda em semanas COM extras; relatórios emitidos intactos; app só renderiza `lines: string[]` (formato igual).
- **Achados do lote 2:** (1) `corresponding` NÃO prova prescrição: o motor liga automaticamente (`automatic_single_candidate`) pela regra dia+modalidade, sem validar distância/tempo, e também liga atividade importada a um registro extra do aluno (`student_extra`) do mesmo dia — o módulo conta esse caso como extra, uma vez. Proveniência do vínculo (`automatic` × `student`/`coach`) agora aparece em `prescription.provenance`. (2) Duplicidade manual × importada: só ocorre quando NÃO há vínculo (ex.: extra manual criada depois do import, sem checagem em `createManualSession`); NENHUMA deduplicação por aproximação foi implementada — limitação documentada em teste; estratégia a aprovar. (3) **BLOQUEADOR DE PUBLICAÇÃO:** sem offset, o módulo novo usa São Paulo e a Evolução/`localCalendarDate` ainda usam UTC — divergência fixada em teste; alinhar no lote 4 antes de publicar.

### 26/10/2026 — Totais realizados: lote 3 (Analista + Prescritor) e revisão independente (LOCAL, sem commit/push/migration/deploy)
- **Decisões de Elton (lote 3):** duplicidade manual × importada = estratégia A+B (aluno confirma vínculo; suspeitos sinalizados, sem fusão automática; interface fica para etapa própria); fuso continua para o lote 4 e a divergência com a Evolução segue BLOQUEADORA de publicação; vínculo automático segue contando como cumprimento, com procedência `automatic`/`student`/`coach` preservada; a IA não toma vínculo automático como prova de intensidade/estrutura/objetivo.
- **Implementado:** `relatorioDeExecucaoDaSemanaAnterior.treinoRealizadoDaSemana` (visão de IA: prescrição × extras × total, com modalidade/distância/duração/FC/potência/elevação/cadência/calorias/esforço percebido por extra; sem ids, sem nome de provedor); Analista usa os mesmos totais (fatos `total_realizado_da_semana` e `origem_do_cumprimento`; achado `atividades_sem_prescricao` com extras que existem só em `ActivityLog`); `EXECUTION_REPORT_INSTRUCTION` ampliada (cumprimento ≠ volume total; extra = exposição adicional que não determina sozinha fadiga/recuperação/carga; vínculo automático ≠ prova). Visão de IA do adaptador: `aiActivityWhere` + `neutralizeSessionsForAi` (Strava e demais bloqueados somem; relatório completo do aluno e `sources` continuam completos para a exclusão de dados). `promptProviders` passou a registrar o egresso real.
- **Revisão independente (Gauntlet): REPROVADO na 1ª rodada** — BLOQUEANTE real: a extra "materializada" (`materializeExtraActivity`) NÃO cria `SessionExecutionLink`; o elo é `structure.activityLogId`. Resultado: 1 corrida virava 2 extras (também no relatório do lote 2). Meus testes semeavam um formato que a produção não gera. **Corrigido** (elo implícito no módulo e no adaptador, visão de IA descarta a sessão sintética cuja atividade está bloqueada) e testado com o formato real (`materializeExtraActivity` de verdade) + mutação confirmada. Também corrigidos: frase "Nao copie os numeros para o texto do aluno" restaurada no prompt; formatação de extras e `promptTotalsOf` com try/catch (nunca derrubam o relatório); provedor da sessão sintética declarado; "motor" removido dos comentários. **Aprendizado sistêmico:** teste de integração deve usar o gerador REAL do dado (serviço de produção), não reconstruir o formato à mão.
- **Decisão pendente do Elton (achado 4):** atividade ligada a sessão marcada "não feita" entra em `prescription.executedEvents`/`executedRunKm` mas não em `performedSessions` ("0 cumpridas, 12 km executados nas prescritas"). Evento físico existiu e conta no total; falta decidir se vai para extras ou fica fora do km executado nas prescritas. Achado 5 (corresponding sem sessão carregada vira prescrição) é decisão consciente e está documentado.

### 26/10/2026 — Totais realizados: lote 4 (fuso unificado) + achado 4 investigado (LOCAL, sem commit/push/migration/deploy)
- **Segunda revisão independente do lote 3: APROVADO COM RESSALVAS** (defeito bloqueante resolvido no caminho real). Corrigidos: o Analista agora recebe os indicadores da VISÃO DE IA (`aiIndicators`; antes recebia os completos, com km/adesão de provedor bloqueado — falha exposta pelo próprio lote 3); visão de IA descarta sessão sintética sem elo comprovável (falha fechado); procedência da classificação sem sessão na seleção ganhou balde próprio; texto duplicado de extras removido.
- **Lote 4 — regra única de dia local** em `common/local-date.ts`: offset do aparelho preservado (inclusive 0); sem offset = America/Sao_Paulo (nunca UTC), via `formatToParts`. Consumidores apontados para ela: vínculo/materialização (`localCalendarDate`, `startOfLocalDay`), Evolução (`localIsoDate`), totais/relatório semanal, calendário, carga de treino, tênis, texto de correção, contagem do check-in e fallback do Analista (janela UTC com folga + dia local). Antes: UTC em vínculo/Evolução/calendário; SP em carga/tênis/totais. Nada gravado é reescrito.
- **Testes:** `local-date-unification.spec` (7 instantes × 7 offsets em todos os consumidores) e integração `local-date-consumers` (mesmos eventos físicos por semana em totais × Evolução × calendário; vínculos existentes intactos; offset 0 preservado; domingo/segunda; atravessa meia-noite).
- **Achado 4 (atividade ligada a sessão marcada "não feita") — origem investigada:** não há gancho que revogue o vínculo quando o aluno marca "não feito" depois (`workout-completions.service` só chama `reconcileEventsOfSession` em alguns caminhos). Vínculo humano (`student`/`coach`) nunca é revogado pela regra de reconciliação. Três consumidores decidem diferente: Evolução (`classifySession`: vínculo ativo vence → "feita"), relatório/`analyzeSession` (`missed` vence → "não feita", atividade ignorada) e `reconcileEvent` (revoga vínculo automático e a atividade vira `alternative`, ou seja, extra — o que Elton NÃO quer automático). Proposta de classificação explícita, não destrutiva, enviada ao Elton; nada implementado.
- **Decisão pendente (revisão do lote 4, ressalva real):** `reconcileEvent` recalcula o estado automático NÃO vinculado (`alternative`/`ambiguous`) a cada chamada; com a regra nova, atividade ANTIGA sem offset, em fronteira (dom 21h–24h SP) e sem vínculo pode passar a vincular a treino de domingo (teste `DECISAO PENDENTE` fixa isso). Vínculos ativos e decisões humanas continuam estáveis. Opções: (a) aceitar e documentar + rodar `reconcileUserHistory` em dryRun antes do deploy; (b) congelar a regra antiga (UTC) para eventos já classificados antes de uma data de corte. Também: medalhas reavaliadas por correção usam a série nova (só dentro do escopo da correção); rodar `reconcile-volume.cli.ts` em modo leitura antes do deploy.

### 26/10/2026 — Regra "não fiz" + atividade que chega depois (LOCAL, sem commit/push/migration/deploy)
- **Decisão de Elton (substitui a classificação "execução com registro contrário", descartada):** treino marcado "não fiz" + atividade compatível do mesmo dia → o sistema PERGUNTA ao aluno (candidato pendente). Sem resposta: nada muda e nenhum vínculo é presumido. **SIM:** vincula e a marcação passa de "não realizado" para "realizado". **NÃO:** o treino segue "não realizado" e a atividade vira extra. Nos dois casos conta uma vez no total.
- **Verificação do fluxo existente:** já havia pergunta ("Precisamos identificar esta atividade" / "Foi este") e confirmação, vínculo manual e desfazer. Faltavam 3 pontos: (1) `planClassification` excluía a sessão `missed` e mandava a atividade direto para extra, sem perguntar; (2) o SIM não atualizava a marcação; (3) não havia resposta NÃO para candidato pendente.
- **Mudança mínima:** (1) sessão `missed` compatível do dia vira candidato (`matchMethod: student_marked_not_done`); (2) `confirmCandidate` (origem aluno) e `linkActivityToSessionAsStudent` atualizam só o `status` do feedback para `done`, na MESMA transação do vínculo (atômico), e o segundo SIM para o mesmo treino é recusado; (3) `unlinkActivityAsStudent` com candidato pendente = NÃO (reaproveita `markExtra`) + botão "Nao, foi um treino extra" no cartão existente. A ordem inversa (vínculo automático primeiro, "não fiz" depois) também passa a perguntar em vez de virar extra sozinha. Teste antigo `explicit-not-done-physical-event.spec` atualizado (a semântica anterior foi revertida por decisão do dono).
- **Revisão independente: APROVADO COM RESSALVAS** (sem bloqueante). Tratadas: vínculo duplo (2 atividades / 1 treino) e atomicidade. Pendentes (decisão/implantação): app/PWA antigo não tem o botão NÃO → alunos com versão antiga ficariam sem como responder NÃO (publicar PWA/app novo antes da API, ou aceitar); o SIM deixa o feedback `done` híbrido (notas do "não fiz" e escalas vazias) — decidir se o aluno deve completar o feedback; atividade em OUTRO dia do mesmo treino ou força "fraca" ainda vira extra sem pergunta (aluno pode usar "Vincular a treino prescrito"); enquanto pendente a atividade fica fora dos totais.

### 26/10/2026 — Ajustes da regra "não fiz" (pendente conta no volume, feedback após SIM, compatibilidade com apps antigos) (LOCAL, sem commit/push/migration/deploy)
- **Pendente conta no volume:** atividade válida com classificação `ambiguous` (identidade física resolvida) entra UMA vez no total realizado, em bloco próprio `pendingConfirmation` (nem cumprimento, nem extra), no relatório ao aluno, no bloco `aguardandoConfirmacaoDoAluno` do Prescritor, no fato do Analista, na Evolução (km total, nunca extra/cumprimento) e nas medidas objetivas da Training Intelligence. Identidade ambígua (possível duplicata) segue fora. Medalhas continuam travadas na semana incerta (`getRunMedalUncertainty` intacto). Texto neutro ("ainda sem classificação definitiva"), porque a pendência também existe sem cartão (ex.: vínculo revogado).
- **Feedback após o SIM:** nada novo — o SIM só muda o `status`; a sessão passa a entrar nos "feedbacks pendentes" do check-in e o aluno completa pelo formulário existente (observações anteriores preservadas, nada subjetivo preenchido). Teste com o `upsert` real.
- **Compatibilidade com apps antigos (build 13 e anteriores):** a resposta NÃO viaja como última opção do MESMO cartão (`linkId: "extra:<atividade>"`, título "nenhum destes — foi um treino extra") e o MESMO endpoint de confirmação a entende (`answerPendingActivityAsStudent`; posse validada, idempotente, nunca desfaz vínculo ativo). O app antigo mostra "Foi este: nenhum destes — foi um treino extra". PWA/app novo mostra "Nao, foi um treino extra". Sem endpoint nem tela nova.
- **Revisão independente: APROVADO COM RESSALVAS** (sem bloqueante). Corrigido depois dela e coberto por teste (não re-revisado): texto neutro, idempotência e recusa de `extra:` com vínculo ativo. Decisão pendente: transição do fuso (proposta enviada ao Elton; nada implementado).

### 26/10/2026 — Corte do fuso (atividades sem offset)
`common/local-date.ts`: variavel `LOCAL_DATE_CUTOVER_AT` (ISO, definida no deploy). Sem offset: antes do corte = dia UTC antigo (historico, vinculos e medalhas estaveis); a partir do corte = America/Sao_Paulo. Sem variavel ou invalida = regra antiga para tudo. Offset informado (inclusive 0) sempre prevalece. Nada gravado nem reclassificado. Painel de carga e feedback inalterados. Unitarios 2882 (so as 3 suites de base falham); integracao 153 (so correction-medals de base).

### 27/10/2026 — Recuperação de intervalado e relógios (prompt da IA)
A pedido do Elton: removida do prompt a recomendação de evitar pace mais lento que 8:30/km (semana e corrida por sessão; o trecho do 8:30/km também saiu do texto de metodologia `panzeri-methodology-knowledge.ts`, com a ordem do Elton). Nova instrução `WATCH_RECOVERY_INSTRUCTION`: recuperação sempre ativa e por distância; pausa passiva vira caminhada bem lenta (ex.: 15:00–20:00/km, valor a critério da IA) e a IA diz no campo notes, com uma frase, que fez isso para o relógio aceitar o envio. Hashes congelados atualizados. PENDENTE: teste real no Amazfit (Zepp aceita pace tão lento?) antes de confiar; Apple Watch não envia pace.

### 28/10/2026 — Nova Evolução do aluno no painel administrativo (local, sem commit)
Só painel admin + leitura na API; nenhuma mudança no aplicativo do aluno, no Atlas ou na prescrição. A aba Evolução virou uma central (`apps/admin/app/evolution-hub.tsx`) com período único e abas: Visão geral, Explorar, Comparar, Treinos e carga, Saúde, Linha do tempo, Registros.
- **Explorar** (`ti/explorer.tsx`, `ti/explorer-chart.tsx`): categorias Treinos/Sono/Recuperação/Bem-estar/Saúde/Contexto, busca permanente, lista lateral, um indicador por vez, colunas por observação (duas sessões no mesmo dia ficam lado a lado e clicáveis), clique abre o registro original, botão ⓘ com definição/unidade/origem/periodicidade/comparabilidade, seletor de modalidade (Agregada/Corrida/Força/Outras aeróbicas/Esportes) e de fonte.
- **Referências no backend** (`training-intelligence/reference-series.ts`, campo `reference` do snapshot, só com `?reference=1`): média histórica, MM7/21/60/200 e faixa habitual (P10–P90) calculadas só com observações ANTERIORES a cada ponto (a própria observação nunca entra; empates compartilham a referência). Unidade da janela por periodicidade (dias/noites; registros/semanas/ciclos). Faixa: <4 registros sem faixa, 4–11 limitada, ≥12 individual. Sinal fora da faixa é neutro (não é bom nem ruim).
- Novos endpoints/params (aditivos): `GET /coach/students/:id/observations-availability?variables=`, `observations/:id?source=&reference=1`, legenda com `info` (categoria e ficha).
- **Comparar** = Studio existente em modo `compareOnly` com período controlado. Trajetória de FitnessTest e trajetória INITIAL→R1→R2 saíram da Evolução e foram para Avaliação; Provas alvo duplicadas e Exploração Longitudinal por pastas saíram da tela (o componente LongitudinalExplorer e seus blocos exclusivos foram removidos do código; o build do painel falhava por código sem uso). Dados intactos.
- NÃO feito de propósito: desacoplamento aeróbio (sem cálculo improvisado); banda média ± 2 DP não foi preservada; síntese "quantos indicadores fora do padrão por sessão" e episódios/relações temporais ficam para etapa futura; catálogo ainda sem carga sRPE, sessões perdidas e distância/duração por treino como indicadores selecionáveis.
- Deploy: API primeiro (endpoints novos), depois o painel. Sem a API nova o painel degrada (sem referências), não quebra.

### 28/10/2026 — Nova ordem das abas do aluno no painel (DECIDIDO, NÃO IMPLEMENTADO)
Pedido do Elton: só registrar; ele trará outras mudanças para analisar antes de qualquer implementação.
Ordem desejada das abas do "Aluno selecionado": Cadastro | Avaliação | Rotina | Diretrizes | Semanas anteriores | Treino da semana (hoje "Treinos") | Integrações | Calendário | Evolução | Saúde e recuperação | Carga (própria).
- **Calendário** vira aba própria: trazer o calendário que o Elton gosta (hoje está dentro de Evolução e de "Treinos e carga"), incluindo o detalhamento por sessão.
- **Saúde e recuperação** e **Carga (própria)** ficam como abas por enquanto; a intenção é movê-las para dentro de Evolução depois (lugar ainda a pensar; Carga própria segue "em avaliação").
- Dúvidas a confirmar antes de implementar: "Integrações" apareceu duas vezes na lista (considerado uma só, depois de Treino da semana); "Provas e objetivos" e "Atividades externas" existem hoje e não constam na nova lista (destino a definir).

**Atualização (28/10/2026, ordem FINAL das abas, substitui a lista acima; ainda NÃO implementado):**
Cadastro | Avaliação | Rotina | Diretrizes | Provas e objetivos | Semanas anteriores | Treino da semana | Calendário | Evolução | Saúde e recuperação | Carga (própria) | Integrações | Atividades externas.
Dúvidas anteriores resolvidas: Integrações é uma só (penúltima); Provas e objetivos e Atividades externas ficam como abas. Calendário, Saúde e recuperação e Carga (própria) seguem como descrito acima.

### 28/10/2026 — Saúde e Recuperação integrada à Evolução (local, sem commit)
Decisão do Elton: não manter dois lugares para os mesmos indicadores. Substitui a anotação anterior que mantinha a aba Saúde e recuperação por enquanto.
- Aba "Saude e Recuperacao" REMOVIDA do menu do aluno (`page.tsx`); `student-health-recovery.tsx` apagado. Endpoint `GET /coach/students/:id/health-recovery` e dados históricos intactos (agora consumido pelo gráfico de sono). Integrações continua no menu.
- Explorar ganhou a categoria **Atividade diária** (`wearable.dailySteps`, `wearable.dailyActiveKcal`, antes em Recuperação; `explorer-catalog.ts`). HRV e FC de repouso seguem em Recuperação; sono (duração, etapas, pontuação, cochilo) em Sono. Todos têm o gráfico de colunas com média histórica, MM7/21/60/200 e faixa habitual.
- **Composição do sono por noite** (`ti/sleep-composition.tsx`): o gráfico especializado da antiga aba, preservado, é a visão de entrada da categoria Sono (coluna empilhada profundo/leve/REM/acordada, pontuação em linha, total da noite sem sobreposição, sessões por noite, resumo n/média/mín-máx/primeira-última/tendência, fonte e sincronização). Referências por cima: seletor "Referências de" (duração, profundo, leve, REM, acordada, pontuação), cada uma com a própria média histórica, MM e faixa, ligáveis separadamente; alinhadas à noite pela `calendarDate` da observação. Grandezas nunca se misturam (pontuação usa o eixo direito 0–100).
- Removido de propósito: tabela "Comparação entre períodos" do sono (a aba Comparar já cobre) e o seletor próprio de datas (usa o período único da Evolução).
- Teste do catálogo atualizado (`training-intelligence-reference-series.spec.ts`). NÃO verificado visualmente com dado real (Area de faixa no recharts 3); conferir em aluna com Polar/Zepp antes de publicar.

### 28/10/2026 — Paleta única de modalidades nos gráficos de treino (local, sem commit)
A pedido do Elton: `apps/admin/app/ti/modality-colors.ts` é a fonte única (Agregada #8B5CF6, Corrida #16A34A, Força #2563EB, Esportes #F59E0B, Outras aeróbicas #06B6D4, Não identificada #94A3B8). No Explorar (categoria Treinos) cada coluna usa a cor da modalidade da própria sessão; roxo só para indicadores sem modalidade/`global` (totais agregados). Modalidade em texto: tooltip, rótulo de acessibilidade e chave "Modalidade" sob o gráfico. Médias móveis, faixa e marcadores de desvio não mudaram de cor. Tema escuro: filtro duplo devolve a cor exata. NÃO coberto: Comparar/Studio (cor por série, outra lógica) e gráficos antigos de "Treinos e carga". Pedido também citava zoom e destaque da última observação: esses trechos não chegaram na mensagem, nada feito. Não verificado visualmente com dados reais.
- Correção (28/10, mesma rodada): a cor por modalidade valia só na categoria Treinos; agora vale em qualquer indicador cujas observações tenham modalidade (ex.: Qualidade do sono relatada no treino). Indicadores de relógio (sem modalidade) mantêm a cor padrão.
- Aderência aos treinos (gráfico) movida de 'Treinos e carga' para a Visão geral da Evolução (28/10, pedido do Elton).
- Volume semanal e Carga semanal/ACWR (28/10): agora são os 2 primeiros itens de Evolução > Explorar > Treinos (abrem por padrão ao entrar em Treinos), saindo de 'Treinos e carga'. Gráfico 'Esforço percebido (RPE)' antigo EXCLUÍDO a pedido (existe no Explorar) junto com o código que só ele usava (EffortSection, EffortLegend, AggToggle, contador feedbackSessions).

### 28/10/2026 — Menu final do aluno, aba Calendário e bug do treino extra do Polar (local, sem commit)
- Menu (ordem do Elton, substitui as anotações anteriores): Cadastro | Avaliação | Rotina | Diretrizes | Provas e objetivos | Semanas anteriores | Treino da semana | Calendário | Evolução | Integrações | Carga (própria) | Atividades externas (+ Ciclo só para alunas). Saúde e recuperação já tinha ido para a Evolução.
- Nova aba **Calendário**: calendário de treinos (8 semanas) + detalhamento por sessão (todo o histórico, sem recorte de período). A sub-aba "Treinos e carga" da Evolução foi removida (hub: Visão geral, Explorar, Comparar, Saúde, Linha do tempo, Registros).
- **Bug**: `isExtraSession` (page.tsx) só reconhecia extra do próprio aluno (`source==='student'`). Extra detectado pelo relógio (`structure {type:'extra', source:'device'}`, origin `device_extra`, ex.: corrida Polar de 5 km em 23/10) aparecia como "feito" no calendário e Extras=0 nos gráficos semanais. Agora conta os dois. O backend (`evolution-metric.service.ts`) trata `device_extra` à parte (via ActivityLog) e não foi alterado. Não verificado se `completedKm` semanal já inclui esse km (possível diferença entre Realizado e Extras).
- Gráficos semanais (28/10, pedido do Elton): Extras agora ficam EMPILHADOS (ciano) sobre a coluna verde do realizado/feitos, em vez de uma terceira coluna, no Volume semanal e na Aderência; prescrito continua em coluna própria; os botões da legenda já permitem ligar/desligar cada série. Aderência: extra aparece também com filtro de modalidade (ex.: Corrida) e deixou de ser contado como prescrito/feito (antes sessões extra entravam em Prescritos e Feitos; o backend já as exclui da aderência).

- Ritmo sempre em min/km (28/10): indicadores em s/km (ex.: pace médio) agora aparecem como m:ss min/km em valores, faixa, médias móveis, eixo (marcas de 5/10/15/30 s) e fichas, no Explorar e no Comparar (helpers paceText/fmtFor/unitLabel em ti/data.ts). Exportação anônima (CSV) segue em segundos de propósito, dado bruto.

### 28/10/2026 — Investigação Apple Health / Apple Watch (Lorena) — SEM alteração de código
- **A "tela técnica" é o `AppleHealthProofCard`** (Prova Apple Watch, Bloco 1, `apps/mobile/src/appleHealthProof/`), ligada por `extra.appleHealthProof: true` no `app.json` (flag lida do manifesto EMBUTIDO no binário). Aparece em 2 lugares do app iOS nativo: (1) Dispositivos e integrações > Apple Watch (catálogo do servidor diz `preparing`, "Ainda não está disponível para os alunos", mas o hub renderiza o card mesmo assim) e (2) Privacidade e dados > Dispositivos e integrações (sempre, sem consultar o servidor). É o ÚNICO cliente de Apple Saúde do app: não existe fluxo amigável nem sincronização automática/em segundo plano.
- Fluxo que funciona hoje, sem build: "1. Continuar" (folha do iOS, leitura de treinos) -> "7. Importar últimas corridas" -> `POST /apple-health/workouts`. Só lê corridas (`HKQuery.predicateForWorkouts(.running)`), no máx. 20, manual. iOS não informa se a leitura foi negada: negar = "nenhuma corrida".
- **OTA impossível**: `expo-updates` não está no `package.json` nem há `runtimeVersion`/`updates` no `app.json`; qualquer mudança de tela do app iOS exige novo build + revisão da Apple. PWA não tem o módulo nativo (`isAppleHealthSupported=false`), então não mostra o card nem o botão.
- Backend verificado: controller/ingestão/normalizador coerentes, 52 testes de ingestão e entrega verdes. Causa da falha da Lorena NÃO comprovada (sem acesso a logs/produção): hipóteses = não tocou "7", negou a leitura no Saúde, treinos sem tipo "corrida" ou fora das 20 mais recentes, ou erro HTTP no passo 7 (a tela mostra "status N"). Verificação: aba Integrações do aluno no painel (linha "Apple Saúde": última recepção / "Sem dados recebidos") e Atividades externas (provider Apple Health).
- Próximo build (decisão do Elton): trocar o card técnico por cartão simples (Autorizar -> Sincronizar -> confirmação), com consentimento próprio como Polar/Zepp/Health Connect, e desligar `appleHealthProof`.

### 28/10/2026 — Apple Saúde: app passa a pedir e ler TUDO que o HealthKit entrega por treino (código pronto, SEM build, SEM commit)
Ordem do Elton (repetida várias vezes): todo app de integração deve tentar pegar tudo o que puder. O Apple estava só com treinos + distância (prova técnica).
- **Swift** (`panzeri-apple-health`): pede leitura de treinos, rota, distância, FC, energia ativa, passos, potência, velocidade, passada, contato com o solo, oscilação vertical; por treino devolve FC média/máx, energia, passos, potência, velocidade, passada, contato, oscilação, ganho de elevação (metadata) e `readWorkoutRoute` (pontos compactos). Limite de leitura 20→200. NÃO compilado aqui: só o build EAS confirma.
- **App**: novo `AppleHealthSyncCard` (botão único "Continuar e sincronizar", lotes de 50, rotas de 5 em 5, mensagem de resultado) substitui o card técnico; `appleHealthProof` = false; texto de permissão atualizado no plugin.
- **API (já compatível com o app atual)**: normalizador aceita as medidas novas (faixas plausíveis; cadência = passos ÷ minutos, base em `providerMetrics.cadenceBasis`); distância 0 m vira ausente (valor original no raw); reenvio COMPLETA campos ausentes e corrige o zero antigo (nunca sobrescreve valor existente; reavalia identidade física); novo `POST /apple-health/routes`. 18 testes verdes.
- **Pendente (próxima fase, exige desenho de consentimento)**: dados diários (sono, HRV, FC de repouso, passos/calorias do dia, VO2, composição corporal) — pedir a autorização sem ler/enviar arriscaria a Apple (5.1.1) e exige consentimento por categoria como no Health Connect.

### 28/10/2026 — Correções da auditoria do Astra na integração Apple Saúde (sem commit novo; sem build/push/deploy)
**Estado real do Git (conferido)**: as alterações de "Apple Saúde: lê todas as medidas…" JÁ estão no commit local `82d450e` (o texto da entrada anterior, "SEM commit", ficou desatualizado; o commit tem o título com a letra "A" cortada). Nada foi reescrito; esta rodada está só na árvore de trabalho.
- **Enriquecimento** (`apple-health-ingestion.service.ts`): reimportação agora preenche distância `null` → valor válido (>0) e chaves de `providerMetrics` presentes com `null`; nunca sobrescreve valor válido; um 0 já gravado NÃO é trocado nem apagado. Identidade física só é reavaliada quando a DISTÂNCIA foi completada (completar FC/calorias não toca identidade nem classificação; os 2 ambíguos de 08/10 da Lorena não são tocados).
- **Distância zero** (`apple-health-normalizer.ts`): revertida a regra geral 0→null. Situações distintas em `providerMetrics.distanceStatus`: `measured`, `zero_reported` (0 mantido + `distanceLimitation`), `absent`, `unavailable_at_source` (app novo declara `distanceStatus:'unavailable'` quando o HealthKit não tem estatística); valor ilegível/negativo é rejeitado com motivo. Valor original sempre no raw. Sem correção retroativa. Painel mostra a limitação e "Rota: não recebida".
- **Rotas GPS**: limites explícitos (`APPLE_ROUTE_LIMITS`: 3 rotas/requisição, 1200 pontos/rota, orçamento de 60 KB por requisição, 200 ids por consulta); o limite de corpo da API NÃO foi aumentado. App compacta (5 casas), reduz pontos por rota até caber e monta lotes por bytes (`appleHealthSyncLogic.ts`). Novo `POST /apple-health/routes/pending` devolve só os treinos importados SEM percurso + limites: o envio de rotas é independente de o treino ter sido criado/enriquecido; esteira não é consultada; rota completa não é reenviada. Falha de lote não perde o resto: o que falhou segue pendente.
- **Erros no app**: resultados distintos (concluída / parcial / falha de comunicação / falha do servidor / falha de leitura nativa / sem treinos / sem autorização); "sem treinos" não afirma que a permissão foi negada (o HealthKit não distingue).
- **Consentimento por categoria no servidor** (`apple-health-consent.ts/.service.ts`, mesmo modelo do Health Connect; v1.0): grupos Treinos (activity), Medidas de sensor (activity_sensors), Percurso GPS (activity_route); endpoints `GET consent|permissions`, `POST consent/groups|reconfirm`, `DELETE consent|data` em `/apple-health`. Compatibilidade com o app publicado: SEM registro vale o modo `legacy` (importação básica como antes); com registro vale só o autorizado; retirada/texto desatualizado bloqueia. Medidas de sensor e percurso só com o grupo autorizado (checado dentro da transação, com lock); retirar apaga percurso/medidas já guardados; não confunde a folha do iOS com o consentimento do servidor. SEM dados diários (sono/HRV/etc.). Decisão a rever: os dados do Apple seguem como provedor legado na governança de IA (sem finalidade própria de IA), então as medidas autorizadas (ex.: FC média) podem compor o contexto da IA como as demais atividades; o texto diz isso e que o percurso GPS não vai à IA.
- **Texto legal**: Política seção 3 reescrita (200 treinos, medidas, percurso, finalidades, armazenamento, revogação, limitações, versões anteriores); `LEGAL_VERSION` 2026-10-28. Continua pendente a revisão por advogado. Catálogo `apple_watch` corrigido (importa corridas; não dizia mais "indisponível").
- **Testes**: 78 verdes (apple-health-ingestion 29, apple-health-consent 6, apple-health-sync-logic 6 + os já existentes). Falha preexistente (também no HEAD sem estas mudanças): `legal-content.spec.ts › tela Privacidade e dados` espera `<PolarConnect … variant="status" />` no App.tsx.
- **Não validado**: Swift não compilado (sem ambiente); UI do cartão e o fluxo no iPhone real; DI do módulo Nest em execução (só typecheck).

### 28/10/2026 — Apple Saúde: 4 defeitos finais da revisão do Astra (árvore de trabalho sobre o commit publicado `5c4b392`; sem commit/push/deploy/build)
**Estado conferido antes**: HEAD = `origin/main` = `5c4b392` ("gg", contém toda a rodada anterior); árvore limpa no início. Não há como comparar com a produção real daqui (sem acesso); assumido que o deploy do Elton é o `5c4b392`. Nada publicado foi revertido.
1. **Revogação × gravação concorrentes** (`apple-health-consent.service.ts`, `apple-health-ingestion.service.ts`): toda gravação de treino/sensor/rota roda em `writeWhileAuthorized` (transação com `FOR SHARE` na linha de autorização, categorias RELIDAS lá dentro; o treino é normalizado COM o acesso lido sob a trava, não o do início do lote). Toda alteração/retirada roda em UMA transação com `FOR UPDATE` na mesma linha: espera gravações em andamento, apaga os dados das categorias retiradas e grava a nova autorização antes de confirmar; gravações que chegam durante a revogação esperam e já veem a retirada (treinos seguintes do lote voltam `autorizacao_retirada`). Auditoria e invalidação de IA depois do commit. A limpeza só toca `apple_health` da própria aluna.
2. **IA** (`ai-data-eligibility.service.ts`): Apple Health deixou de ser "legado sempre elegível": sem registro = como antes (app antigo); registro ativo + texto vigente = vale por categoria (`activity`, `activity_sensors`, `activity_route`) para IA interna e externa, SEM finalidade ou trava de ambiente de IA; retirado/desatualizado = bloqueado (provedor entra em `blocked` e sai do filtro de atividades); registro perdido com última decisão auditada "disconnected" continua bloqueado.
3. **60 KB no servidor** (`apple-health-ingestion.service.ts`): `appleRoutesBodyBytes` mede `JSON.stringify({routes})` em bytes UTF‑8 (a mesma medida do app, `bodySize`); acima de 60.000 → 413 `PayloadTooLargeException` com mensagem clara, antes de consentimento/validação. Limite global de corpo da API não alterado.
4. **Swift** (`PanzeriAppleHealthModule.swift`): `sampleIndices` uniforme que sempre inclui primeiro e último, estritamente crescente e ≤ maxPoints; candidatos cronológicos com deslocamento crescente, e o último ponto válido prevalece sobre um do mesmo segundo; rotas curtas não perdem nada. O JS (`thin`) já preservava extremos.
- **Testes**: 168 verdes nas suítes pertinentes (apple-health ×5 arquivos, ai-governance, legacy-consent, health-connect-consent, polar-health); os 4 de concorrência FALHAM no código anterior e passam agora. Swift NÃO compilado/executado (a réplica em TS do algoritmo é teste do algoritmo, não do Swift). tsc API e mobile limpos.
- **Próximo**: compilar o módulo em macOS (`npx expo prebuild --platform ios` + `xcodebuild` para simulador, sem distribuição) e testar no iPhone.

### 29/10/2026 — Apple Saúde: coletar TUDO que o HealthKit entrega (consentimento v2.0) — sem commit, sem build
- **Ordem do Elton**: o app deve coletar todos os dados disponíveis e autorizados no Apple Saúde (não só os ligados a treino), com histórico, sincronização incremental, origem/unidade/timestamp preservados, ausência ≠ zero, sem autorização nova de IA, e inventário antes do build. Isto SUPERA a restrição de 28/10 ("não implementar dados diários").
- **Servidor**: `apple-health-consent.ts` v2.0 (15 grupos: treinos, sensores, percurso + atividade do dia, sono, frequência cardíaca, HRV, VO₂ máx, peso/composição, oxigenação/temperatura/respiração, mobilidade, hábitos, nutrição, pressão/glicemia, ciclo menstrual; nada marcado). Novo `POST /apple-health/health-records` (`AppleHealthRecordsService`): só com consentimento REGISTRADO e vigente da categoria, relido dentro da transação (`writeWhileAuthorized`, mesma coordenação com a revogação); app antigo (sem registro) continua só nos treinos básicos. Reaproveita o normalizador do Health Connect (`normalizeHealthRecord(input, categorias)`; HRV aceita `hrvMetric: 'sdnn_ms'`; etapa de sono preserva `sourceStage`) e a gravação nas tabelas `Wearable*` (extraída para `health-connect/health-record-persist.ts`, usada pelos dois provedores). Novas categorias no vocabulário: `heart_rate`, `mobility`, `menstrual_cycle`, `clinical_vitals`. **Sem migration** (tabelas Wearable* já existiam).
- **Revogação**: retirar um grupo apaga o que ele guardou (`scrubHealthData`: sono/HRV/diário por coluna/indicadores por tipo), na mesma transação travada; retirada total apaga tudo de `apple_health` nas 4 tabelas; só toca `apple_health` da própria aluna.
- **IA**: sem finalidade nova. `scopeFor` passa a bloquear por categoria (`apple_health:<categoria>`) as categorias de saúde não autorizadas/retiradas/desatualizadas. Percurso GPS, pressão arterial, glicemia e ciclo menstrual NÃO estão em `HEALTH_AI_CATEGORIES` (nunca vão à IA — texto do consentimento diz isso). Hoje a IA só consome 5 variáveis de saúde (sono, HRV, FC de repouso, passos, kcal ativa); os demais tipos ficam armazenados e protegidos, mas ainda sem variável de IA/tela (passo futuro, sujeito ao Princípio da Prescrição).
- **App**: Swift só LÊ (`readDailyStatistics` por dia com `HKStatisticsCollectionQuery` — soma já desduplicada pelo HealthKit —, `readCategorySamples`, `readWorkoutsInRange` com TODOS os tipos de treino, `requestHealthAuthorizationFor` pedindo ao iOS só o que o consentimento cobre; identificadores por texto + `is(compatibleWith:)` para nunca quebrar em iOS mais antigo). Toda a modelagem está em TypeScript testável: `appleHealthRecords.ts` (catálogo ~55 tipos quantitativos + 10 de categoria, sono por sessões/fonte única/etapas, ciclo, eventos cardíacos, atenção plena) e `appleHealthSyncLogic.ts` (janelas: recente 14 dias ou desde 2 dias antes da última sync; histórico em janelas de 60 dias até 3 anos, cobertura por grupo guardada no aparelho, só avança após envio completo; lotes ≤100 registros/80 KB). Percursos: no máx. 150 por sincronização (o resto fica pendente e é dito na mensagem).
- **Decisões/limites registrados**: HRV do Apple é SDNN (não RMSSD) — rótulo `sdnn_ms`, média do dia; somas do dia têm origem agregada `com.apple.health` (o HealthKit mescla fontes; origem real só em sono/amostras de categoria); sono: uma fonte por noite (a com etapas), "na cama" não é sono; anéis de atividade (metas), ECG completo, dados cadastrais (nascimento/sexo/sangue), registros clínicos (FHIR), medicamentos, receitas de óculos e atividade sexual NÃO são coletados (declarado no texto); sem envio em segundo plano (exigiria entitlement/observer nativo — futuro); texto jurídico continua pendente de advogado.
- **Testes**: `apple-health-records.spec.ts` (recebimento por categoria, idempotência, ausência≠zero, SDNN, limpeza por categoria), `apple-health-daily-sync.spec.ts` (catálogo, montagem, sono, ciclo, janelas/cobertura, contrato app→servidor com o normalizador real), suítes anteriores ajustadas. Swift NÃO compilado/executado (sem macOS).
- **Próximo**: build/compilação em macOS + teste no iPhone (permissão iOS com ~70 tipos, histórico de 3 anos em aparelho real, tempo da 1ª sincronização); revisão de advogado dos textos; resposta de revisão da Apple precisa justificar leitura ampla de HealthKit.

### 29/10/2026 — Decisões permanentes de produto (ordem de integrações completas) — registro; implementação em lotes
- **Estado verificado**: `main` = `origin/main` = `aa73180` (Apple Saúde v2.0 publicado pelo Elton), árvore limpa.
- **Diretriz permanente de integrações**: para TODAS as marcas e plataformas cadastradas, aproveitar o máximo de dados de treinamento, saúde, recuperação e comportamento que sejam legalmente acessíveis, tecnicamente disponibilizados pelas integrações oficiais e utilizáveis para as nossas finalidades, mediante as autorizações necessárias. Toda integração nova ou ampliação futura segue isto automaticamente, sem nova ordem por métrica.
- **Finalidade**: melhorar o acompanhamento individual, entender respostas ao treinamento, enriquecer análises longitudinais e ajudar a IA a elaborar prescrições e estratégias personalizadas para os próprios alunos. Sem indicador único de "prontidão/fadiga": preservar dados e permitir análises específicas e comparações longitudinais; sem causalidade automática sem evidência.
- **Privacidade**: não vender, comercializar nem divulgar dados individuais; só finalidades informadas e compatíveis; respeitar consentimento, revogação (dado revogado não entra em análise posterior), LGPD e políticas de cada provedor (se uma plataforma permite armazenar mas proíbe processamento externo/IA, respeitar a diferença); sem autorização de IA adicional quando a existente já cobre, salvo exigência específica; envio a IA externa com minimização e verificação de retenção/treinamento/transferência internacional.
- **Limites**: sem APIs privadas, sem contornar autorização, sem dados clínicos/sexuais só porque existe tipo técnico, sem capacidade que exija aprovação específica sem verificar elegibilidade, sem colocar a aprovação na App Store em risco; pedir permissão progressiva se fizer sentido; sem prometer tempo real que o iOS não garante.
- **Funcionalidades pedidas (a implementar, em lotes revisáveis)**: (1) revisão do catálogo oficial do HealthKit + sincronização automática oficial (preservando a manual); (2) mesma investigação para cada provedor cadastrado (Strava, Polar, Wahoo, Zepp, Health Connect, Apple); (3) IA acessar TODOS os indicadores autorizados de forma seletiva e contextualizada (hoje só 5 variáveis de saúde chegam à IA); (4) cupom de desconto funcional (validado no backend, integrado ao Asaas, valor final visível antes de contratar); (5) revisão de todos os textos do app (sem tom técnico, sem travessões, ortografia/ç, ícone "i" para explicações); (6) prova alvo entra sozinha no calendário (substitui só a corrida do dia; preserva outras modalidades; sem duplicar em regenerações; reflete edição/exclusão); (7) agente monta estratégia da prova (preparação, semana da prova, execução) conforme capacidade demonstrada; (8) objetivo "Correr ultramaratona" com km (≥3 dígitos); (9) assinatura só cartão de crédito, se compatível com as regras da App Store.
- **Planejamento futuro (NÃO ativar)**: período gratuito de 14 dias e planos de assinatura por funcionalidades; valores, nomes e distribuição indefinidos. Considerar nas decisões de arquitetura (evitar acoplar acesso a um único estado "pago/não pago").
- **Achados da verificação inicial (fatos)**: checkout Asaas já usa `billingType: 'CREDIT_CARD'` (item 12 no backend já atendido; falta conferir telas e a regra da App Store); cupom parcial (<100%) registra o resgate mas o desconto NÃO é aplicado na cobrança do Asaas (só 100% funciona) — defeito real do item 4.

### 29/10/2026 — Execução da ordem de integrações completas (5 lotes) — sem commit, sem build
- **Lote 1 (textos e ultramaratona)**: objetivo "Correr ultramaratona" nas 3 listas de objetivo do app + edição rápida; pergunta de distância em km (roda de 3 dígitos, 43 a 999); `me/objective.ts` grava a distância no objetivo operacional (`UserPreferences.mainGoal` = "Correr ultramaratona de N km"), que é o que Prescritor, Gerente Técnico, painel e reavaliação leem; validação no servidor (43 a 999). Textos: mensagens com tom técnico ("API", "servidor") reescritas; travessões removidos dos textos exibidos (84 linhas). **Não feito**: acentuação em massa das telas (a maioria dos textos está sem acento, e os mesmos textos são valores de respostas guardadas, como os objetivos; precisa separar rótulo de valor antes) e ícone "i" de explicação.
- **Lote 2 (prova alvo no calendário)**: `target-races/target-race-calendar.ts` (regras puras) + `TargetRaceCalendarService`. A prova entra no programa da semana em que cai, em qualquer dia; substitui só a corrida (e esteira) prescrita do dia; outras modalidades permanecem; sessão vinculada pela meta (`origin='target_race'`, `structure.race.targetRaceId`, sem migration); nunca apaga sessão com execução, vínculo de atividade ou entrega a relógio; chamada ao criar/editar/excluir a meta e depois de cada geração de semana (idempotente, sem duplicar). Prompt do Prescritor (`RACE_CALENDAR_INSTRUCTION`): dia da prova ocupado, preparação/polimento/semana da prova, estratégia conforme capacidade demonstrada, ultramaratona.
- **Lote 3 (pagamento e cupom)**: checkout Asaas já era só cartão (`CREDIT_CARD`); iOS/Android nativos seguem a compra da loja (RevenueCat) e o app oculta o cupom no iOS da loja. Cupom parcial agora tem efeito real: o valor da assinatura criada no Asaas é o valor com desconto (vale para todas as mensalidades da assinatura nova — decisão registrada), `priceLabel` mostra desconto e valor final antes de contratar, e o cupom é recusado (sem registrar resgate) quando: o desconto deixa o valor abaixo do mínimo do cartão (R$ 5), a assinatura já está ativa ou é da loja. Assinatura pendente criada antes do cupom é ajustada por `PUT /subscriptions/{id}`; se o Asaas recusar, falha com mensagem (nunca mostra desconto não cobrado). **A confirmar em ambiente real do Asaas**: se `value` é aceito no PUT; cupom 100% e códigos de ambiente seguem como acesso liberado. Cupom da loja (oferta promocional Apple/Google) é mecanismo diferente e NÃO existe: o mesmo código não vale nos dois canais.
- **Lote 4 (IA e saúde)**: `training-intelligence/health-indicators.ts` + `HealthIndicatorsService`: resumo seletivo (últimos 28 dias, por fonte, valores e unidades originais, mín/máx/média/últimos 7) de ~55 indicadores além das 5 variáveis do snapshot, entregue em `athleteStateContext.indicadoresDeSaudeAutorizados`; `query()` devolve a série diária de indicadores e período específicos para outros agentes. Fail-closed: sem escopo de IA nada sai; categoria não autorizada, retirada ou com texto desatualizado é tratada como inexistente; `heart_rate`, `mobility`, `lifestyle_load` entraram em `HEALTH_AI_CATEGORIES`; pressão, glicemia, ciclo e percurso nunca entram. HRV SDNN x RMSSD e fontes diferentes nunca se misturam. Prompt: `HEALTH_INDICATORS_INSTRUCTION` (sem nota de prontidão, sem causalidade automática).
- **Lote 5 (integrações e políticas)**: ver matriz no relatório. Achados de política: (1) **Strava API Policy §5.3/§5.10**: proíbe dado Strava em janela de contexto de IA e divulgação a provedores de IA, mesmo com consentimento. O projeto já excluía o Strava da IA (05/10/2026): MANTER. §2.3: dado Strava só pode ser exibido ao próprio atleta; o painel do treinador exibe atividades Strava de alunos → **risco aberto, a decidir com o Elton/jurídico**. (2) **Apple**: consentimento passou a 2.1 e nomeia a Anthropic e a transferência internacional na própria tela (transparência exigida para dados compartilhados com IA de terceiros), sem autorização de IA separada. (3) Polar AccessLink: disponíveis e NÃO coletados: cardio load, FC contínua (5 min), activity samples, physical-info, SpO2/temperatura/ECG (só Elixir); cada um exige grupo de consentimento próprio e conferência de payload real. (4) Wahoo: escopos `user_read workouts_read offline_data` (menor privilégio); a API não fornece sono/HRV. (5) Garmin/COROS: sem credenciamento de desenvolvedor, indisponíveis (dependência externa).
- **Pendências declaradas**: sincronização automática do HealthKit (observer + background delivery exige código nativo e entitlement, não feito); ampliação Polar/Health Connect/Zepp; acentuação em massa e ícone "i"; Swift não compilado; testes: 2 suítes antigas ajustadas por mudança intencional (prompts congelados e ordem do construtor), falha antiga `legal-content` (PolarConnect) mantida.
- **Decisão futura registrada (não ativar)**: período gratuito de 14 dias e planos de assinatura por funcionalidade; valores, nomes e distribuição indefinidos. O acesso hoje depende de `subscriptionStatus`; não acoplar novas regras a "pago/não pago" único.

### 30/10/2026 — Rodada de continuidade (cupons flexíveis, textos, estratégia de prova, IA) — sem commit, sem build
- **Princípios permanentes** (reafirmados nesta ordem): (1) aproveitar o máximo de dados de treino, saúde, recuperação e comportamento que as integrações oficiais disponibilizem, respeitando LGPD, permissões, revogações e políticas dos provedores; (2) finalidade: melhorar análises longitudinais, interpretar respostas ao treino e apoiar prescrições individualizadas com IA, sem nota artificial de prontidão; (3) privacidade: nunca vender, comercializar nem divulgar dados individuais; só finalidades informadas; dado revogado não entra em análise posterior; restrição de um provedor à IA prevalece sobre o consentimento (Strava fica fora da IA); só o necessário vai a serviços externos de IA; sem autorização de IA redundante quando o texto existente já cobre; (4) **regra desta rodada**: implementar tudo o que os acessos, credenciais e permissões JÁ existentes permitem; novas permissões, credenciamentos e aprovações ficam registrados como dependência e são tratados depois, sem contornar nada e sem ampliar acesso silenciosamente; (5) cupons seguem as condições cadastradas no painel, sem regra comercial fixa nem inventada; (6) interface com português correto, explicações contextuais e nenhuma mensagem técnica de desenvolvimento; (7) **planejamento futuro (não ativar)**: 14 dias gratuitos para novos alunos e planos diferentes por funcionalidade, sem preços, nomes, quantidade ou distribuição definidos; manter a arquitetura aberta (acesso hoje depende de `subscriptionStatus`).
- **Cupons (substitui a decisão de 29/10 de "desconto em todas as mensalidades")**: condições no cadastro do cupom (`Coupon`: tipo percentual ou valor fixo, limite de usos, validade, duração em mensalidades; todas opcionais, vazio = sem limite). `billing/coupon-rules.ts` decide (definição) e `billing/coupon-charge.ts` executa no Asaas (cobrança). Resgate tem estado: `reserved` (desconto escolhido, não conta uso) → `applied` (só depois de o valor da assinatura ser RELIDO no Asaas e bater com o planejado). Desconto que o provedor não executa não é simulado: **desconto limitado a N mensalidades está recusado com explicação** (cadastro e uso) até haver execução real (precisaria devolver o valor cheio no meio da assinatura). Migration aditiva `20261030120000_coupon_conditions` (colunas novas com padrão; cupons e resgates existentes mantêm o comportamento). Painel: tipo, valor, limite de usos, validade e duração. **Contrato Asaas**: `PUT /v3/subscriptions/{id}` existe e aceita `updatePendingPayments`; a página oficial não lista `value` com clareza, por isso nenhuma atualização é dada como boa sem reler a assinatura (`GET`) e comparar o valor. Não foi possível chamar o Asaas daqui (sem credencial, e nunca se usa chave real nem cobra aluno): a verificação em sandbox/produção controlada continua obrigatória antes de divulgar cupom com desconto.
- **Textos**: mensagens estáticas acentuadas nos contextos de texto (prompt, ajuda, rótulo, mensagem, JSX) e, para o que é valor guardado, **separação entre rótulo e valor**: `option()` agora fixa o valor original ao acentuar o rótulo; `src/ptAccent.ts` acentua só a apresentação (módulo, enunciado, ajuda e opções da entrevista, objetivo no cabeçalho) sem alterar chaves nem valores guardados. `InfoTip` (ícone circular de informação) em pagamento e Apple Saúde. **Residual honesto**: textos em lugares fora dos contextos tratados e valores guardados exibidos em telas de resumo podem ainda aparecer sem acento; a lista é ampliável no dicionário `ptAccent.ts` (palavras sem ambiguidade; "e" solto não é corrigido automaticamente).
- **Estratégia de prova / ultramaratona**: o prompt do usuário agora leva `diasAteAProva` além de nome, data, distância, meta de ritmo e questionário; o objetivo leva a distância ("Correr ultramaratona de N km"); o limite de tempo-alvo da prova subiu para 10 dias para suportar ultras longas. Teste `race-strategy-context.spec.ts` prova o que chega ao agente (e que zero informado continua zero nos indicadores).
- **Integrações (com os acessos atuais)**: Health Connect já lê todos os tipos que o manifesto declara; tipos adicionais (pressão, glicemia, temperatura corporal, taxa metabólica, andares etc.) exigem novas permissões no manifesto e na declaração da Play Console → pendente. Polar: sono, Nightly Recharge e atividade diária já coletados; cardio load, FC contínua, amostras e informações físicas não estão cobertos pelo texto de autorização atual → pendentes de grupo de consentimento. Wahoo: `workouts_read` apenas; a API não fornece sono/HRV. Zepp: segue o que o fornecedor entrega. Strava: fora da IA (política §5.3/§5.10); exibição de atividades Strava ao treinador conflita com §2.3 → risco aberto, nada ampliado. Garmin/COROS: dependem de credenciamento. Apple: sincronização automática via observer/background delivery exige capacidade nativa nova (entitlement no App ID) e código Swift não compilável aqui → pendente; sincronização manual preservada; permissões do iOS já são progressivas por grupo.
- **Dados sensíveis e IA**: pressão arterial, glicemia, ciclo e percurso continuam fora da IA porque o texto de consentimento atual (2.1) afirma isso ao aluno; mudar exigiria nova versão de texto e nova confirmação → registrado como dependência, não aplicado.
- **Política de Privacidade (30/10/2026)**: a seção do Apple Saúde dizia "não lemos sono, HRV, FC de repouso, passos, peso" e estava FALSA desde a v2 do consentimento; foi reescrita (treinos de todos os tipos, saúde do dia a dia por grupo, 3 anos, Anthropic e transferência internacional, dados sensíveis fora da IA, revogação por grupo). `LEGAL_VERSION` subiu para `2026-10-30` (mudança material: alunos serão levados a aceitar a nova versão). Continua pendente a revisão de advogado.
- **Testes (bateria completa da API, 30/10)**: 3.018 passam. Falhas que permanecem e NÃO são desta rodada: `legal-content` (PolarConnect na tela Privacidade e dados) e `analytics-instrumentation` (exports `isFirstPaidAcquisition` e `buildCohortSteps` ausentes já no commit anterior). Guardas de arquitetura (Zepp/Central/provider-hub/migration mais recente) foram ajustadas para reconhecer os arquivos de consentimento e registro do Apple, que usam os mesmos auxiliares do Health Connect. O teste de `ios-store-compliance` estoura 5 s só quando a máquina está carregada (passa isolado).

### 30/10/2026 — Ordem final: correção, build e publicação (em andamento)
- **Strava**: NÃO MEXER. Aguardando a liberação da Strava. Nada da integração, dos dados, permissões, painel ou IA foi alterado; as pendências de política (§2.3 exibição ao treinador, §5.3 IA) continuam apenas registradas.
- **Texto**: componente `Text` do aplicativo passou a ser `src/PtText.tsx` (24 arquivos), que corrige a acentuação só na EXIBIÇÃO (valores guardados e identificadores intactos; texto de uma palavra só não é alterado, para não mexer em nomes). Cobre telas de resumo, listas e interpolações fora de `ptAccent`.
- **Asaas**: sem credencial de sandbox neste ambiente (`.env` sem `ASAAS_*`): validação REAL pendente; só testes simulados passaram. Cupom com desconto NÃO deve ser divulgado antes dessa validação.
- **Builds (30/10/2026, commit 382e8e4)**: iOS build EAS `5f9f1e30-8a2b-4919-88f7-ea9afff36941`, versão 1.0.0, build number 14, FINALIZADO (o módulo Swift compilou na nuvem do EAS, no macOS); enviado ao App Store Connect (submissão EAS `924a2c00-2717-4284-84ce-f651358777d1`, FINISHED). Android build EAS `a114c916-dcd0-46c6-a124-0f6f95c44635`, versionCode 13, FINALIZADO (.aab); envio ao Google Play BLOQUEADO: falta a chave de conta de serviço do Google no EAS (não configurável em modo não interativo). **Não testado em aparelho**: permissões, importação, sincronização, revogação e rotas do Apple Saúde só podem ser validadas em iPhone real. Revisão da Apple e do Google: pendentes. Backend (migration `20261030120000_coupon_conditions` roda no start do contêiner) e PWA: aguardando deploy manual no EasyPanel. Asaas: validação real pendente.
- **Rejeição iOS (30/10/2026)**: o build 14 (versão 1.0.0) foi recusado no processamento da Apple por versionamento: ITMS-90186 (trem de pré-lançamento 1.0.0 já fechado) e ITMS-90062 (`CFBundleShortVersionString` precisa ser maior que a versão 1.0.0 já aprovada). Nenhuma mudança de funcionalidade: só `expo.version` 1.0.0 -> 1.0.1 (commit `87cdc4d`). Novo build iOS EAS `404c67d1-3d01-4b83-a698-e6b084225832`, versão 1.0.1, build 15, FINALIZADO; upload ao App Store Connect concluído (submissão EAS `735c143b-9d59-42bb-99f4-d5d024801c28`). Estado: upload concluído; processamento pela Apple em andamento (e-mail ao terminar); build aceito e app aprovado ainda NÃO confirmados. Android: build 13 (versão 1.0.0) enviado manualmente ao Play Console; falta a declaração de apps de saúde (Health Connect) para salvar a versão.
- **Asaas sandbox (30/10/2026) — contrato validado**: `apps/api/scripts/asaas-sandbox-check.cjs` (só sandbox, sem banco, sem alunos; recusa chave que não seja `hmlg`) rodou com a chave de teste do Elton e TODAS as verificações passaram: assinatura criada já com valor com desconto (9,95) devolve o mesmo valor; `GET` relido confere; a primeira cobrança gerada vem com o valor com desconto e `billingType: CREDIT_CARD` (só cartão); `PUT /subscriptions/{id}` com `value` altera a assinatura e, com `updatePendingPayments`, altera a cobrança pendente; limpeza concluída. **Resolve a dúvida do contrato** (o `value` no PUT funciona). **Ainda NÃO validado**: o fluxo completo no app (aluno aplica cupom -> reserva -> checkout -> pagamento com cartão de teste -> resgate `applied`), e os caminhos de falha/cancelamento de ponta a ponta; só têm testes simulados. Cupom parcial segue sem divulgação até esse teste de ponta a ponta (API local + banco de TESTE + sandbox). A chave de sandbox usada foi exposta em captura de tela e deve ser apagada no painel do sandbox.
- **Correção de defeito (30/10/2026) — acentuação na exibição**: `src/ptAccent.ts` (módulo gerado por script) saiu com caracteres de controle (backspace, 0x08) no lugar de `\b` dentro das expressões regulares; por isso a correção de exibição (`PtText`, `localizeQuestion`) NUNCA alterou texto algum nos builds iOS 1.0.1 (15) e Android 13 (a PWA recebe a correção no próximo deploy). Corrigido, com teste de regressão (`pt-accent.spec.ts`, inclusive varredura de caracteres de controle nos fontes) e a palavra "medio" acrescentada. Os apps das lojas só ganham a correção em um novo build (1.0.2).
- **Painel do treinador (30/10/2026)**: Aluno > Integrações > Apple Saúde agora mostra um item por grupo de autorização (treinos, medidas do treino, percurso, atividade do dia, sono, frequência cardíaca, HRV, VO₂, composição, sinais vitais, mobilidade, hábitos, nutrição, pressão/glicemia, ciclo), com autorizado/não e o que chegou, como a Polar e o Health Connect. Teste `student-integrations-apple.spec.ts`.
- **Em investigação**: Jú (iPhone, 1.0.1) autorizou a folha do iOS (70+ itens) mas nada novo chegou (Sono vazio em Evolução > Explorar). O servidor só recebe dado de saúde com consentimento por grupo registrado; é preciso ver, no cartão novo, se os grupos foram registrados e qual mensagem o app mostrou ao fim da sincronização.
