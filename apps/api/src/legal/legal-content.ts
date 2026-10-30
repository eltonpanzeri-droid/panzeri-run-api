// FONTE CANONICA dos Termos de Uso e da Politica de Privacidade (05/10/2026).
// Tudo que e' publico (paginas HTML) e tudo que o app mostra na tela "Privacidade e dados" sai DAQUI —
// nenhum outro lugar tem copia do texto. As URLs /termos-de-uso e /politica-privacidade sao as
// canonicas (usadas pelo cadastro no app e pelas lojas); /legal/terms e /legal/privacy apenas
// redirecionam para elas.
//
// Regra editorial: o texto descreve o que o sistema FAZ (conferido no codigo). Nao afirma conformidade
// legal, nao inventa prazo, base legal nem garantia de fornecedor. O que depende de contrato ou de
// configuracao externa e' dito como tal.

// 30/10/2026 (2a revisao do dia): texto geral reorganizado (compromisso, idade minima, compromissos sobre compartilhamento, declaracoes de uso dos dados de saude exigidas pelas lojas,
// Google Analytics na lista de terceiros, identificacao do responsavel). A versao muda porque o texto mudou (quem aceitar daqui em diante registra esta).
export const LEGAL_VERSION = '2026-10-30.2';
export const LEGAL_UPDATED_LABEL = '30 de outubro de 2026';
export const LEGAL_CONTROLLER_NAME = 'Elton Almeida Panzeri';
export const LEGAL_CONTACT = 'eltonpanzeri@gmail.com';
export const LEGAL_PATHS = { terms: '/termos-de-uso', privacy: '/politica-privacidade' } as const;

export interface LegalSection {
  id: string;
  heading: string;
  // Itens iniciados por "- " viram lista; os demais, paragrafos.
  paragraphs: string[];
}

// ─── Blocos compartilhados (Politica, Termos e tela do app usam as MESMAS frases) ──────────────────

export const DATA_CATEGORIES = [
  '- Cadastro e perfil: nome, e-mail, telefone, CPF, endereço, data de nascimento, sexo, altura e peso.',
  '- Entrevista e rotina: objetivos, disponibilidade semanal, histórico de treino, lesões e condições de saúde informadas.',
  '- Feedback de treino: esforço percebido, dor, sono, estresse, motivação, cansaço físico e mental, e suas observações.',
  '- Relatos e registros opcionais: dores, observações escritas, testes de desempenho, prova alvo, tênis cadastrados e, para quem optar, registro do ciclo menstrual.',
  '- Treino: programa de treino, sessões prescritas e realizadas, histórico, métricas de evolução (como volume e aderência) e conquistas.',
  '- Dados de dispositivos e serviços que você conectar, só dos grupos que você autorizar: atividades e desempenho, sono, recuperação e atividade diária (o que cada serviço pode oferecer está descrito nas seções 3 a 5A e, no aplicativo, em Dispositivos e integrações).',
];

export const WEARABLE_INTRO =
  'Você pode autorizar serviços externos compatíveis a compartilhar suas atividades com o Panzeri Run. Hoje o aplicativo oferece conexão com a Polar, com o Strava e com a Wahoo e, conforme o aparelho, com o Apple Saúde (iPhone) e o Health Connect (Android). Em validação, há também a conexão com a Zepp/Amazfit (seção 5A). Na Polar, além das atividades, você pode escolher à parte compartilhar sono, recuperação noturna (incluindo a variabilidade da frequência cardíaca, o HRV) e atividade diária (passos, distância e calorias): isso exige sua autorização por grupo no aplicativo, esses dados ficam visíveis ao seu treinador no painel, não são enviados à inteligência artificial e você pode retirar a autorização quando quiser, o que apaga os dados importados daquele grupo. Outros serviços poderão ser adicionados e, nesse caso, esta política será atualizada.';

const WEARABLE_FIELDS = [
  'Dependendo do serviço e das permissões que você conceder, podem ser recebidos dados como:',
  '- data e horário, duração, distância e modalidade;',
  '- ritmo, frequência cardíaca, cadência, potência, elevação e calorias;',
  '- o Panzeri Run não armazena coordenadas nem trajetos GPS dos serviços conectados, exceto o percurso GPS do Amazfit, que só é guardado se você o autorizar na conexão com a Zepp (seção 5A);',
  '- amostras e séries ao longo da atividade;',
  '- outros campos efetivamente fornecidos pelo serviço autorizado.',
  'Nem todo serviço fornece todos esses dados, e dados vindos de dispositivos podem conter erros ou limitações.',
];

export const RAW_AND_DERIVED = [
  'O Panzeri Run guarda o registro recebido do serviço conectado tal como ele chegou e gera, a partir dele, informações derivadas para: mostrar a atividade, comparar o que foi prescrito com o que foi realizado, acompanhar sua evolução, manter seu histórico ao longo do tempo e personalizar seu treinamento.',
];

export const STRAVA_PARAGRAPH =
  'Dados vindos do Strava são tratados à parte: aparecem somente para você, dentro do aplicativo; não são exibidos ao treinador nem a outros usuários, não são enviados à inteligência artificial e ficam guardados por até 7 dias desde a última atualização. Ao desconectar o Strava, a coleta é interrompida na hora e esses dados são apagados.';

export const WAHOO_PARAGRAPH =
  'Wahoo: ao conectar, o Panzeri Run recebe o identificador da sua conta Wahoo e, a cada atividade gravada em um dispositivo ou aplicativo Wahoo, o resumo dela (como data, duração, distância, modalidade, calorias, frequência cardíaca média e elevação). A Wahoo não compartilha atividades de aplicativos de terceiros. As credenciais de acesso ficam guardadas de forma cifrada e são apagadas ao desconectar. Hoje o Panzeri Run apenas lê atividades da Wahoo; não envia treinos para ela.';

