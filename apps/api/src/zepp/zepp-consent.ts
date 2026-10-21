import { ConsentCapability } from '../provider-hub/provider-connector';

// Textos de autorizacao Zepp/Amazfit — versao 2.0 (20/10/2026). Redacao-base de produto indicada por Elton em 20/10/2026, ajustada apenas para coerencia tecnica e juridica.
// ATENCAO: o documento COMPLETO (Politica de Privacidade e Termos) precisa de revisao por advogado; estes textos NAO substituem essa revisao. Qualquer alteracao de texto, grupos
// ou finalidades muda o hash e EXIGE nova versao: a conexao registra a versao/hash do documento da conexao e CADA finalidade com tela propria registra a versao/hash da tela dela.
// Mudanca material de uma finalidade => nova autorizacao daquela finalidade (a anterior deixa de valer, ver isPurposeCurrent).
//
// Tres telas, tres autorizacoes INDEPENDENTES (nenhuma caixa vem marcada; nenhuma e' presumida a partir da outra):
//  1. CONEXAO (este documento): importar as atividades dos grupos de dados que o aluno selecionar (+ historico de 30 dias, opcional).
//  2. ENVIO DE TREINOS AO RELOGIO (finalidade `watch_delivery`, tela propria): opcional, depois de conectar.
//  3. ANALISE COM O ATLAS / Anthropic (finalidade `ai_external`, tela propria): opcional, depois de conectar. Recusar nao impede conectar nem usar o que nao depende de IA externa.
//     O envio so' funciona quando o provedor estiver LIBERADO no servidor (trava de IA externa); ate la a tela existe, mas a autorizacao nao pode ser concedida.
//
// 2.1 (21/10/2026): voltam os grupos de SAUDE, agora implementados — "Sono e recuperacao" (evento de sono), "Saude diaria" (passos, distancia, calorias ativas e FC de repouso do evento
// diario) e "HRV" (evento de HRV). Cada um e' autorizacao propria e independente das atividades. Nenhuma caixa vem marcada; o app oferece o atalho "Marcar todos" (acao do aluno).
// O Atlas (tela v1.1) passa a citar sono, recuperacao e HRV; so' entra o que o aluno autorizou.
//
// Mudancas da 1.2 para a 2.0 (20/10/2026): textos novos; saiu o grupo "Sono e recuperacao" (nao implementado; nao se pede consentimento de um uso que nao existe); o grupo de
// atividades deixou de ser obrigatorio na conexao (o aluno escolhe); o historico passou a poder ser concedido tambem depois de conectar; `watch_delivery` e `ai_external`
// ganharam tela propria e nao podem mais ser marcadas na conexao.
export const ZEPP_CONSENT: ConsentCapability = {
  version: '2.1',
  dateLabel: '21/10/2026',
  title: 'Conecte seu Amazfit ao Panzeri Run',
  intro: 'Conecte sua conta Zepp ao Panzeri Run para acompanhar seus treinos em um só lugar.',
  sections: [
    {
      heading: null,
      paragraphs: [
        'Com sua autorização, poderemos receber informações das atividades registradas pelo seu Amazfit (como distância, duração, ritmo, frequência cardíaca, cadência, potência, elevação e percurso GPS), do seu sono e recuperação (etapas do sono, cochilos, pontuação de sono e variabilidade da frequência cardíaca, a HRV) e da sua saúde diária (passos, distância, calorias ativas e frequência cardíaca de repouso), conforme os dados disponíveis no dispositivo e as permissões concedidas.',
        'Essas informações serão utilizadas para acompanhar sua evolução, comparar os treinos planejados com os realizados, entender como você se recupera e personalizar seu treinamento. Elas não substituem avaliação médica.',
      ],
    },
    {
      heading: 'Você escolhe quais dados compartilhar',
      paragraphs: [
        'Marque abaixo apenas os grupos de dados que você quer compartilhar. O que você não marcar não será guardado nem utilizado. Nem todos os dados estarão sempre disponíveis: isso depende do seu relógio e das permissões da Zepp.',
        'O identificador da sua conta Zepp é necessário apenas para vincular a conexão.',
      ],
    },
    {
      heading: 'O que esta autorização não inclui',
      paragraphs: [
        'Esta autorização não inclui o envio de treinos ao seu relógio nem a análise dos seus dados por inteligência artificial. Cada uma tem sua própria autorização, opcional e separada, que você pode conceder ou não depois de conectar.',
      ],
    },
    {
      heading: 'Como seus dados são protegidos e como você controla',
      paragraphs: [
        'As credenciais de acesso à Zepp ficam guardadas de forma cifrada, e o Panzeri Run não pede a sua senha da Zepp. A origem de cada dado é preservada.',
        'Você pode consultar e retirar cada autorização quando quiser em Configurações → Integrações → Zepp/Amazfit → Privacidade e permissões, desconectar sua conta e pedir a exclusão dos dados importados. Os detalhes estão na Política de Privacidade.',
      ],
    },
  ],
  groups: [
    {
      id: 'account',
      label: 'Identificação da conta Zepp',
      description: 'Identificador da conta, necessário apenas para vincular a conexão. É o mínimo para a conexão existir.',
      required: true,
      categories: ['profile'],
    },
    {
      id: 'activity',
      label: 'Atividades',
      description: 'Data e horário, distância, duração, ritmo e calorias das corridas e caminhadas.',
      required: false,
      categories: ['activity'],
    },
    {
      id: 'sensors',
      label: 'Frequência cardíaca, cadência, potência e elevação',
      description: 'Informações registradas durante a atividade, quando o seu relógio as medir. Depende de “Atividades”.',
      required: false,
      categories: ['activity_sensors'],
      requires: ['activity'],
    },
    {
      id: 'route',
      label: 'Percurso GPS',
      description: 'Trajeto e localização da atividade, quando disponíveis. Depende de “Atividades”.',
      required: false,
      categories: ['activity_route'],
      requires: ['activity'],
    },
    {
      id: 'sleep',
      label: 'Sono e recuperação',
      description: 'Duração e etapas do sono (profundo, leve, REM e acordado), horários, cochilos e pontuação de sono, quando o seu relógio os medir.',
      required: false,
      categories: ['sleep'],
    },
    {
      id: 'daily',
      label: 'Saúde diária',
      description: 'Passos, distância e calorias ativas do dia e frequência cardíaca de repouso, quando o seu relógio os medir.',
      required: false,
      categories: ['daily_activity', 'resting_heart_rate'],
    },
    {
      id: 'hrv',
      label: 'Variabilidade da frequência cardíaca (HRV)',
      description: 'HRV medida pelo seu relógio (média da noite), quando disponível.',
      required: false,
      categories: ['hrv'],
    },
  ],
  // Finalidades OBRIGATORIAS descritas no texto da conexao. 'ai_external', 'ai_internal', 'watch_delivery' e qualquer outra NAO estao aqui => nao autorizadas por este consentimento.
  purposes: ['history', 'tracking', 'plan_comparison', 'indicators', 'coach_view'],
  optionalPurposes: [
    {
      id: 'history_backfill',
      label: 'Autorizo a importação das minhas atividades anteriores, limitada aos últimos 30 dias e ao período permitido pela Zepp.',
      description: 'Importa até 30 dias de atividades anteriores à conexão, dentro do que a Zepp permitir. Pode ser concedida na conexão ou depois, e retirada quando você quiser.',
      external: false,
      changeableAfterConnect: true,
    },
    {
      id: 'watch_delivery',
      label: 'Enviar meus treinos ao relógio',
      description: 'Permite que o Panzeri Run envie e atualize seus treinos de corrida na sua conta Zepp, para sincronização com o seu Amazfit. Autorização própria, separada da conexão.',
      external: false,
      changeableAfterConnect: true,
      screen: {
        version: '1.0',
        dateLabel: '20/10/2026',
        title: 'Receba seus treinos no relógio',
        paragraphs: [
          'O Panzeri Run pode enviar seus treinos de corrida para o aplicativo Zepp, permitindo sincronizá-los com um relógio Amazfit compatível.',
          'Assim, você poderá acompanhar no relógio as etapas do treino, como aquecimento, corrida, intervalos, recuperação e desaquecimento, conforme os recursos disponíveis no dispositivo.',
          'Quando seu treinador atualizar uma prescrição, o Panzeri Run poderá atualizar os treinos enviados à Zepp.',
          'O que é enviado é a descrição técnica do treino (nome, data, etapas, distâncias ou tempos e ritmos-alvo). Não enviamos seu nome, dados de saúde, relatos seus nem comentários do treinador. Você pode retirar esta autorização quando quiser, em Privacidade e permissões; ao retirar, o Panzeri Run deixa de enviar treinos e remove da sua conta Zepp os já enviados.',
          'Esta autorização é opcional, separada e não é presumida a partir da conexão com a Zepp.',
        ],
        checkboxText: 'Autorizo o Panzeri Run a enviar e atualizar meus treinos programados na minha conta Zepp para sincronização com meu Amazfit.',
        buttonLabel: 'Autorizar envio de treinos',
      },
    },
    {
      id: 'ai_external',
      label: 'Análise com o Atlas (inteligência artificial)',
      description: 'Permite usar seus dados Zepp/Amazfit autorizados em análises personalizadas com o Atlas, incluindo o envio dos dados necessários à Anthropic. Autorização própria, separada da conexão.',
      external: true,
      changeableAfterConnect: true,
      screen: {
        version: '1.1',
        dateLabel: '21/10/2026',
        title: 'Personalize seus treinos com o Atlas',
        paragraphs: [
          'O Atlas é a inteligência artificial utilizada pelo Panzeri Run para ajudar a analisar seu treinamento e orientar a personalização das próximas sessões.',
          'Com sua autorização, o Atlas poderá utilizar as informações que você autorizou compartilhar do seu Amazfit — treinos, sono, HRV, frequência cardíaca de repouso e saúde diária — para avaliar como você respondeu às sessões planejadas e como está se recuperando.',
          'Essa análise poderá considerar distância, ritmo, frequência cardíaca, cadência, potência, elevação, sono e sua evolução, HRV, frequência cardíaca de repouso, histórico de treinamento e outros indicadores disponíveis e autorizados. Só entram os grupos de dados que você autorizou na conexão; o que você não autorizou não é usado.',
          'Para realizar essas análises, o Panzeri Run poderá transmitir os dados necessários à Anthropic, empresa fornecedora da tecnologia de inteligência artificial utilizada pelo Atlas. Esse processamento poderá envolver transferência internacional de dados, conforme descrito na Política de Privacidade.',
          'Os resultados serão utilizados para apoiar o acompanhamento da sua evolução e as decisões de treinamento. As análises automatizadas podem apresentar limitações e não substituem avaliação médica.',
          'A recusa desta autorização não impede você de conectar o Amazfit nem de usar as funcionalidades que não dependam do processamento externo por inteligência artificial. Se você não autorizar, os dados Zepp não serão enviados à Anthropic, nem diretamente nem por meio de relatórios ou informações derivados deles.',
          'Você pode retirar esta autorização quando quiser, em Privacidade e permissões. Ao retirar, o envio futuro cessa e os resultados de IA já gerados com seus dados Zepp são invalidados ou atualizados, respeitadas as obrigações legais de conservação. O que já tiver sido enviado ao fornecedor não pode ser desfeito junto a ele.',
        ],
        checkboxText: 'Autorizo o Panzeri Run a utilizar meus dados Zepp/Amazfit autorizados para análises personalizadas com o Atlas, incluindo o envio dos dados necessários à Anthropic para processamento por inteligência artificial, conforme a Política de Privacidade.',
        buttonLabel: 'Autorizar análise com Atlas',
      },
    },
  ],
  acknowledgementText: 'Autorizo o Panzeri Run a acessar e utilizar os dados que eu selecionar na conexão com a Zepp, para acompanhamento e gestão do meu treinamento e da minha recuperação.',
  confirmButtonLabel: 'Conectar minha conta Zepp',
};
