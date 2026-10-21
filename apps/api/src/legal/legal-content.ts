// FONTE CANONICA dos Termos de Uso e da Politica de Privacidade (05/10/2026).
// Tudo que e' publico (paginas HTML) e tudo que o app mostra na tela "Privacidade e dados" sai DAQUI —
// nenhum outro lugar tem copia do texto. As URLs /termos-de-uso e /politica-privacidade sao as
// canonicas (usadas pelo cadastro no app e pelas lojas); /legal/terms e /legal/privacy apenas
// redirecionam para elas.
//
// Regra editorial: o texto descreve o que o sistema FAZ (conferido no codigo). Nao afirma conformidade
// legal, nao inventa prazo, base legal nem garantia de fornecedor. O que depende de contrato ou de
// configuracao externa e' dito como tal.

export const LEGAL_VERSION = '2026-10-21';
export const LEGAL_UPDATED_LABEL = '21 de outubro de 2026';
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
];

export const WEARABLE_INTRO =
  'Você pode autorizar serviços externos compatíveis a compartilhar suas atividades com o Panzeri Run. Hoje o aplicativo oferece conexão com a Polar, com o Strava e com a Wahoo e, conforme o aparelho, com o Apple Saúde (iPhone) e o Health Connect (Android). Em validação, há também a conexão com a Zepp/Amazfit (seção 5A). Outros serviços poderão ser adicionados e, nesse caso, esta política será atualizada.';

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
  'A Zepp (Zepp Health) é o serviço dos relógios Amazfit, que você pode conectar ao Panzeri Run por escolha sua. A conexão está em validação e é opcional. Existem quatro autorizações separadas, cada uma com texto próprio, que você concede ou não de forma independente — nenhuma vem marcada e nenhuma é presumida a partir de outra: (1) importar as atividades dos grupos de dados que você selecionar; (2) importar até 30 dias de atividades anteriores à conexão; (3) enviar seus treinos de corrida ao relógio; (4) usar seus dados Zepp/Amazfit em análises personalizadas com o Atlas, o que inclui enviar os dados necessários à Anthropic (seção 7A).',
  'Dados que recebemos da Zepp, conforme os grupos que você autorizar e o que o seu relógio medir: o identificador da conta Zepp (apenas para vincular a conexão); atividades (data e horário, distância, duração, ritmo, calorias, modalidade e o nome do dispositivo); frequência cardíaca, cadência, potência e elevação registradas durante a atividade; e o percurso GPS. Recebemos esses dados do arquivo de cada atividade que a Zepp envia ao Panzeri Run. Atividades digitadas manualmente na Zepp não são importadas.',
  'O arquivo original da atividade não é guardado: lemos o arquivo na hora, guardamos apenas os dados extraídos dos grupos que você autorizou e descartamos o restante. Os dados de sensores só são guardados se você autorizar esse grupo; o percurso GPS (coordenadas) só é guardado se você autorizar o grupo de percurso, e fica associado à atividade.',
  'Dados que enviamos à Zepp: somente se você autorizar o envio de treinos ao relógio, o Panzeri Run envia à sua conta Zepp os treinos de corrida programados para os próximos dias — nome do treino, data, etapas (distância ou tempo) e ritmos-alvo. Não enviamos seu nome, dados de saúde, relatos seus nem comentários do treinador. A Zepp mantém e sincroniza esses treinos com o relógio conforme as próprias regras (uma janela de sete dias). Se você retirar a autorização ou desconectar a conta, o Panzeri Run deixa de enviar treinos e os treinos já enviados deixam de existir na sua conta Zepp.',
  'Como usamos esses dados: para mostrar suas atividades, comparar o que foi prescrito com o que foi realizado, acompanhar sua evolução, manter seu histórico, personalizar seu treinamento e permitir que seu treinador acompanhe seu treino. Os dados recebidos da Zepp e de outros serviços ficam separados por origem, e a origem de cada dado é preservada.',
  'Seu controle: em Configurações → Integrações → Zepp/Amazfit → Privacidade e permissões você vê o estado de cada autorização e pode retirar qualquer uma quando quiser, desconectar a conta e pedir a exclusão dos dados da Zepp. Registramos cada decisão sua — qual autorização, a versão do texto, a data e se foi concedida ou retirada. Se o texto de uma autorização mudar de forma relevante, pedimos uma nova autorização; enquanto você não a conceder, ela não vale.',
  'Ao retirar a importação, a coleta de novos dados daquele grupo é interrompida na hora; os dados já importados permanecem até você pedir a exclusão deles. Ao retirar a autorização do Atlas, o uso futuro cessa e os resultados de inteligência artificial já gerados com seus dados Zepp são invalidados ou atualizados, respeitadas as obrigações legais de conservação.',
  'Desconectar a conta Zepp interrompe novas importações e envios, revoga a autorização na Zepp (o que remove da sua conta Zepp os treinos que o Panzeri Run havia enviado) e invalida os resultados de IA derivados desses dados; não apaga automaticamente o que já foi importado. A exclusão dos dados da Zepp é uma ação separada: apaga o registro recebido, a atividade, as amostras e séries (incluindo o percurso GPS), os vínculos com os treinos, o registro dos treinos enviados e os indicadores e relatórios derivados. Permanecem as informações que você mesmo forneceu (como esforço percebido, dor e observações), os registros de pagamento e de auditoria sem identificação direta, o registro mínimo e criptografado da exclusão, mantido por 1 ano, e as cópias de segurança (seção 10).',
  'Retenção: hoje não há exclusão automática por prazo para os dados da Zepp. Eles ficam guardados enquanto a conexão estiver ativa e até você pedir a exclusão ou excluir a conta. Não definimos um prazo adicional de retenção; se isso mudar, esta política será atualizada.',
];

