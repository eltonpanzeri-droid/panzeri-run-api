import { ConsentCapability } from '../provider-hub/provider-connector';

// Autorizacoes do Health Connect (Android) — versao 1.0 (22/10/2026). Mesmo modelo da Zepp (grupos independentes, nada marcado, Atlas separado), adaptado a uma conexao que e' do APARELHO
// (o Health Connect nao tem OAuth nem conta externa): o servidor guarda so' o consentimento do aluno, por categoria, e o app so' le/envia o que ele autorizou.
// ATENCAO: o documento COMPLETO (Politica de Privacidade e Termos) precisa de revisao por advogado; estes textos NAO substituem essa revisao. Qualquer alteracao de texto, grupo ou finalidade
// muda o hash e EXIGE nova versao (a autorizacao anterior deixa de valer ate o aluno confirmar de novo).
//
// Decisao de produto (Elton, 22/10/2026): perguntar TODAS as categorias ja', mesmo as que o aplicativo ainda nao le ou que o Google/Samsung ainda nao liberaram — quando a leitura for liberada,
// a autorizacao ja' estara dada. Por isso os textos dizem "quando o seu relogio ou aplicativo disponibilizar" e nunca afirmam que o dado ja' esta sendo recebido. O pedido de permissao ao
// ANDROID so' inclui as categorias que o app declara (ver HC_PERMISSION_BY_CATEGORY no app e o formulario da Play Console).
export const HEALTH_CONNECT_PROVIDER_ID = 'health_connect';