// ─── Zepp/Amazfit e Atlas (20/10/2026) ─────────────────────────────────────────────────────────────────
// Descreve o que o codigo FAZ. Nada de prazo, mecanismo de transferencia ou garantia contratual inventados. Em 21/10/2026 Elton considerou resolvidas as pendencias juridicas e
// liberou o envio de dados Zepp a Anthropic (com autorizacao propria do aluno): o texto afirma so' o que e' fato (empresa estrangeira, transferencia internacional, regras do fornecedor).
export const ZEPP_PARAGRAPHS = [
  'A Zepp (Zepp Health) é o serviço dos relógios Amazfit, que você pode conectar ao Panzeri Run por escolha sua. A conexão está em validação e é opcional. Existem quatro autorizações separadas, cada uma com texto próprio, que você concede ou não de forma independente — nenhuma vem marcada e nenhuma é presumida a partir de outra: (1) importar os dados dos grupos que você selecionar (atividades e métricas fisiológicas, percurso GPS, sono e recuperação, saúde diária e HRV); (2) importar até 30 dias de atividades anteriores à conexão; (3) enviar seus treinos de corrida ao relógio; (4) usar seus dados Zepp/Amazfit em análises personalizadas com o Atlas, o que inclui enviar os dados necessários à Anthropic (seção 7A).',
  'Dados que recebemos da Zepp, conforme os grupos que você autorizar e o que o seu relógio medir: o identificador da conta Zepp (apenas para vincular a conexão); atividades (data e horário, distância, duração, ritmo, calorias, modalidade e o nome do dispositivo); frequência cardíaca, cadência, potência e elevação registradas durante a atividade; o percurso GPS; dados de sono e recuperação (duração e etapas do sono — profundo, leve, REM e acordado —, horários, cochilos e pontuação de sono); saúde diária (passos, distância, calorias ativas e frequência cardíaca de repouso); e a variabilidade da frequência cardíaca (HRV). Os dados de atividade vêm do arquivo de cada atividade que a Zepp envia ao Panzeri Run; os de sono, saúde diária e HRV chegam em resumos que a Zepp envia. Sono, frequência cardíaca e HRV são dados de saúde: só são guardados se você autorizar o grupo correspondente. Atividades digitadas manualmente na Zepp não são importadas.',
  'O arquivo original da atividade não é guardado: lemos o arquivo na hora, guardamos apenas os dados extraídos dos grupos que você autorizou e descartamos o restante. Os dados de sensores só são guardados se você autorizar esse grupo; o percurso GPS (coordenadas) só é guardado se você autorizar o grupo de percurso, e fica associado à atividade.',
  'Dados que enviamos à Zepp: somente se você autorizar o envio de treinos ao relógio, o Panzeri Run envia à sua conta Zepp os treinos de corrida programados para os próximos dias — nome do treino, data, etapas (distância ou tempo) e ritmos-alvo. Não enviamos seu nome, dados de saúde, relatos seus nem comentários do treinador. A Zepp mantém e sincroniza esses treinos com o relógio conforme as próprias regras (uma janela de sete dias). Se você retirar a autorização ou desconectar a conta, o Panzeri Run deixa de enviar treinos e os treinos já enviados deixam de existir na sua conta Zepp.',
  'Como usamos esses dados: para mostrar suas atividades, comparar o que foi prescrito com o que foi realizado, acompanhar sua evolução, entender como você se recupera, manter seu histórico, personalizar seu treinamento e permitir que seu treinador acompanhe seu treino e sua recuperação, vendo no painel dele os dados que você autorizou (por exemplo, sono, frequência cardíaca de repouso, variabilidade da frequência cardíaca, passos e calorias). Os dados recebidos da Zepp e de outros serviços ficam separados por origem, e a origem de cada dado é preservada.',
  'Seu controle: em Configurações → Integrações → Zepp/Amazfit → Privacidade e permissões você vê o estado de cada autorização e pode retirar qualquer uma quando quiser, desconectar a conta e pedir a exclusão dos dados da Zepp. Registramos cada decisão sua — qual autorização, a versão do texto, a data e se foi concedida ou retirada. Se o texto de uma autorização mudar de forma relevante, pedimos uma nova autorização; enquanto você não a conceder, ela não vale.',
  'Ao retirar a importação, a coleta de novos dados daquele grupo é interrompida na hora; os dados já importados permanecem até você pedir a exclusão deles. Ao retirar a autorização do Atlas, o uso futuro cessa e os resultados de inteligência artificial já gerados com seus dados Zepp são invalidados ou atualizados, respeitadas as obrigações legais de conservação.',
  'Desconectar a conta Zepp interrompe novas importações e envios, revoga a autorização na Zepp (o que remove da sua conta Zepp os treinos que o Panzeri Run havia enviado) e invalida os resultados de IA derivados desses dados; não apaga automaticamente o que já foi importado. A exclusão dos dados da Zepp é uma ação separada: apaga o registro recebido, a atividade, as amostras e séries (incluindo o percurso GPS), os resumos de sono, saúde diária e HRV, os vínculos com os treinos, o registro dos treinos enviados e os indicadores e relatórios derivados. Permanecem as informações que você mesmo forneceu (como esforço percebido, dor e observações), os registros de pagamento e de auditoria sem identificação direta, o registro mínimo e criptografado da exclusão, mantido por 1 ano, e as cópias de segurança (seção 10).',
  'Retenção: hoje não há exclusão automática por prazo para os dados da Zepp. Eles ficam guardados enquanto a conexão estiver ativa e até você pedir a exclusão ou excluir a conta. Não definimos um prazo adicional de retenção; se isso mudar, esta política será atualizada.',
];

export const ATLAS_PARAGRAPHS = [
  'O Atlas é o nome da inteligência artificial usada pelo Panzeri Run para apoiar a prescrição e a análise do seu treinamento (seção 7). A tecnologia é fornecida pela Anthropic.',
  'Dados da Zepp/Amazfit só entram nas análises do Atlas se você conceder a autorização específica, separada e opcional do Atlas. Sem essa autorização, os dados Zepp não são enviados à Anthropic — nem diretamente nem por meio de relatórios ou informações derivados deles. Recusar não impede conectar o Amazfit, enviar treinos ao relógio nem usar as funções que não dependam desse processamento.',
  'Com a autorização, o Panzeri Run envia à Anthropic os dados necessários à análise, sob a forma de resumos e indicadores derivados das suas atividades e dos seus dados de sono, HRV e saúde diária (como distância, ritmo, frequência cardíaca, cadência, potência, elevação, duração e pontuação do sono, HRV, frequência cardíaca de repouso e histórico), apenas nos grupos que você autorizou. O arquivo original, as séries completas de amostras, as etapas do sono minuto a minuto e as coordenadas do percurso não fazem parte do que o Panzeri Run envia à IA.',
  'As análises automatizadas podem apresentar limitações e erros, o acompanhamento é feito sob supervisão técnica do treinador e elas não substituem avaliação médica.',
  'A Anthropic é uma empresa estrangeira, e esse envio configura transferência internacional de dados. As regras da Anthropic sobre guardar essas informações ou usá-las para treinar modelos dependem dos termos do próprio fornecedor, e o Panzeri Run não as afirma por ele.',
];

