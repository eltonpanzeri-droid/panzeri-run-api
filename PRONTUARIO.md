# Prontuário do Panzeri Run

Este documento existe para qualquer pessoa (inclusive uma IA numa sessão nova, sem memória das
conversas anteriores) entender rapidamente **o que é o app, como ele é construído e o que vem
acontecendo com ele** — sem precisar ler centenas de commits ou reconstruir o histórico do zero.

Não é extenso de propósito. A ideia é atualizar este arquivo a cada 1–2 semanas (ou depois de um
incidente importante), acrescentando um novo bloco em "Diário" e ajustando as seções acima se algo
estrutural mudou. Não é um changelog técnico completo — para isso existe o histórico do git.

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

Deploy em produção via EasyPanel. Sincronização do código local para o repositório do GitHub
Desktop é feita por `atualizar-github-panzeri-run.bat` — o treinador confere no GitHub Desktop e
decide commit/push/deploy, isso nunca é feito automaticamente pela sessão de IA.

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

- **Rotina/disponibilidade real (dias, modalidade, duração)** — tabela `WeeklyAvailability`. É a
  ÚNICA fonte usada para decidir quais dias/modalidades o motor de treino gera. Confirmado nesta
  auditoria: a entrevista NÃO alimenta isso diretamente na geração do treino.
- **Respostas da entrevista inicial** (`OnboardingInterview.answers`, JSON livre) — usadas para: (a)
  popular perfil/saúde/preferências do aluno no momento em que a entrevista é concluída; (b) estimar
  um pace de fallback quando não há teste de 3km; (c) contexto de leitura para o agente de
  prescrição (objetivo, histórico, dor relatada) e para o Gerente Técnico; (d) exibição no painel
  admin; (e) mapeamento de perguntas equivalentes na reavaliação periódica. Não decide rotina.
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
