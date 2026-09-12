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
- `atualizar-github-panzeri-run.bat` — sincroniza o código local com o mirror que o GitHub Desktop
  monitora (ver nota sobre os dois diretórios, entrada de 06/09/07/09 no Diário).
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