export const AI_PARAGRAPHS = [
  'O Panzeri Run usa serviços de inteligência artificial em funções do produto, como montar e ajustar o programa de treino, analisar a evolução, interpretar relatos escritos e apoiar o acompanhamento feito pelo treinador. O fornecedor utilizado hoje é a Anthropic.',
  'Para cada uma dessas funções, o Panzeri Run envia ao fornecedor, no momento da solicitação, as informações necessárias àquela função, como dados do seu perfil e da entrevista, sua rotina, seus feedbacks e relatos, e seu histórico e métricas de treino. Quando você conecta a Polar ou a Wahoo, resumos derivados das suas atividades (como volume, distância e ritmo) podem fazer parte desse contexto; dados do Strava nunca fazem. O conteúdo bruto recebido desses serviços (registros completos, séries de amostras e rotas) não faz parte do que o Panzeri Run envia à IA.',
  'Este texto descreve o que o Panzeri Run envia. As regras do fornecedor sobre guardar essas informações ou usá-las para treinar modelos dependem dos termos do próprio fornecedor, e o Panzeri Run não as afirma por ele.',
];

export const DISCONNECT_PARAGRAPH =
  'Desconectar a Polar ou a Wahoo interrompe novas sincronizações e retira a autorização guardada no Panzeri Run (na Wahoo, a autorização também é revogada na própria Wahoo), mas não apaga automaticamente o histórico já importado. No Strava, desconectar também apaga os dados do Strava guardados. Na Polar, desconectar também encerra a autorização dos dados de saúde e recuperação; para voltar a importá-los, você escolhe de novo os grupos.';

export const DELETE_PARAGRAPHS = [
  'Excluir os dados importados de um serviço é uma ação separada de desconectar. Para a Polar e para a Wahoo, você faz isso no próprio aplicativo (Privacidade e dados), depois de desconectar. Para o Strava, desconectar já apaga os dados do Strava guardados.',
  'São excluídos os dados que vieram exclusivamente do serviço (o registro recebido, a atividade, as amostras, as séries e os vínculos com os treinos). Informações que você mesmo forneceu ao Panzeri Run depois, como esforço percebido, dor, observações e escolha do tênis, podem permanecer, sem os valores que vieram do serviço.',
];

export const THIRD_PARTIES = [
  '- Anthropic: tecnologia de inteligência artificial usada pelo Atlas e pelas demais funções de IA, descrita acima.',
  '- Polar, Strava e Wahoo: serviços que você conecta, com suas próprias políticas.',
  '- Zepp Health (Zepp/Amazfit): serviço que você conecta para o Panzeri Run receber suas atividades e, se você autorizar, enviar treinos ao seu relógio, com política própria.',
  '- Asaas, RevenueCat e as lojas de aplicativos (Google Play e App Store): cobrança e assinatura. Não armazenamos dados de cartão.',
  '- Resend: envio dos e-mails do serviço (como cadastro, recuperação de senha e avisos).',
  '- Cloudflare (R2): armazenamento das cópias de segurança do banco de dados, que são criptografadas antes de sair do servidor.',
  '- Expo: entrega de notificações no aplicativo.',
  '- Telegram: canal interno de avisos do treinador sobre o acompanhamento dos alunos.',
  '- Google (Google Analytics 4): só no site e no aplicativo aberto no navegador, o Panzeri Run mede o uso por páginas acessadas e por eventos agregados, como as etapas do cadastro. Os eventos não levam seus dados de saúde nem informações que identifiquem você, e o endereço da página só mantém os parâmetros de campanha (como utm_source). Não é usado no aplicativo instalado no celular.',
  '- Meta (Facebook): quando configurado, o servidor do Panzeri Run envia à Meta eventos de conversão para medir o resultado de campanhas de divulgação: um ao criar a conta e outro quando um pagamento é confirmado (com valor e moeda). Cada evento leva seu e-mail convertido em código (hash), os identificadores de navegador da Meta (quando existem) e um identificador do evento; o evento de cadastro leva também o endereço IP e o navegador usados. No fluxo atual, não são enviados à Meta dados de saúde, feedbacks, relatos nem conteúdo ou métricas de treino. Cadastros feitos pelo aplicativo para iPhone não geram nenhum envio à Meta.',
  '- ViaCEP: ao preencher o CEP na entrevista, o aplicativo consulta esse serviço público para completar rua, bairro, cidade e estado; o CEP digitado é enviado a ele.',
  '- Infraestrutura de hospedagem do aplicativo e do banco de dados.',
];

export const BACKUP_PARAGRAPHS = [
  'Mantemos cópias de segurança periódicas do banco de dados para recuperação em caso de falha. Elas contêm os dados da conta existentes no momento de cada cópia e ficam guardadas fora do banco em operação.',
  'Quando um dado é excluído do banco em operação, a remoção das cópias de segurança pode não ocorrer imediatamente: elas permanecem até serem substituídas ou descartadas pela nossa rotina, e não prometemos um prazo exato.',
  'Também mantemos, por 1 ano, um registro mínimo e criptografado das exclusões de dados de serviços conectados (identificador interno do usuário, tipo de exclusão e data), usado apenas para garantir que essas exclusões sejam mantidas em uma eventual recuperação do banco.',
];

