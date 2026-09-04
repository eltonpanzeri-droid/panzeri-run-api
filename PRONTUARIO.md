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

---

## Onde as coisas estão agora (2026-09-02) — leitura rápida pra quem chega de fora

**Produto em produção, sendo usado por alunas reais**: a versão web/PWA, em
`https://panzerirun.eltonpanzeripersonal.com.br`. Entrevista, geração de treino por IA, registro de
treino, pagamento via Asaas (boleto/cartão recorrente), backup diário, alertas de crash e de dor
grave pro treinador via Telegram — tudo isso funcionando e testado com alunas reais ao longo de
várias semanas de uso real.

**Em construção, ainda não publicado**: apps nativos Android e iOS, pra publicar na Google Play e
App Store. Ambos já rodam de ponta a ponta em testes reais (emulador Android + iPhone físico), com
compra dentro do app (RevenueCat) integrada no código dos dois lados. Falta, pra publicar de fato:

1. **Android**: RevenueCat validado, ficha da loja no Play Console 100% preenchida (texto, imagens,
   segurança dos dados, classificação, público-alvo). Build de produção (`.aab`) gerado em 02/09,
   aguardando confirmação de conclusão. Falta: configurar a "Offering"/produto no RevenueCat, subir
   o `.aab` na trilha de teste fechado, juntar pelo menos 12 testadores reais e rodar 14 dias — só
   depois disso dá pra pedir liberação de Produção (exigência do próprio Google, não opcional).
2. **iOS**: confirmar o preço da assinatura no App Store Connect, ligar o produto a uma "Offering" no
   RevenueCat (mesmo passo do Android), gerar um build de produção e enviar junto com a primeira
   assinatura pra revisão da Apple — ainda não retomado depois da rodada de Android desta sessão.
3. **Testar uma compra de verdade em modo sandbox** (não cobra nada real) nas duas lojas antes do
   lançamento público, pra confirmar que o webhook do RevenueCat está liberando acesso corretamente.
4. Conta de desenvolvedor Google Play já criada e verificada; conta de desenvolvedor Apple já
   existia antes desta sessão.

**Não iniciado ainda**: integração com WhatsApp (existe uma VPS Hostinger com Evolution API/n8n já
configurada, mas nada conectado ao Panzeri Run ainda).

**Pendências que não bloqueiam lançamento, mas seguem em aberto**:
- Texto de Termos de Uso / Política de Privacidade ainda não teve revisão jurídica profissional —
  decisão consciente do treinador, revisitada periodicamente.
- Fluxo completo "5 perguntas → assinatura → entrevista completa → rotina → gerar treino" nunca foi
  testado ponta a ponta com um pagamento Asaas real (só manualmente até a tela de assinatura).
- Identidade visual (29-30/08): ícone/splash e a cor/marca dos botões e cabeçalho já aplicados de
  ponta a ponta. Ainda existe uma segunda direção visual (v2, alinhada com outro app do treinador,
  Panz Fit) proposta mas **não decidida nem implementada** — fica só como material de referência em
  `identidade-visual-panzeri-run-v2-familia-panz/` até o treinador escolher.
- **Limite de alunos conectados no Strava**: hoje no teto de 10 (Standard Tier). Pedido de aumento
  enviado à Strava em 30/08, aguardando resposta deles — pode levar alguns dias/semanas.
