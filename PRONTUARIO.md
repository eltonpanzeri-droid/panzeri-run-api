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

**Pontos em aberto / para acompanhar antes de publicar nas lojas:**
- Texto de Termos de Uso / Política de Privacidade ainda não teve revisão jurídica profissional —
  o treinador pediu para deixar assim por enquanto e revisar de novo depois.
- Fluxo completo "5 perguntas → assinatura → entrevista completa → rotina → gerar treino" foi
  testado uma vez, manualmente, pelo próprio treinador, até a assinatura (não concluiu o pagamento
  de verdade) — vale um teste ponta a ponta com pagamento real antes de publicar.
- Integração com WhatsApp (Evolution API/n8n numa VPS Hostinger já configurada) e publicação nas
  lojas (Play Store/App Store) seguem como as duas frentes maiores ainda não iniciadas — publicar
  o app foi apontado como a mais rápida das duas quando perguntado, mas nenhuma foi retomada ainda.