const REQUEST_PARAGRAPHS = [
  'Pelo aplicativo você pode: ver os dados que informou nas telas de perfil e feedbacks, desconectar a Polar ou a Wahoo e excluir os dados importados delas, desconectar o Strava (o que apaga os dados do Strava) e excluir a sua conta e os seus dados (mais abaixo nesta tela, em "Excluir minha conta").',
  'Excluir a conta não cancela automaticamente uma assinatura nem as cobranças já emitidas: antes de confirmar, o aplicativo mostra a situação da sua assinatura e o que fazer.',
  `Os demais pedidos (acesso, correção, revogação de consentimento) são tratados manualmente: escreva para ${LEGAL_CONTACT}, do mesmo e-mail cadastrado. Se preferir, o pedido de exclusão da conta também pode ser feito por esse e-mail; o procedimento e os prazos estão na Política de Privacidade.`,
];

// ─── Politica de Privacidade ────────────────────────────────────────────────────────────────────

export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    id: 'compromisso',
    heading: 'Nosso compromisso com a sua privacidade',
    paragraphs: [
      'O Panzeri Run utiliza informações pessoais, esportivas e de saúde para oferecer um programa de treinamento individualizado, acompanhar a sua evolução e ajudar você a tomar decisões mais conscientes sobre a sua prática de exercícios físicos.',
      'Sabemos que algumas dessas informações são sensíveis. Por isso, tratamos seus dados com responsabilidade, transparência e medidas de segurança adequadas, respeitando as suas escolhas, a legislação aplicável e as autorizações que você conceder.',
      'Este é o texto geral sobre como usamos os dados. As particularidades de cada dispositivo ou serviço que você conectar estão nas seções 3 a 5A abaixo e, no aplicativo, na tela de cada integração (Dispositivos e integrações), onde você também concede as autorizações específicas. Nem todas as informações descritas são necessárias para usar o Panzeri Run: o que é recebido depende das funcionalidades que você usa, dos registros existentes e das autorizações que você der.',
    ],
  },
  {
    id: 'quem-somos',
    heading: '1. Quem é o responsável',
    paragraphs: [
      `${LEGAL_CONTROLLER_NAME} é o responsável pelo Panzeri Run e o controlador dos dados pessoais tratados pelo aplicativo (versões para iPhone, Android e navegador).`,
      `Contato para qualquer assunto de privacidade, inclusive para exercer os seus direitos: ${LEGAL_CONTACT}. Esse é o canal direto com o responsável pelo tratamento. Poderemos pedir informações adicionais para confirmar a sua identidade e proteger os seus dados contra pedidos não autorizados.`,
    ],
  },
  {
    id: 'idade-minima',
    heading: '1A. Quem pode usar',
    paragraphs: [
      'O Panzeri Run é destinado a pessoas com 18 anos ou mais. O aplicativo não é voltado a crianças nem a adolescentes e não deve ser usado por menores de 18 anos.',
      `Se você tiver conhecimento de uso do Panzeri Run por uma pessoa menor de 18 anos, avise pelo e-mail ${LEGAL_CONTACT} para que o caso seja analisado e os dados sejam tratados conforme a lei.`,
    ],
  },
  { id: 'dados', heading: '2. Dados que tratamos', paragraphs: ['Dados fornecidos por você ou gerados pelo uso do aplicativo:', ...DATA_CATEGORIES, 'Dados de pagamento são processados pelo Asaas ou pela loja de aplicativos; não armazenamos dados de cartão.'] },
  {
    id: 'apple-saude',
    heading: '3. Apple Saúde (HealthKit) — iPhone',
    paragraphs: [
      'Esta seção vale somente para o aplicativo do Panzeri Run instalado no iPhone. Ela não se aplica ao uso pelo navegador nem ao aplicativo Android.',
      'Duas autorizações diferentes: (1) a permissão do próprio iOS, em uma janela do iPhone, que deixa o aplicativo LER os dados no aparelho; e (2) a autorização registrada no Panzeri Run, em Dispositivos e integrações > Apple Watch, que decide o que o Panzeri Run pode GUARDAR e USAR. O Panzeri Run só guarda o que você autorizar nas duas. O iPhone não informa ao aplicativo o que foi negado: se um dado não aparece, pode ser que ele não exista no seu treino ou que a leitura não tenha sido permitida.',
      'Pedimos apenas permissão de leitura. Não pedimos permissão para gravar e não gravamos nenhum dado no app Saúde. Você pode retirar a permissão do iPhone a qualquer momento em Ajustes do iPhone > Saúde > Acesso a dados e dispositivos > Panzeri Run.',
      'O que lemos, só dos grupos que você autorizar: (a) treinos de todos os tipos, dos últimos 3 anos e depois só os novos: identificador do treino, tipo de atividade, início, fim, duração, distância, velocidade média, calorias ativas, se foi em ambiente fechado, fuso horário e o nome do aplicativo e do aparelho que registraram o treino. Se você autorizar o grupo de medidas, também lemos as medidas guardadas junto do treino: frequência cardíaca média e máxima, passos (usados para calcular a cadência), potência, passada, tempo de contato com o solo, oscilação vertical e ganho de elevação. Se você autorizar o grupo de percurso, lemos a rota (GPS) do treino, o trajeto percorrido, que é um dado de localização sensível. Esses dados dependem do que o seu relógio ou aplicativo registrou: o que não foi registrado fica sem valor e nunca é preenchido por estimativa. Uma distância informada como zero é mantida como foi informada e sinalizada como limitação, sem ser interpretada.',
      '(b) Saúde do dia a dia, em grupos separados que você escolhe: atividade do dia (passos, distância, escadas, calorias, minutos de exercício e de pé), sono (duração, etapas e horários), frequência cardíaca do dia (repouso, média, mínima, máxima, recuperação e avisos de frequência alta, baixa ou ritmo irregular), variabilidade da frequência cardíaca (HRV, medida pelo Apple Watch como SDNN), VO₂ máximo, peso e composição corporal, oxigenação, temperatura e respiração, mobilidade, hábitos (luz do dia, atenção plena e exposição a ruído), nutrição e hidratação, pressão arterial e glicemia, e ciclo menstrual. Pressão arterial, glicemia e ciclo menstrual são dados sensíveis. Não lemos dados cadastrais do app Saúde (como data de nascimento, sexo biológico e tipo sanguíneo), registros clínicos importados de hospitais, eletrocardiograma completo, medicamentos nem receitas de óculos.',
      'Quando os dados saem do seu aparelho: a leitura acontece no próprio iPhone. Os dados só são enviados ao Panzeri Run quando você toca em "Continuar e sincronizar". Não há envio automático em segundo plano. A primeira sincronização lê o histórico dos últimos 3 anos dos grupos autorizados e pode demorar alguns minutos; se for interrompida, a seguinte continua de onde parou. Tocar de novo não duplica treinos: os já importados são reconhecidos e, se houver dados novos, são completados.',
      'Armazenamento e acesso: os dados ficam no servidor do Panzeri Run, vinculados à sua conta, e ficam visíveis ao seu treinador no painel. A origem de cada dado (aplicativo e aparelho) é preservada. O percurso GPS é guardado como uma série de pontos de localização ligada ao treino.',
      'Como usamos: os treinos importados são tratados como as atividades vindas de outros serviços conectados, descritas na seção 5: para mostrar a atividade, comparar o que foi prescrito com o que foi realizado, acompanhar sua evolução e personalizar seu treinamento. Resumos derivados dessas atividades, incluindo as medidas autorizadas (como frequência cardíaca média), podem fazer parte do contexto enviado à inteligência artificial, conforme a seção 7. Os dados de saúde dos grupos que você autorizar também podem compor esse contexto, apenas o necessário para cada análise. Para isso, os dados necessários são enviados à Anthropic, fornecedora da tecnologia de inteligência artificial usada pelo Panzeri Run, o que pode envolver transferência internacional de dados. O percurso GPS, a pressão arterial, a glicemia e o ciclo menstrual não são enviados à inteligência artificial. Seus dados individuais não são vendidos nem divulgados publicamente.',
      'Revogação: você pode consultar e retirar cada grupo quando quiser, no aplicativo. Ao retirar o percurso, os trajetos já guardados são apagados; ao retirar as medidas, as medidas já guardadas são apagadas; ao retirar um grupo de saúde do dia a dia, os dados daquele grupo já guardados são apagados e deixam de ser usados nas análises; ao retirar tudo, a importação é interrompida e os resultados de inteligência artificial gerados com esses dados são invalidados. Retirar a autorização não apaga os treinos já importados: para excluí-los, retire todas as autorizações e use a opção de excluir os dados importados, quando disponível, ou peça pelo contato indicado na seção 13. Você também pode excluir a conta inteira, no próprio aplicativo, como descrito na seção 13.',
      'Limitações: as somas do dia (como passos) vêm do app Saúde já combinadas entre as fontes; nem todo dado existe para todo aparelho; treinos em ambiente fechado não têm percurso; a leitura de percursos é feita aos poucos, e os pendentes seguem na sincronização seguinte; versões anteriores do aplicativo importavam apenas dados básicos do treino (início, fim, duração e distância, até 20 treinos por vez), sem o registro de autorização por grupo descrito aqui.',
      'O que não fazemos: não usamos dados do Apple Saúde para publicidade ou marketing, não os enviamos à Meta e não os compartilhamos para fins de propaganda.',
    ],
  },
  {
    id: 'apple-watch',
    heading: '4. Envio de treinos ao Apple Watch (WorkoutKit) — iPhone',
    paragraphs: [
      'Em treinos prescritos que o aplicativo consegue representar fielmente no Apple Watch, aparece o botão "Enviar ao Apple Watch". O envio só acontece quando você toca nele.',
      'Para isso, o iOS pede uma autorização própria para agendar treinos. Com ela, o Panzeri Run entrega ao seu iPhone e ao seu Apple Watch o treino prescrito (a estrutura da sessão, como partes e distâncias) e o dia em que ele deve aparecer. Agendar um treino não significa que ele foi executado.',
      'No servidor do Panzeri Run guardamos o registro dessa entrega (qual treino foi enviado, quando e com qual resultado), para não duplicar o envio. Este recurso não grava dados no app Saúde.',
    ],
  },
  {
    id: 'health-connect',
    heading: '5. Health Connect — Android, e outros serviços conectados',
    paragraphs: [
      WEARABLE_INTRO,
      'Health Connect (aplicativo Android): o Health Connect reúne, no seu celular, dados do Samsung Health, do Galaxy Watch e de outros aplicativos. Se você autorizar, o Panzeri Run lê do Health Connect, somente leitura, apenas as categorias que você escolher na tela de autorizações do aplicativo: exercícios (tipo, início, fim e duração, distância, velocidade e calorias), frequência cardíaca, potência, cadência e elevação durante cada exercício, percurso GPS, sono, saúde diária (passos, distância e calorias do dia), frequência cardíaca de repouso, variabilidade da frequência cardíaca (HRV), VO₂ máximo, saturação de oxigênio, respiração, temperatura da pele, nutrição e hidratação, e, se você autorizar, os dados anteriores aos últimos 30 dias. Nem todas as categorias estão disponíveis em todos os aparelhos, aplicativos e versões do Android: o que você autorizar passa a ser recebido quando estiver disponível, e o que você não autorizar não é lido nem guardado. Recebemos também o aplicativo que gravou o registro, o dispositivo (quando o aplicativo informa) e o método de gravação. Não gravamos nada no Health Connect. O Panzeri Run sincroniza ao abrir o aplicativo e quando você toca em "Sincronizar agora"; se você permitir no Android, também sincroniza periodicamente em segundo plano, mesmo com o aplicativo fechado, e você pode desligar isso quando quiser. O percurso GPS de cada exercício só é lido se você autorizar esse grupo e confirmar o acesso no Android para aquele exercício. Você pode retirar cada autorização, ou todas, no aplicativo, e também revogar as permissões nos ajustes do Android; ao retirar, novas leituras são interrompidas, mas o histórico já importado não é apagado automaticamente. O uso desses dados pelo Atlas (inteligência artificial) tem autorização própria e separada, que você pode conceder ou não.',
      'Polar, Strava e Wahoo: você pode autorizar esses serviços a compartilhar suas atividades com o Panzeri Run. Dependendo do serviço e das permissões concedidas, podem ser recebidos data e horário, duração, distância, modalidade, ritmo, frequência cardíaca, cadência, potência, elevação, calorias, amostras ao longo da atividade (como frequência cardíaca e velocidade); o Panzeri Run não armazena coordenadas nem trajetos GPS desses serviços. Nem todo serviço fornece todos esses dados, e dados vindos de dispositivos podem conter erros ou limitações.',
      ...RAW_AND_DERIVED,
      STRAVA_PARAGRAPH,
      WAHOO_PARAGRAPH,
    ],
  },
  { id: 'zepp-amazfit', heading: '5A. Zepp/Amazfit: importar atividades e enviar treinos ao relógio', paragraphs: ZEPP_PARAGRAPHS },
  {
    id: 'saude-lojas',
    heading: '5B. Dados de saúde recebidos do Health Connect e do Apple Saúde: limites de uso',
    paragraphs: [
      'O uso e a transferência, para qualquer outro aplicativo, das informações recebidas do Health Connect pelo Panzeri Run aderirão à Política de Permissões do Health Connect, incluindo os requisitos de Uso Limitado. As informações recebidas do Apple Saúde seguem as regras da Apple para dados de saúde.',
      'Esses dados são usados somente para oferecer e melhorar as funções do Panzeri Run voltadas a você: mostrar suas atividades, comparar treinos prescritos e realizados, acompanhar sua evolução e personalizar seu treinamento, incluindo as análises descritas na seção 7.',
      'Não usamos esses dados para publicidade nem para marketing, não os vendemos e não os transferimos a corretores de dados ou a plataformas de anúncios. Só os compartilhamos com fornecedores que executam as funções descritas neste documento (como a tecnologia de inteligência artificial e a infraestrutura), com o seu treinador, no painel de acompanhamento, quando necessário para segurança ou para cumprir a lei, ou quando você autorizar. O Panzeri Run não usa esses dados para treinar modelos de inteligência artificial próprios.',
    ],
  },
  {
    id: 'finalidades',
    heading: '6. Para que usamos',
    paragraphs: [
      'Utilizamos os dados para:',
      '- criar programas de treinamento compatíveis com os seus objetivos, a sua experiência e a sua disponibilidade;',
      '- individualizar as sessões de exercício e acompanhar a sua execução, comparando os treinos planejados com as atividades realizadas;',
      '- analisar tendências de desempenho, condicionamento físico e evolução, e acompanhar indicadores de esforço, fadiga, recuperação e prontidão para o treinamento;',
      '- considerar a sua rotina, o seu sono e as suas percepções pessoais na interpretação dos resultados, e identificar mudanças relevantes em relação ao seu próprio histórico;',
      '- produzir relatórios, gráficos e informações que facilitem a compreensão da sua evolução, e apoiar ajustes progressivos na prescrição de exercícios;',
      '- manter o histórico necessário à continuidade do acompanhamento;',
      '- prestar suporte, processar o pagamento da assinatura, enviar comunicações sobre o serviço (e-mail e notificações) e manter a segurança e o funcionamento do serviço.',
      'As análises consideram a disponibilidade, a qualidade e a consistência das informações recebidas. Nenhum indicador isolado determina necessariamente uma alteração no treinamento: sempre que pertinente, diferentes informações são consideradas em conjunto.',
    ],
  },
  { id: 'ia', heading: '7. Inteligência artificial', paragraphs: AI_PARAGRAPHS },
  { id: 'atlas', heading: '7A. Atlas e a Anthropic com dados da Zepp/Amazfit', paragraphs: ATLAS_PARAGRAPHS },
  { id: 'terceiros', heading: '8. Compartilhamento e serviços de terceiros', paragraphs: ['O Panzeri Run usa os seguintes serviços externos, cada um para a finalidade indicada:', ...THIRD_PARTIES] },
  {
    id: 'compromissos',
    heading: '8A. Nossos compromissos sobre o compartilhamento',
    paragraphs: [
      'Cada fornecedor recebe ou processa somente as informações relacionadas às funções que efetivamente executa, conforme a necessidade, as autorizações aplicáveis e as condições contratuais.',
      'Não comercializamos seus dados pessoais de saúde ou de treinamento. Não utilizamos informações individuais de saúde para direcionar publicidade comportamental.',
      'Buscamos limitar a circulação de informações diretamente identificáveis sempre que elas não forem necessárias à finalidade do tratamento, preferindo indicadores derivados ou resumos quando eles bastarem.',
      'O tratamento por fornecedores externos pode envolver infraestrutura localizada fora do Brasil. Nesses casos, observamos os requisitos legais aplicáveis às transferências internacionais de dados pessoais.',
      'A presença de um serviço na lista de integrações não significa que ele esteja recebendo os seus dados: o compartilhamento só ocorre quando houver uma conexão efetiva autorizada por você.',
    ],
  },
  { id: 'desconexao', heading: '9. Desconectar um serviço e excluir os dados importados', paragraphs: [DISCONNECT_PARAGRAPH, ...DELETE_PARAGRAPHS] },
  { id: 'backup', heading: '10. Cópias de segurança', paragraphs: BACKUP_PARAGRAPHS },
  {
    id: 'retencao',
    heading: '11. Retenção',
    paragraphs: ['Os dados são mantidos enquanto a conta estiver ativa e pelo prazo necessário para cumprimento de obrigações legais após o encerramento. As cópias de segurança seguem o descrito na seção 10.'],
  },
  {
    id: 'direitos',
    heading: '12. Seus direitos',
    paragraphs: [
      'A Lei Geral de Proteção de Dados (LGPD) garante a você, entre outros direitos: confirmar que tratamos seus dados; acessar e corrigir seus dados; pedir a anonimização, o bloqueio ou a eliminação de dados desnecessários, excessivos ou tratados em desconformidade; pedir a portabilidade; pedir a eliminação dos dados tratados com base no seu consentimento; saber com quem compartilhamos seus dados; saber que pode não dar o consentimento e quais as consequências; e revogar o consentimento a qualquer momento; pedir informações sobre decisões tomadas unicamente com base em tratamento automatizado e a revisão delas, nos termos da lei; e apresentar reclamações à autoridade competente (a Autoridade Nacional de Proteção de Dados).',
      `Como exercer: parte do controle já está no aplicativo, na área Privacidade e dados e, para a Zepp/Amazfit, em Privacidade e permissões. Para os demais pedidos, escreva para ${LEGAL_CONTACT}, do mesmo e-mail cadastrado, que é o canal do responsável pelo tratamento.`,
    ],
  },
  {
    id: 'exclusao-conta',
    heading: '13. Como excluir sua conta e seus dados',
    paragraphs: [
      'Pelo aplicativo: abra Privacidade e dados > Excluir minha conta. Para confirmar, o aplicativo pede a sua senha atual e que você digite EXCLUIR CONTA. A exclusão é definitiva: não é possível recuperar a conta nem os dados depois dela.',
      'Assinatura e cobranças: excluir a conta NÃO cancela automaticamente cobranças feitas fora do Panzeri Run. Antes de excluir, o aplicativo mostra a situação da sua assinatura e não impede a exclusão por causa dela. Se a assinatura for pelo Asaas, o aplicativo também informa se já existem cobranças emitidas pendentes ou vencidas. Segundo a documentação do Asaas, cancelar (remover) a assinatura também remove as cobranças pendentes e vencidas ligadas a ela, e cobranças já pagas permanecem registradas e não são devolvidas; essa regra é do Asaas, não do Panzeri Run. Você pode escolher cancelar a assinatura junto com a exclusão, a seu pedido, ou excluir a conta sem cancelar; nesse caso as cobranças já emitidas continuam válidas, novas cobranças podem continuar sendo geradas até que a assinatura seja cancelada, e o responsável pelo Panzeri Run é avisado para poder tratar o caso. Para excluir sem cancelar, o aplicativo pede uma confirmação específica de que você entende isso. Se a assinatura for pela loja de aplicativos (Google Play), somente você pode cancelá-la, nas configurações da própria loja, e o aplicativo mostra como. Se, mesmo assim, uma cobrança chegar depois da exclusão, ela é registrada apenas como registro financeiro, sem identificação, e a conta não é reativada.',
      `Por e-mail: se preferir, envie uma mensagem para ${LEGAL_CONTACT}, do mesmo endereço cadastrado no Panzeri Run, com o assunto "Exclusão de conta". Confirmamos o pedido em até 5 dias úteis e concluímos a exclusão em até 15 dias.`,
      'O que acontece: a conta é anonimizada de forma irreversível. Nome, e-mail, CPF, telefone, endereço, data de nascimento e demais dados de perfil são removidos, o acesso deixa de ser possível e o e-mail poderá ser usado em um novo cadastro. São excluídos, no banco em operação, os dados de saúde e condicionamento físico, a entrevista, a rotina, os feedbacks e relatos, o registro do ciclo menstrual, o histórico de treinos prescritos e realizados, os dados importados de serviços conectados (incluindo Apple Saúde e Health Connect), as informações usadas pela inteligência artificial, as notificações, as mensagens trocadas com o treinador/agente de IA e as credenciais de acesso. Se você conectou Polar ou Wahoo, a autorização é revogada.',
      'O que permanece: registros de pagamento e de assinatura (valores, datas e identificadores do pagamento), o registro do uso de cupons e registros técnicos de auditoria, todos vinculados a um identificador técnico anônimo, sem nome, e-mail, CPF ou outros dados de identificação direta.',
      'Também guardamos, por 1 ano, um registro mínimo e criptografado da exclusão da conta (identificador interno e data), usado apenas para garantir que a exclusão seja mantida em uma eventual recuperação do banco de dados. As cópias de segurança seguem o descrito na seção 10.',
      'Fora do Panzeri Run: serviços que você usa separadamente, como o Asaas, a loja de aplicativos, a Polar, a Wahoo e o Strava, mantêm seus próprios registros, conforme as políticas deles. Mensagens e e-mails que já foram enviados não podem ser apagados por nós.',
    ],
  },
  {
    id: 'alteracoes',
    heading: '14. Alterações e versão',
    paragraphs: [`Esta é a versão de ${LEGAL_UPDATED_LABEL}. Este documento pode ser atualizado para refletir mudanças nas funcionalidades, integrações, fornecedores, práticas de segurança ou exigências legais. Alterações relevantes serão comunicadas dentro do aplicativo e, quando exigirem nova autorização, solicitaremos a autorização correspondente.`],
  },
  { id: 'contato', heading: '15. Contato', paragraphs: [`${LEGAL_CONTROLLER_NAME} — ${LEGAL_CONTACT}`] },
];
// ─── Termos de Uso ─────────────────────────────────────────────────────────────────────────────