export const HEALTH_CONNECT_CONSENT: ConsentCapability = {
  version: '1.2',
  dateLabel: '23/10/2026',
  title: 'Compartilhe seus dados de saúde e treino pelo Health Connect',
  intro: 'O Health Connect reúne, no seu celular Android, os dados do Samsung Health, do Galaxy Watch e de outros aplicativos. Escolha o que você quer compartilhar com o Panzeri Run.',
  sections: [
    {
      heading: null,
      paragraphs: [
        'Com sua autorização, o Panzeri Run poderá receber, quando o seu relógio ou aplicativo os disponibilizar, os seus exercícios (tipo, horário, duração, distância, velocidade, frequência cardíaca, potência, cadência, elevação, calorias e percurso GPS), o seu sono, a sua saúde diária (passos, distância, calorias e frequência cardíaca de repouso), a variabilidade da frequência cardíaca (HRV), o VO₂ máximo, a composição corporal e outros indicadores como saturação de oxigênio, temperatura da pele, respiração e nutrição.',
        'Essas informações serão utilizadas para acompanhar sua evolução, comparar os treinos planejados com os realizados, entender como você se recupera e personalizar seu treinamento. Seu treinador também verá esses dados no painel dele (por exemplo, seu sono, sua frequência cardíaca de repouso, sua variabilidade e seus passos) para acompanhar sua recuperação e ajustar seu treino. Elas não substituem avaliação médica.',
      ],
    },
    {
      heading: 'Você escolhe quais dados compartilhar',
      paragraphs: [
        'Marque abaixo apenas os grupos de dados que você quer compartilhar. O que você não marcar não será guardado nem utilizado. Nem todos os dados estarão sempre disponíveis: isso depende do seu relógio, do aplicativo de origem e das permissões do Android.',
        'A origem de cada dado (por exemplo, Samsung Health) é preservada.',
        'O Panzeri Run sincroniza quando você abre o aplicativo e, se você permitir no Android, também periodicamente em segundo plano, mesmo com o aplicativo fechado. Você pode desligar o segundo plano quando quiser. O percurso GPS de cada exercício só é lido se você autorizar o grupo “Percurso GPS” abaixo e confirmar o acesso no Android para aquele exercício.',
      ],
    },
    {
      heading: 'O que esta autorização não inclui',
      paragraphs: [
        'Esta autorização não inclui a análise dos seus dados por inteligência artificial. Ela tem uma autorização própria, opcional e separada, que você pode conceder ou não.',
      ],
    },
    {
      heading: 'Como você controla',
      paragraphs: [
        'Você pode consultar e retirar cada autorização quando quiser, no Panzeri Run (Dispositivos e integrações → Health Connect) e também nas permissões do Android. Os detalhes estão na Política de Privacidade.',
      ],
    },
  ],
  groups: [
    { id: 'exercise', label: 'Exercícios', description: 'Tipo, data e horário, duração, distância, velocidade e calorias dos seus treinos.', required: false, categories: ['activity'] },
    { id: 'exercise_sensors', label: 'Frequência cardíaca, potência, cadência e elevação', description: 'Informações registradas durante o exercício, quando o seu relógio as medir. Depende de “Exercícios”.', required: false, categories: ['activity_sensors'], requires: ['exercise'] },
    { id: 'exercise_route', label: 'Percurso GPS', description: 'Trajeto e localização do exercício, quando disponíveis. Depende de “Exercícios”.', required: false, categories: ['activity_route'], requires: ['exercise'] },
    { id: 'sleep', label: 'Sono e recuperação', description: 'Duração e etapas do sono, horários e cochilos, quando o seu relógio os medir.', required: false, categories: ['sleep'] },
    { id: 'daily', label: 'Saúde diária', description: 'Passos, distância e calorias do dia, quando o seu relógio os medir.', required: false, categories: ['daily_activity'] },
    { id: 'resting_hr', label: 'Frequência cardíaca de repouso', description: 'Sua frequência cardíaca em repouso, quando o seu relógio a medir.', required: false, categories: ['resting_heart_rate'] },
    { id: 'hrv', label: 'Variabilidade da frequência cardíaca (HRV)', description: 'HRV medida pelo seu relógio, quando disponível.', required: false, categories: ['hrv'] },
    { id: 'fitness', label: 'VO₂ máximo', description: 'Estimativa de capacidade aeróbica feita pelo seu relógio ou aplicativo, quando disponível.', required: false, categories: ['vo2_max'] },
    { id: 'body', label: 'Composição corporal', description: 'Peso, percentual de gordura, massa magra e outras medidas corporais, quando registradas.', required: false, categories: ['body_composition'] },
    { id: 'vitals', label: 'Saturação de oxigênio, temperatura da pele e respiração', description: 'Indicadores de recuperação medidos pelo seu relógio, quando disponíveis.', required: false, categories: ['pulse_ox', 'skin_temperature', 'respiratory_rate'] },
    { id: 'nutrition', label: 'Nutrição e hidratação', description: 'Refeições, calorias consumidas e hidratação, quando registradas em algum aplicativo.', required: false, categories: ['nutrition'] },
  ],
  // Finalidades OBRIGATORIAS descritas no texto (a lista e' o teto: o que nao esta aqui, como IA, NAO esta autorizado).
  purposes: ['history', 'tracking', 'plan_comparison', 'indicators', 'coach_view'],
  optionalPurposes: [
    {
      id: 'history_backfill',
      label: 'Autorizo a importação dos meus dados anteriores, além dos últimos 30 dias, quando o Android e o Health Connect permitirem.',
      description: 'Permite ler o histórico mais antigo guardado no Health Connect. Pode ser concedida agora ou depois, e retirada quando você quiser.',
      external: false,
      changeableAfterConnect: true,
    },
    {
      id: 'ai_external',
      label: 'Análise com o Atlas (inteligência artificial)',
      description: 'Permite usar seus dados do Health Connect autorizados em análises personalizadas com o Atlas, incluindo o envio dos dados necessários à Anthropic. Autorização própria, separada da conexão.',
      external: true,
      changeableAfterConnect: true,
      screen: {
        version: '1.0',
        dateLabel: '22/10/2026',
        title: 'Personalize seus treinos com o Atlas',
        paragraphs: [
          'O Atlas é a inteligência artificial utilizada pelo Panzeri Run para ajudar a analisar seu treinamento e orientar a personalização das próximas sessões.',
          'Com sua autorização, o Atlas poderá utilizar as informações que você autorizou compartilhar pelo Health Connect — exercícios, sono, HRV, frequência cardíaca de repouso, saúde diária e demais grupos — para avaliar como você respondeu às sessões planejadas e como está se recuperando.',
          'Essa análise poderá considerar distância, ritmo, frequência cardíaca, potência, cadência, elevação, sono e sua evolução, HRV, frequência cardíaca de repouso, VO₂ máximo, composição corporal, histórico de treinamento e outros indicadores disponíveis e autorizados. Só entram os grupos de dados que você autorizou; o que você não autorizou não é usado.',
          'Para realizar essas análises, o Panzeri Run poderá transmitir os dados necessários à Anthropic, empresa fornecedora da tecnologia de inteligência artificial utilizada pelo Atlas. Esse processamento poderá envolver transferência internacional de dados, conforme descrito na Política de Privacidade.',
          'Os resultados serão utilizados para apoiar o acompanhamento da sua evolução e as decisões de treinamento. As análises automatizadas podem apresentar limitações e não substituem avaliação médica.',
          'A recusa desta autorização não impede você de compartilhar dados pelo Health Connect nem de usar as funcionalidades que não dependam do processamento externo por inteligência artificial. Se você não autorizar, seus dados do Health Connect não serão enviados à Anthropic, nem diretamente nem por meio de relatórios ou informações derivados deles.',
          'Você pode retirar esta autorização quando quiser. Ao retirar, o envio futuro cessa e os resultados de IA já gerados com seus dados do Health Connect são invalidados ou atualizados, respeitadas as obrigações legais de conservação. O que já tiver sido enviado ao fornecedor não pode ser desfeito junto a ele.',
        ],
        checkboxText: 'Autorizo o Panzeri Run a utilizar meus dados do Health Connect autorizados para análises personalizadas com o Atlas, incluindo o envio dos dados necessários à Anthropic para processamento por inteligência artificial, conforme a Política de Privacidade.',
        buttonLabel: 'Autorizar análise com Atlas',
      },
    },
  ],
  acknowledgementText: 'Autorizo o Panzeri Run a acessar e utilizar os dados que eu selecionar pelo Health Connect, para acompanhamento e gestão do meu treinamento e da minha recuperação.',
  confirmButtonLabel: 'Salvar minhas autorizações',
};

// Categorias de dados que o grupo de consentimento cobre (vocabulario PROVIDER_DATA_CATEGORIES).
export const HEALTH_CONNECT_CATEGORIES: readonly string[] = [...new Set(HEALTH_CONNECT_CONSENT.groups.flatMap((g) => g.categories as readonly string[]))];
