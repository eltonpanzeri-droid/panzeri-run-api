import { ConsentCapability } from '../provider-hub/provider-connector';

// Autorizacoes do relogio Wear OS (Galaxy Watch, Pixel Watch e outros) — versao 1.1 de 18/11/2026, aprovada por Elton (texto enxuto, pedido dele: dizer que o Panzeri Run usa tudo, com consentimento, de acordo com a lei). Texto completo da Politica de Privacidade e dos Termos continua pendente de advogado.
// Qualquer alteracao de texto, grupo ou finalidade muda o hash e EXIGE nova versao (quem ja' tiver autorizado precisa reconfirmar).
//
// Decisoes de Elton (17/11/2026) refletidas aqui: (1) o GPS e' gravado pelo relogio SO' durante o treino que a aluna inicia, nunca fora dele; (2) a IA usa os dados autorizados, INCLUINDO o percurso (premissa
// de 01/11: todo dado vai a IA salvo falta de consentimento ou regra da empresa do relogio); por isso o texto da conexao ja' inclui a IA — nao ha tela separada, como no Apple Saude — e a aluna pode
// desligar o uso pela IA depois, no proprio cartao; (3) a finalidade existe para analisar onde a aluna corre e a altimetria e, no futuro, montar o mapa do percurso. Decisao de Elton (17/11/2026): os dados da aluna NAO sao enviados a servico de meteorologia nem a terceiros alem do fornecedor de IA; por isso o texto nao fala em clima/temperatura.
//
// Autorizacao do Android (permissao de localizacao e de sensores, pedida no relogio ao iniciar a corrida) e este consentimento (registrado no servidor) sao coisas DIFERENTES: a primeira deixa o relogio LER o
// sensor; este autoriza o Panzeri Run a GUARDAR e USAR o que chega. O servidor so' guarda o que este registro autoriza.
export const WEAR_OS_PROVIDER_ID = 'wear_os';

export const WEAR_OS_CONSENT: ConsentCapability = {
  version: '1.1',
  dateLabel: '18/11/2026',
  title: 'Conecte o seu relógio Wear OS ao Panzeri Run',
  intro: 'O aplicativo do Panzeri Run no relógio (Galaxy Watch, Pixel Watch e outros relógios Wear OS) grava as suas corridas e as envia ao Panzeri Run. Escolha o que você quer compartilhar.',
  sections: [
    {
      heading: null,
      paragraphs: [
        'Ao autorizar, você permite que o Panzeri Run use todos os dados das corridas gravadas no relógio que você selecionar abaixo: data e horário, duração, distância, ritmo e velocidade, frequência cardíaca (dado de saúde), e o trajeto e a localização do treino, com a altitude (se você marcar “Percurso GPS”). Usamos esses dados para acompanhar e gerenciar o seu treinamento, mostrar sua evolução e o mapa dos treinos, comparar o planejado com o realizado e personalizar seus programas de treino. Seu treinador também vê esses dados. Tudo é tratado de acordo com a lei (LGPD), nada é vendido e nada é usado para publicidade.',
        'Inteligência artificial: os dados que você autorizar, incluindo o percurso GPS, são enviados à Anthropic, fornecedora da tecnologia de inteligência artificial usada pelo Panzeri Run (o Atlas), o que pode envolver transferência internacional de dados, conforme a Política de Privacidade. Você pode desligar o uso dos dados do relógio pela inteligência artificial a qualquer momento, no Panzeri Run.',
        'O GPS e os sensores só funcionam durante o treino: o relógio só liga depois que você toca em “Iniciar corrida” e desliga quando você encerra. O Panzeri Run não usa localização em segundo plano. O Android também pede, na primeira vez, a permissão do relógio; esta tela é outra e registra o que você autoriza o Panzeri Run a guardar e usar.',
        'Você pode mudar ou retirar cada autorização quando quiser, em Dispositivos e integrações → Relógio Wear OS. Ao retirar um grupo, os dados daquele grupo já guardados são apagados, e você também pode retirar o relógio e pedir a exclusão dos treinos recebidos. Os detalhes estão na Política de Privacidade.',
      ],
    },
  ],
  groups: [
    { id: 'activity', label: 'Corridas gravadas no relógio', description: 'Data e horário, duração (tempo da atividade, do cronômetro e em movimento), distância, ritmo e velocidade das corridas que você gravar no relógio.', required: false, categories: ['activity'] },
    { id: 'sensors', label: 'Frequência cardíaca durante o treino', description: 'Frequência cardíaca média, máxima e ao longo do treino, medida pelo relógio enquanto você corre. Depende de “Corridas gravadas no relógio”.', required: false, categories: ['activity_sensors'], requires: ['activity'] },
    { id: 'route', label: 'Percurso GPS', description: 'Trajeto e localização do treino, com a altitude, gravados pelo GPS do relógio só durante o treino. Dado sensível. Depende de “Corridas gravadas no relógio”.', required: false, categories: ['activity_route'], requires: ['activity'] },
  ],
  // Finalidades OBRIGATORIAS descritas no texto (a lista e' o teto).
  purposes: ['history', 'tracking', 'plan_comparison', 'indicators', 'coach_view', 'map_and_terrain'],
  // O uso pela IA esta descrito no proprio texto da conexao (sem tela separada) e pode ser desligado depois pela aluna.
  optionalPurposes: [
    {
      id: 'ai_external',
      label: 'Usar os dados do relógio nas análises com inteligência artificial (Atlas)',
      description: 'Permite usar os dados do relógio que você autorizou, incluindo o percurso GPS quando autorizado, em análises personalizadas com o Atlas, o que envolve o envio dos dados necessários à Anthropic. Já faz parte desta autorização e pode ser desligada a qualquer momento.',
      external: true,
      changeableAfterConnect: true,
    },
  ],
  acknowledgementText: 'Autorizo o Panzeri Run a guardar e utilizar os dados do meu relógio que eu selecionar, para acompanhamento e gestão do meu treinamento, incluindo o mapa e a análise do meu percurso, as análises com inteligência artificial e o envio dos dados necessários à Anthropic, como descrito acima. Sei que o GPS e os sensores só funcionam durante o treino e que posso retirar esta autorização quando quiser.',
  confirmButtonLabel: 'Salvar minhas autorizações',
};

export const WEAR_OS_CATEGORIES = ['activity', 'activity_sensors', 'activity_route'] as const;