export const TERMS_SECTIONS: LegalSection[] = [
  {
    id: 'o-que-e',
    heading: '1. O que é o Panzeri Run',
    paragraphs: ['Aplicativo de prescrição e acompanhamento de treinos de corrida, personalizado por metodologia técnica definida pelo treinador responsável (Elton Panzeri) e operacionalizado por agentes de inteligência artificial, sob supervisão técnica.'],
  },
  {
    id: 'natureza',
    heading: '2. Natureza do serviço',
    paragraphs: ['O acompanhamento é feito a distância, sem supervisão presencial ou em tempo real durante a execução dos treinos. O aluno é responsável por avaliar suas próprias condições físicas a cada sessão e por interromper a atividade e buscar atendimento médico diante de qualquer sinal de risco.'],
  },
  {
    id: 'medico',
    heading: '3. Não substitui avaliação médica',
    paragraphs: ['O Panzeri Run não presta serviço médico, fisioterapêutico ou de emergência. Recomenda-se avaliação médica prévia, especialmente para pessoas com condições de saúde preexistentes.'],
  },
  {
    id: 'assinatura',
    heading: '4. Assinatura e pagamento',
    paragraphs: ['O acesso ao programa de treinos depende de assinatura mensal ativa. Para novas assinaturas, o valor atual é de R$24,90/mês, processado pelo canal de pagamento escolhido. Condições anteriores já contratadas podem ser preservadas. O cancelamento pode ser feito a qualquer momento, sem multa, produzindo efeito conforme as regras vigentes de cobrança.'],
  },
  {
    id: 'informacoes',
    heading: '5. Responsabilidade sobre informações',
    paragraphs: ['O programa de treinos é construído com base nas informações fornecidas pelo aluno. Informações incompletas, desatualizadas ou incorretas podem comprometer a adequação e a segurança do treino prescrito.'],
  },
  {
    id: 'integracoes',
    heading: '6. Integrações com serviços externos',
    paragraphs: [
      '- Conectar um serviço externo (como Polar, Strava ou Wahoo) depende da sua autorização, que você pode retirar a qualquer momento.',
      '- O Panzeri Run usa os dados desses serviços como parte do acompanhamento e da personalização do seu treino, conforme a Política de Privacidade.',
      '- Dados vindos de dispositivos podem conter erros ou limitações, e a disponibilidade da integração pode depender do próprio serviço, que pode mudar ou ficar indisponível.',
      '- A integração com a Zepp/Amazfit (importar atividades e enviar treinos ao relógio) depende da disponibilidade e da compatibilidade dos serviços e dos aparelhos Zepp/Amazfit, que podem mudar, ficar indisponíveis ou não comportar todos os recursos de um treino. Cada autorização dessa integração é opcional e pode ser retirada a qualquer momento.',
      '- Desconectar a Polar ou a Wahoo não apaga automaticamente o histórico já importado; a exclusão desses dados é uma ação separada, descrita na Política de Privacidade. Desconectar o Strava apaga os dados do Strava guardados, e esses dados só aparecem para o próprio aluno.',
    ],
  },
  {
    id: 'atlas',
    heading: '7. Atlas e inteligência artificial',
    paragraphs: [
      'O Atlas é a inteligência artificial que apoia a prescrição e a análise do treinamento no Panzeri Run, sob supervisão técnica do treinador responsável.',
      'As recomendações e análises do Atlas têm limitações, podem conter erros e não substituem avaliação médica nem o seu julgamento sobre como você se sente a cada sessão. O uso dos seus dados da Zepp/Amazfit pelo Atlas depende de uma autorização específica, que você pode conceder ou não e retirar quando quiser.',
    ],
  },
  {
    id: 'idade',
    heading: '7A. Quem pode usar',
    paragraphs: ['O Panzeri Run é destinado a pessoas com 18 anos ou mais e não deve ser usado por menores de 18 anos. Mais detalhes na Política de Privacidade.'],
  },
  { id: 'alteracoes', heading: '8. Alterações', paragraphs: [`Estes termos podem ser atualizados; alterações relevantes serão comunicadas dentro do aplicativo. Versão de ${LEGAL_UPDATED_LABEL}.`] },
  { id: 'contato', heading: '9. Contato', paragraphs: [`Dúvidas: ${LEGAL_CONTACT}`] },
];

