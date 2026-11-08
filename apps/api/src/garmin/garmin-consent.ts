import { ConsentCapability } from '../provider-hub/provider-connector';

// Textos de autorizacao Garmin — versao 1.0 (08/11/2026). Mesmo desenho da COROS/Zepp: TRES autorizacoes INDEPENDENTES (nenhuma caixa vem marcada; nenhuma e' presumida a partir da outra):
//  1. CONEXAO (este documento): importar atividades e os grupos de saude que a aluna selecionar.
//  2. ENVIO DE TREINOS AO RELOGIO (finalidade `watch_delivery`, tela propria): opcional, depois de conectar.
//  3. ANALISE COM O ATLAS / Anthropic (finalidade `ai_external`, tela propria): opcional. Regra da Garmin (declarada na Politica, secao 5D): dados Garmin e derivados NUNCA treinam, avaliam ou
//     melhoram modelos de IA; so' resumos, so' com esta autorizacao separada e retiravel.
// Coerencia com a Politica de Privacidade (5D): NAO ha' grupo de percurso GPS e NAO ha' dados de saude da mulher (ciclo). O Starter nao traz historico: nao existe "importar atividades anteriores".
// ATENCAO: o texto do envio de treinos foi escrito ANTES de ler a Training API (lote 3) e pode precisar de ajuste (ex.: se a Garmin permite ou nao apagar/atualizar o que foi enviado). Ajustar
// ANTES de qualquer aluna conectar nao exige nova versao; depois disso, qualquer mudanca muda o hash e EXIGE nova versao.
export const GARMIN_CONSENT: ConsentCapability = {
  version: '1.0',
  dateLabel: '08/11/2026',
  title: 'Conecte sua Garmin ao Panzeri Run',
  intro: 'Conecte sua conta Garmin ao Panzeri Run para acompanhar seus treinos e sua recuperação em um só lugar.',
  sections: [
    {
      heading: null,
      paragraphs: [
        'Com sua autorização, poderemos receber as atividades registradas pelo seu relógio Garmin (como distância, duração, ritmo, frequência cardíaca, cadência, potência e elevação) e, se você marcar, dados de saúde e bem-estar (como sono, frequência cardíaca de repouso, variabilidade da frequência cardíaca, estresse, Body Battery, passos e atividade do dia).',
        'Essas informações serão utilizadas para acompanhar sua evolução e sua recuperação, comparar os treinos planejados com os realizados e personalizar seu treinamento. Seu treinador vê no painel os dados que você autorizou. Elas não substituem avaliação médica.',
      ],
    },
    {
      heading: 'Você escolhe quais dados compartilhar',
      paragraphs: [
        'Marque abaixo apenas os grupos de dados que você quer compartilhar. O que você não marcar não será guardado nem utilizado. Na página da Garmin você também controla o que ela compartilha conosco. Nem todos os dados estarão sempre disponíveis: isso depende do seu relógio e do que a Garmin disponibilizar.',
        'Os dados chegam a partir da conexão: a Garmin não envia o histórico de atividades anteriores a ela. O Panzeri Run não guarda coordenadas nem trajetos GPS da Garmin e não recebe dados de saúde da mulher (como o ciclo menstrual).',
        'O identificador da sua conta Garmin é necessário apenas para vincular a conexão.',
      ],
    },
    {
      heading: 'O que esta autorização não inclui',
      paragraphs: [
        'Esta autorização não inclui o envio de treinos ao seu relógio nem a análise dos seus dados por inteligência artificial. Cada uma tem a sua própria autorização, opcional e separada, que você pode conceder ou não depois de conectar.',
      ],
    },
    {
      heading: 'Como seus dados são protegidos e como você controla',
      paragraphs: [
        'As credenciais de acesso à Garmin ficam guardadas de forma cifrada, e o Panzeri Run não pede a sua senha da Garmin (você entra na página da própria Garmin). A origem de cada dado é preservada. Os dados da Garmin não são vendidos nem usados para publicidade.',
        'Você pode consultar e retirar cada autorização quando quiser, desconectar sua conta e pedir a exclusão dos dados importados; ao desconectar, avisamos a Garmin para encerrar o compartilhamento. Para receber uma cópia dos seus dados da Garmin, peça por e-mail. Os detalhes estão na Política de Privacidade.',
      ],
    },
  ],
  groups: [
    { id: 'account', label: 'Identificação da conta Garmin', description: 'Identificador da conta, necessário apenas para vincular a conexão. É o mínimo para a conexão existir.', required: true, categories: ['profile'] },
    { id: 'activity', label: 'Atividades', description: 'Data e horário, tipo, distância, duração, ritmo e calorias das corridas e demais atividades.', required: false, categories: ['activity'] },
    { id: 'sensors', label: 'Frequência cardíaca, cadência, potência e elevação', description: 'Informações registradas durante a atividade, quando o seu relógio as medir. Depende de “Atividades”.', required: false, categories: ['activity_sensors'], requires: ['activity'] },
    { id: 'sleep', label: 'Sono e recuperação', description: 'Duração e etapas do sono, horários e pontuação de sono, quando o seu relógio os medir.', required: false, categories: ['sleep'] },
    { id: 'daily', label: 'Saúde diária', description: 'Passos, distância e atividade do dia e frequência cardíaca de repouso, quando o seu relógio os medir.', required: false, categories: ['daily_activity', 'resting_heart_rate'] },
    { id: 'hrv', label: 'Variabilidade da frequência cardíaca (HRV)', description: 'HRV, quando o seu relógio a medir.', required: false, categories: ['hrv'] },
    { id: 'stress', label: 'Estresse e Body Battery', description: 'Níveis de estresse e de energia (Body Battery) ao longo do dia, quando o seu relógio os medir.', required: false, categories: ['lifestyle_load'] },
  ],
  // Finalidades OBRIGATORIAS descritas no texto da conexao. 'ai_external', 'ai_internal', 'watch_delivery' e qualquer outra NAO estao aqui => nao autorizadas por este consentimento.
  purposes: ['history', 'tracking', 'plan_comparison', 'indicators', 'coach_view'],
  optionalPurposes: [
    {
      id: 'watch_delivery',
      label: 'Enviar meus treinos ao relógio',
      description: 'Permite que o Panzeri Run envie seus treinos de corrida programados à sua conta Garmin, para sincronização com o seu relógio. Autorização própria, separada da conexão.',
      external: false,
      changeableAfterConnect: true,
      screen: {
        version: '1.0',
        dateLabel: '08/11/2026',
        title: 'Receba seus treinos no relógio Garmin',
        paragraphs: [
          'O Panzeri Run pode enviar seus treinos de corrida programados para a sua conta Garmin, para você sincronizá-los com o relógio Garmin e acompanhar no relógio as etapas do treino, como corrida, intervalos e recuperação, conforme os recursos do seu modelo.',
          'O que é enviado é a descrição técnica do treino: nome, data, etapas (distância ou tempo) e ritmos-alvo. Não enviamos seu nome, dados de saúde, relatos seus nem comentários do treinador.',
          'Esta autorização é opcional, separada e não é presumida a partir da conexão com a Garmin. Você pode retirá-la quando quiser, e o Panzeri Run para de enviar.',
        ],
        checkboxText: 'Autorizo o Panzeri Run a enviar meus treinos programados à minha conta Garmin, para sincronização com meu relógio.',
        buttonLabel: 'Autorizar envio de treinos',
      },
    },
    {
      id: 'ai_external',
      label: 'Análise com o Atlas (inteligência artificial)',
      description: 'Permite usar seus dados Garmin autorizados em análises personalizadas com o Atlas, incluindo o envio de resumos à Anthropic. Autorização própria, separada da conexão.',
      external: true,
      changeableAfterConnect: true,
      screen: {
        version: '1.0',
        dateLabel: '08/11/2026',
        title: 'Personalize seus treinos com o Atlas',
        paragraphs: [
          'O Atlas é a inteligência artificial utilizada pelo Panzeri Run para ajudar a analisar seu treinamento e orientar a personalização das próximas sessões.',
          'Com sua autorização, o Atlas poderá utilizar resumos e indicadores derivados das informações que você autorizou compartilhar da sua Garmin — treinos e as medidas dos grupos autorizados — para avaliar como você respondeu às sessões e gerar a análise ou a recomendação de treino que você pediu. Para isso, o Panzeri Run poderá transmitir esses resumos à Anthropic, empresa fornecedora da tecnologia de inteligência artificial usada pelo Atlas, o que envolve transferência internacional de dados.',
          'O Panzeri Run não usa dados da Garmin, nem informações derivadas deles, para treinar, avaliar ou melhorar modelos de inteligência artificial.',
          'A recusa desta autorização não impede você de conectar a Garmin nem de usar as funcionalidades que não dependam desse processamento. Se você não autorizar, os dados Garmin não serão enviados à inteligência artificial.',
          'Você pode retirar esta autorização quando quiser, em Privacidade e permissões. Ao retirar, o envio futuro cessa e os resultados de inteligência artificial já gerados com seus dados Garmin são invalidados ou atualizados.',
          'As análises automatizadas podem apresentar limitações e não substituem avaliação médica.',
        ],
        checkboxText: 'Autorizo o Panzeri Run a utilizar meus dados Garmin autorizados para análises personalizadas com o Atlas, incluindo o envio de resumos à Anthropic para processamento por inteligência artificial.',
        buttonLabel: 'Autorizar análise com Atlas',
      },
    },
  ],
  acknowledgementText: 'Autorizo o Panzeri Run a acessar e utilizar os dados que eu selecionar na conexão com a Garmin, para acompanhamento e gestão do meu treinamento.',
  confirmButtonLabel: 'Conectar minha conta Garmin',
};