export const ATLAS_PARAGRAPHS = [
  'O Atlas é o nome da inteligência artificial usada pelo Panzeri Run para apoiar a prescrição e a análise do seu treinamento (seção 7). A tecnologia é fornecida pela Anthropic.',
  'Dados da Zepp/Amazfit só entram nas análises do Atlas se você conceder a autorização específica, separada e opcional do Atlas. Sem essa autorização, os dados Zepp não são enviados à Anthropic — nem diretamente nem por meio de relatórios ou informações derivados deles. Recusar não impede conectar o Amazfit, enviar treinos ao relógio nem usar as funções que não dependam desse processamento.',
  'Com a autorização, o Panzeri Run envia à Anthropic os dados necessários à análise, sob a forma de resumos e indicadores derivados das suas atividades (como distância, ritmo, frequência cardíaca, cadência, potência, elevação e histórico), apenas nos grupos que você autorizou. O arquivo original, as séries completas de amostras e as coordenadas do percurso não fazem parte do que o Panzeri Run envia à IA.',
  'As análises automatizadas podem apresentar limitações e erros, o acompanhamento é feito sob supervisão técnica do treinador e elas não substituem avaliação médica.',
  'A Anthropic é uma empresa estrangeira, e esse envio configura transferência internacional de dados. As regras da Anthropic sobre guardar essas informações ou usá-las para treinar modelos dependem dos termos do próprio fornecedor, e o Panzeri Run não as afirma por ele.',
];

export const AI_PARAGRAPHS = [
  'O Panzeri Run usa serviços de inteligência artificial em funções do produto, como montar e ajustar o programa de treino, analisar a evolução, interpretar relatos escritos e apoiar o acompanhamento feito pelo treinador. O fornecedor utilizado hoje é a Anthropic.',
  'Para cada uma dessas funções, o Panzeri Run envia ao fornecedor, no momento da solicitação, as informações necessárias àquela função, como dados do seu perfil e da entrevista, sua rotina, seus feedbacks e relatos, e seu histórico e métricas de treino. Quando você conecta a Polar ou a Wahoo, resumos derivados das suas atividades (como volume, distância e ritmo) podem fazer parte desse contexto; dados do Strava nunca fazem. O conteúdo bruto recebido desses serviços (registros completos, séries de amostras e rotas) não faz parte do que o Panzeri Run envia à IA.',
  'Este texto descreve o que o Panzeri Run envia. As regras do fornecedor sobre guardar essas informações ou usá-las para treinar modelos dependem dos termos do próprio fornecedor, e o Panzeri Run não as afirma por ele.',
];