// ─── Resumo para a tela "Privacidade e dados" do app (mesmas frases dos documentos) ─────────────

export const LEGAL_SUMMARY = {
  version: LEGAL_VERSION,
  updatedLabel: LEGAL_UPDATED_LABEL,
  contact: LEGAL_CONTACT,
  links: LEGAL_PATHS,
  sections: [
    { id: 'dados', title: 'Seus dados', paragraphs: ['Estes são os tipos de dado que o Panzeri Run usa para personalizar e acompanhar seu treino:', ...DATA_CATEGORIES] },
    { id: 'integracoes', title: 'Dispositivos e integrações', paragraphs: [WEARABLE_INTRO, ...WEARABLE_FIELDS, ...RAW_AND_DERIVED, STRAVA_PARAGRAPH, WAHOO_PARAGRAPH] },
    { id: 'ia', title: 'Inteligência Artificial', paragraphs: AI_PARAGRAPHS },
    { id: 'zepp', title: 'Zepp/Amazfit', paragraphs: ZEPP_PARAGRAPHS },
    { id: 'atlas', title: 'Atlas e Anthropic', paragraphs: ATLAS_PARAGRAPHS },
    { id: 'gerenciar', title: 'Gerenciar dados da integração', paragraphs: [DISCONNECT_PARAGRAPH, ...DELETE_PARAGRAPHS, ...BACKUP_PARAGRAPHS.slice(1, 2)] },
    { id: 'terceiros', title: 'Terceiros e processamento', paragraphs: ['O Panzeri Run usa estes serviços externos, cada um para a finalidade indicada:', ...THIRD_PARTIES] },
    { id: 'solicitacoes', title: 'Solicitações sobre meus dados', paragraphs: REQUEST_PARAGRAPHS },
  ] as Array<{ id: string; title: string; paragraphs: string[] }>,
};

