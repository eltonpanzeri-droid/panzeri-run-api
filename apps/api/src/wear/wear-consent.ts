import { ConsentCapability } from '../provider-hub/provider-connector';

// Autorizacoes do relogio Wear OS (Galaxy Watch, Pixel Watch e outros) — versao 1.0, RASCUNHO de 17/11/2026 escrito pelo Claude a pedido de Elton. NAO foi revisado por advogado nem aprovado por Elton:
// so' pode ir ao ar depois dessas duas revisoes (o texto completo da Politica de Privacidade e dos Termos continua pendente de advogado). Qualquer alteracao de texto, grupo ou finalidade muda o hash e
// EXIGE nova versao (quem ja' tiver autorizado precisa reconfirmar).
//
// Decisoes de Elton (17/11/2026) refletidas aqui: (1) o GPS e' gravado pelo relogio SO' durante o treino que a aluna inicia, nunca fora dele; (2) a IA usa os dados autorizados, INCLUINDO o percurso (premissa
// de 01/11: todo dado vai a IA salvo falta de consentimento ou regra da empresa do relogio); por isso o texto da conexao ja' inclui a IA — nao ha tela separada, como no Apple Saude — e a aluna pode
// desligar o uso pela IA depois, no proprio cartao; (3) a finalidade existe para analisar onde a aluna corre e a altimetria e, no futuro, montar o mapa do percurso. Decisao de Elton (17/11/2026): os dados da aluna NAO sao enviados a servico de meteorologia nem a terceiros alem do fornecedor de IA; por isso o texto nao fala em clima/temperatura.
//
// Autorizacao do Android (permissao de localizacao e de sensores, pedida no relogio ao iniciar a corrida) e este consentimento (registrado no servidor) sao coisas DIFERENTES: a primeira deixa o relogio LER o
// sensor; este autoriza o Panzeri Run a GUARDAR e USAR o que chega. O servidor so' guarda o que este registro autoriza.
export const WEAR_OS_PROVIDER_ID = 'wear_os';

export const WEAR_OS_CONSENT: ConsentCapability = {
  version: '1.0',
  dateLabel: '17/11/2026',
  title: 'Conecte o seu relógio Wear OS ao Panzeri Run',
  intro: 'O aplicativo do Panzeri Run no relógio (Galaxy Watch, Pixel Watch e outros relógios Wear OS) grava as suas corridas e as envia ao Panzeri Run. Escolha o que você quer compartilhar.',
  sections: [
    {
      heading: null,
      paragraphs: [
        'Com sua autorização, quando você iniciar uma corrida no relógio, o Panzeri Run poderá receber: data e horário, duração (tempo da atividade, tempo do cronômetro e tempo em movimento), distância, ritmo e velocidade, frequência cardíaca média, máxima e ao longo do treino e, se você marcar o grupo “Percurso GPS”, o trajeto e a localização do treino, com a altitude.',
        'Essas informações serão utilizadas para mostrar sua evolução e o mapa dos seus treinos, entender onde você corre e como o terreno e a altitude influenciam seu desempenho, comparar os treinos planejados com os realizados e personalizar seu treinamento. Seu treinador também verá esses dados. Seus dados individuais não serão vendidos nem divulgados publicamente, e não são usados para publicidade. Nada disso substitui avaliação médica.',
        'Sobre a inteligência artificial: para gerar essas análises, os dados necessários dos grupos que você autorizar, incluindo o percurso GPS quando você o autorizar, são enviados à Anthropic, empresa fornecedora da tecnologia de inteligência artificial usada pelo Panzeri Run (o Atlas), o que pode envolver transferência internacional de dados, conforme a Política de Privacidade. As análises automáticas podem apresentar limitações. Você pode desligar o uso dos dados do relógio pela inteligência artificial a qualquer momento, no Panzeri Run, e isso vale para as análises seguintes.',
      ],
    },
    {
      heading: 'O GPS e os sensores só funcionam durante o treino',
      paragraphs: [
        'O relógio só liga o GPS e os sensores de frequência cardíaca depois que você toca em “Iniciar corrida” e para quando você encerra o treino. O Panzeri Run não coleta a sua localização fora do treino e não usa localização em segundo plano. Durante a corrida, o relógio mostra uma notificação de atividade em andamento.',
        'O relógio também pede, na primeira vez, a permissão do Android para usar o GPS e os sensores. Esta tela é outra: ela registra, no Panzeri Run, o que você autoriza guardar e usar. O Panzeri Run só guarda o que você marcar aqui, mesmo que o Android permita mais.',
      ],
    },
    {
      heading: 'O que esta autorização não inclui',
      paragraphs: [
        'Esta autorização não inclui dados de saúde do dia a dia (sono, passos, variabilidade da frequência cardíaca e outros), que o aplicativo do relógio não lê. O Panzeri Run também não grava nada no seu relógio além do que você pede, e não lê dados de outras pessoas.',
        'Se o seu relógio também enviar o mesmo treino por outro caminho (por exemplo, pelo Health Connect), o Panzeri Run mantém um só registro do treino.',
      ],
    },
    {
      heading: 'Como você controla',
      paragraphs: [
        'Você pode consultar e retirar cada autorização quando quiser, no Panzeri Run (Dispositivos e integrações → Samsung / Galaxy Watch → Relógio Wear OS). Ao retirar o grupo “Percurso GPS” ou o de frequência cardíaca, os dados daquele grupo já guardados são apagados. Ao retirar todas as autorizações, o Panzeri Run deixa de receber treinos do relógio. Você também pode retirar o relógio da lista, e ele deixa de enviar na hora, e pedir a exclusão dos treinos recebidos. Os detalhes estão na Política de Privacidade.',
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