export const DISCONNECT_PARAGRAPH =
  'Desconectar a Polar ou a Wahoo interrompe novas sincronizações e retira a autorização guardada no Panzeri Run (na Wahoo, a autorização também é revogada na própria Wahoo), mas não apaga automaticamente o histórico já importado. No Strava, desconectar também apaga os dados do Strava guardados.';

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
    id: 'quem-somos',
    heading: '1. Quem é o responsável',
    paragraphs: [
      'Elton Panzeri é o responsável pelo Panzeri Run e o controlador dos dados pessoais tratados pelo aplicativo (versões para iPhone, Android e navegador).',
      `Contato para qualquer assunto de privacidade: ${LEGAL_CONTACT}.`,
    ],
  },
  { id: 'dados', heading: '2. Dados que tratamos', paragraphs: ['Dados fornecidos por você ou gerados pelo uso do aplicativo:', ...DATA_CATEGORIES, 'Dados de pagamento são processados pelo Asaas ou pela loja de aplicativos; não armazenamos dados de cartão.'] },
  {
    id: 'apple-saude',
    heading: '3. Apple Saúde (HealthKit) — iPhone',
    paragraphs: [
      'Esta seção vale somente para o aplicativo do Panzeri Run instalado no iPhone. Ela não se aplica ao uso pelo navegador nem ao aplicativo Android.',
      'Permissão: o Panzeri Run só acessa o app Saúde se você autorizar, na janela de permissão do próprio iOS. Pedimos apenas permissão de leitura. Não pedimos permissão para gravar e não gravamos nenhum dado no app Saúde. Você pode retirar a autorização a qualquer momento em Ajustes do iPhone > Saúde > Acesso a dados e dispositivos > Panzeri Run.',
      'O que lemos: seus treinos de corrida registrados no app Saúde (até os 20 mais recentes de cada leitura) e, de cada um, a distância percorrida. Dos treinos recebemos: identificador do treino, tipo de atividade, início, fim, duração, distância, se foi em ambiente fechado, fuso horário e o nome do aplicativo e do dispositivo que registraram o treino. Não lemos frequência cardíaca, rota (GPS), sono, passos, calorias, peso, nutrição nem outros dados do app Saúde.',
      'Quando os dados saem do seu aparelho: a leitura acontece no próprio iPhone. Os treinos só são enviados ao Panzeri Run quando você aciona a importação, na área Dispositivos e integrações do aplicativo. Não há envio automático em segundo plano.',
      'Como usamos: os treinos importados são tratados como as atividades vindas de outros serviços conectados, descritas na seção 5: para mostrar a atividade, comparar o que foi prescrito com o que foi realizado, acompanhar sua evolução e personalizar seu treinamento. Resumos derivados dessas atividades podem fazer parte do contexto enviado à inteligência artificial, conforme a seção 7.',
      'O que não fazemos: não usamos dados do Apple Saúde para publicidade ou marketing, não os enviamos à Meta e não os compartilhamos para fins de propaganda.',
      'Apagar: não há, hoje, um botão no aplicativo para apagar somente os dados importados do Apple Saúde. Você pode pedir a exclusão deles pelo contato indicado na seção 13 ou excluir a conta inteira, no próprio aplicativo, como descrito na seção 13.',
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
      'Health Connect (aplicativo Android): se você autorizar, o Panzeri Run lê do Health Connect as sessões de exercício, a distância e a frequência cardíaca durante cada sessão (somente leitura). De cada sessão recebemos: tipo de atividade, início, fim e duração, distância, frequência cardíaca média e máxima daquele treino, o aplicativo que gravou o registro, o dispositivo (quando o aplicativo informa) e o método de gravação. Não lemos rota (GPS), sono, passos isolados, calorias, peso nem nutrição, e não gravamos nada no Health Connect. O Panzeri Run sincroniza ao abrir o aplicativo e quando você toca em "Sincronizar agora"; não sincroniza continuamente em segundo plano. Ao desconectar, novas leituras são interrompidas, mas o histórico já importado não é apagado automaticamente. Você também pode revogar as permissões nos ajustes do Android.',
      'Polar, Strava e Wahoo: você pode autorizar esses serviços a compartilhar suas atividades com o Panzeri Run. Dependendo do serviço e das permissões concedidas, podem ser recebidos data e horário, duração, distância, modalidade, ritmo, frequência cardíaca, cadência, potência, elevação, calorias, amostras ao longo da atividade (como frequência cardíaca e velocidade); o Panzeri Run não armazena coordenadas nem trajetos GPS desses serviços. Nem todo serviço fornece todos esses dados, e dados vindos de dispositivos podem conter erros ou limitações.',
      ...RAW_AND_DERIVED,
      STRAVA_PARAGRAPH,
      WAHOO_PARAGRAPH,
    ],
  },
  { id: 'zepp-amazfit', heading: '5A. Zepp/Amazfit: importar atividades e enviar treinos ao relógio', paragraphs: ZEPP_PARAGRAPHS },
  {
    id: 'finalidades',
    heading: '6. Para que usamos',
    paragraphs: ['Personalizar a prescrição de treinos; acompanhar evolução e segurança do aluno; processar pagamento da assinatura; comunicação sobre o serviço (e-mail, notificações).'],
  },
  { id: 'ia', heading: '7. Inteligência artificial', paragraphs: AI_PARAGRAPHS },
  { id: 'atlas', heading: '7A. Atlas e a Anthropic com dados da Zepp/Amazfit', paragraphs: ATLAS_PARAGRAPHS },
  { id: 'terceiros', heading: '8. Compartilhamento e serviços de terceiros', paragraphs: ['O Panzeri Run usa os seguintes serviços externos, cada um para a finalidade indicada:', ...THIRD_PARTIES] },
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
      'A Lei Geral de Proteção de Dados (LGPD) garante a você, entre outros direitos: confirmar que tratamos seus dados; acessar e corrigir seus dados; pedir a anonimização, o bloqueio ou a eliminação de dados desnecessários, excessivos ou tratados em desconformidade; pedir a portabilidade; pedir a eliminação dos dados tratados com base no seu consentimento; saber com quem compartilhamos seus dados; saber que pode não dar o consentimento e quais as consequências; e revogar o consentimento a qualquer momento.',
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
    paragraphs: [`Esta é a versão de ${LEGAL_UPDATED_LABEL}. Alterações relevantes serão comunicadas dentro do aplicativo.`],
  },
  { id: 'contato', heading: '15. Contato', paragraphs: [LEGAL_CONTACT] },
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