// ─── Renderizacao HTML (unica) ──────────────────────────────────────────────────────────────────

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function renderParagraphs(paragraphs: string[]): string {
  let html = '';
  let inList = false;
  for (const paragraph of paragraphs) {
    if (paragraph.startsWith('- ')) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${escapeHtml(paragraph.slice(2))}</li>`;
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<p>${escapeHtml(paragraph)}</p>`;
    }
  }
  if (inList) html += '</ul>';
  return html;
}

export function renderLegalPage(title: string, sections: LegalSection[]): string {
  const body = sections.map((section) => `<h2>${escapeHtml(section.heading)}</h2>${renderParagraphs(section.paragraphs)}`).join('');
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <title>Panzeri Run - ${escapeHtml(title)}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { background: #f8fafc; color: #0f172a; font-family: Arial, sans-serif; margin: 0; padding: 24px; line-height: 1.6; }
      main { background: #ffffff; border: 1px solid #dbe4ee; border-radius: 12px; margin: 24px auto; max-width: 640px; padding: 32px; }
      h1 { color: #0f766e; font-size: 22px; }
      h2 { color: #0f766e; font-size: 16px; margin-top: 24px; }
      p, li { color: #334155; font-size: 15px; }
    </style>
  </head>
  <body>
    <main><h1>${escapeHtml(title)} — Panzeri Run</h1>${body}</main>
  </body>
</html>`;
}

export const renderTermsPage = () => renderLegalPage('Termos de Uso', TERMS_SECTIONS);
export const renderPrivacyPage = () => renderLegalPage('Política de Privacidade', PRIVACY_SECTIONS);
