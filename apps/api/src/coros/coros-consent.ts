import { ConsentCapability } from '../provider-hub/provider-connector';

// Textos de autorizacao COROS — versao 1.0 (30/10/2026). Mesmo desenho da Zepp 2.x: TRES autorizacoes INDEPENDENTES (nenhuma caixa vem marcada; nenhuma e' presumida a partir da outra):
//  1. CONEXAO (este documento): importar as atividades dos grupos de dados que a aluna selecionar (+ historico de 30 dias, opcional).
//  2. ENVIO DE TREINOS AO RELOGIO (finalidade `watch_delivery`, tela propria): opcional, depois de conectar.
//  3. ANALISE COM O ATLAS / Anthropic (finalidade `ai_external`, tela propria): opcional. Liberada por Elton em 30/10/2026; o envio so' acontece com a autorizacao propria da aluna E com a
//     segunda trava do servidor ligada (COROS_EXTERNAL_AI_ENABLED=true). Recusar nao impede conectar nem usar o que nao depende de IA externa.
// So' ha grupos do que esta IMPLEMENTADO: atividades, sensores e percurso (arquivo FIT da atividade). Sono, HRV, frequencia cardiaca de repouso e saude diaria da COROS ainda NAO sao
// importados e por isso NAO sao pedidos aqui (nao se pede consentimento de um uso que nao existe); quando forem, entram numa versao nova com nova autorizacao.
// ATENCAO: o texto completo (Politica de Privacidade e Termos) precisa de revisao por advogado. Qualquer alteracao de texto, grupos ou finalidades muda o hash e EXIGE nova versao.
export const COROS_CONSENT: ConsentCapability = {
  version: '1.0',
  dateLabel: '30/10/2026',
  title: 'Conecte sua COROS ao Panzeri Run',
  intro: 'Conecte sua conta COROS ao Panzeri Run para acompanhar seus treinos em um só lugar.',
  sections: [
    {
      heading: null,
      paragraphs: [
        'Com sua autorização, poderemos receber as atividades registradas pelo seu relógio COROS (como distância, duração, ritmo, frequência cardíaca, cadência, potência, elevação e percurso GPS), conforme os grupos de dados que você escolher abaixo.',
        'Essas informações serão utilizadas para acompanhar sua evolução, comparar os treinos planejados com os realizados e personalizar seu treinamento. Elas não substituem avaliação médica.',
      ],
    },
    {
      heading: 'Você escolhe quais dados compartilhar',
      paragraphs: [
        'Marque abaixo apenas os grupos de dados que você quer compartilhar. O que você não marcar não será guardado nem utilizado. Nem todos os dados estarão sempre disponíveis: isso depende do seu relógio e de a atividade já ter sido enviada do relógio para o aplicativo da COROS.',
        'A COROS limita o download do arquivo de cada atividade a 50 por dia; se esse limite for atingido, as atividades restantes são importadas no dia seguinte.',
        'O identificador da sua conta COROS é necessário apenas para vincular a conexão.',
      ],
    },
    {
      heading: 'O que esta autorização não inclui',
      paragraphs: [
        'Esta autorização não inclui o envio de treinos ao seu relógio nem a análise dos seus dados por inteligência artificial. Cada uma tem a sua própria autorização, opcional e separada, que você pode conceder ou não depois de conectar. Dados de sono, variabilidade da frequência cardíaca e saúde diária da COROS ainda não são importados pelo Panzeri Run.',
      ],
    },
    {
      heading: 'Como seus dados são protegidos e como você controla',
      paragraphs: [
        'As credenciais de acesso à COROS ficam guardadas de forma cifrada, e o Panzeri Run não pede a sua senha da COROS (você entra na página da própria COROS). A origem de cada dado é preservada.',
        'Você pode consultar e retirar cada autorização quando quiser, desconectar sua conta e pedir a exclusão dos dados importados. Os detalhes estão na Política de Privacidade.',
      ],
    },
  ],
  groups: [
    { id: 'account', label: 'Identificação da conta COROS', description: 'Identificador da conta, necessário apenas para vincular a conexão. É o mínimo para a conexão existir.', required: true, categories: ['profile'] },
    { id: 'activity', label: 'Atividades', description: 'Data e horário, distância, duração, ritmo e calorias das corridas e caminhadas.', required: false, categories: ['activity'] },
    { id: 'sensors', label: 'Frequência cardíaca, cadência, potência e elevação', description: 'Informações registradas durante a atividade, quando o seu relógio as medir. Depende de “Atividades”.', required: false, categories: ['activity_sensors'], requires: ['activity'] },
    { id: 'route', label: 'Percurso GPS', description: 'Trajeto e localização da atividade, quando disponíveis. Depende de “Atividades”.', required: false, categories: ['activity_route'], requires: ['activity'] },
  ],
  // Finalidades OBRIGATORIAS descritas no texto da conexao. 'ai_external', 'ai_internal', 'watch_delivery' e qualquer outra NAO estao aqui => nao autorizadas por este consentimento.
  purposes: ['history', 'tracking', 'plan_comparison', 'indicators', 'coach_view'],
  optionalPurposes: [
    {
      id: 'history_backfill',
      label: 'Autorizo a importação das minhas atividades anteriores, limitada aos últimos 30 dias.',
      description: 'Importa até 30 dias de atividades anteriores à conexão, respeitando o limite diário de arquivos da COROS. Pode ser concedida na conexão ou depois, e retirada quando você quiser.',
      external: false,
      changeableAfterConnect: true,
    },
    {
      id: 'watch_delivery',
      label: 'Enviar meus treinos ao relógio',
      description: 'Permite que o Panzeri Run crie e atualize seus treinos de corrida no seu calendário da COROS, para sincronização com o seu relógio. Autorização própria, separada da conexão.',
      external: false,
      changeableAfterConnect: true,
      screen: {
        version: '1.0',
        dateLabel: '30/10/2026',
        title: 'Receba seus treinos no relógio COROS',
        paragraphs: [
          'O Panzeri Run pode enviar seus treinos de corrida para o seu calendário de treinos da COROS, para você sincronizá-los com o relógio COROS e acompanhar no relógio as etapas do treino, como corrida, intervalos e recuperação, conforme os recursos do seu modelo.',
          'Quando seu treinador atualizar uma prescrição, o Panzeri Run poderá atualizar os treinos que já enviou.',
          'O que é enviado é a descrição técnica do treino: nome (tipo, distância e data), etapas, distâncias ou tempos e ritmos-alvo. Não enviamos seu nome, dados de saúde, relatos seus nem comentários do treinador.',
          'Importante: a COROS não permite que o Panzeri Run apague ou mude de dia um treino já enviado. Se você retirar esta autorização, desconectar sua conta ou o treino mudar de dia no programa, o Panzeri Run para de enviar e os treinos que já estiverem no seu calendário da COROS permanecem lá; você pode apagá-los no aplicativo da COROS.',
          'Esta autorização é opcional, separada e não é presumida a partir da conexão com a COROS.',
        ],
        checkboxText: 'Autorizo o Panzeri Run a criar e atualizar meus treinos programados no meu calendário da COROS, para sincronização com meu relógio.',
        buttonLabel: 'Autorizar envio de treinos',
      },
    },
    {
      id: 'ai_external',
      label: 'Análise com o Atlas (inteligência artificial)',
      description: 'Permite usar seus dados COROS autorizados em análises personalizadas com o Atlas, incluindo o envio dos dados necessários à Anthropic. Autorização própria, separada da conexão.',
      external: true,
      changeableAfterConnect: true,
      screen: {
        version: '1.0',
        dateLabel: '30/10/2026',
        title: 'Personalize seus treinos com o Atlas',
        paragraphs: [
          'O Atlas é a inteligência artificial utilizada pelo Panzeri Run para ajudar a analisar seu treinamento e orientar a personalização das próximas sessões.',
          'Com sua autorização, o Atlas poderá utilizar as informações que você autorizou compartilhar da sua COROS — treinos e as medidas dos grupos autorizados — para avaliar como você respondeu às sessões. Para isso, o Panzeri Run poderá transmitir os dados necessários à Anthropic, empresa fornecedora da tecnologia de inteligência artificial usada pelo Atlas, o que pode envolver transferência internacional de dados.',
          'A recusa desta autorização não impede você de conectar a COROS nem de usar as funcionalidades que não dependam do processamento externo por inteligência artificial. Se você não autorizar, os dados COROS não serão enviados à inteligência artificial.',
          'Você pode retirar esta autorização quando quiser, em Privacidade e permissões. Ao retirar, o envio futuro cessa e os resultados de inteligência artificial já gerados com seus dados COROS são invalidados ou atualizados.',
          'As análises automatizadas podem apresentar limitações e não substituem avaliação médica.',
        ],
        checkboxText: 'Autorizo o Panzeri Run a utilizar meus dados COROS autorizados para análises personalizadas com o Atlas, incluindo o envio dos dados necessários à Anthropic para processamento por inteligência artificial.',
        buttonLabel: 'Autorizar análise com Atlas',
      },
    },
  ],
  acknowledgementText: 'Autorizo o Panzeri Run a acessar e utilizar os dados que eu selecionar na conexão com a COROS, para acompanhamento e gestão do meu treinamento.',
  confirmButtonLabel: 'Conectar minha conta COROS',
};
