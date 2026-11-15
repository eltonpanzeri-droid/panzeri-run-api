// Textos escritos por Elton (15/11/2026) para a área "Evolução do treinamento" e seus indicadores. Servidor, por regra (sem IA). Rascunho a revisar por Elton; não alterar sem ordem dele.
// Cada indicador pode trocar: "O que é?", "Como interpretar?" e "Limitações". O "Como você está?" vem de um molde com os números da aluna (ver evolution-summary.ts).

export interface GuideTextOverride {
  whatIs: string[];
  howToRead: string[];
  limitations: string[];
  /** Molde do "Como você está?": 'standard' (média, longo, curto, tendência, último) ou 'prescribed' (como o programa prescreve o volume). */
  howYouAre: 'standard' | 'prescribed';
}

export const TRAINING_AREA_TEXTS = {
  whatIs: 'Aqui mostramos alguns dos indicadores de evolução do seu treinamento. Apresentamos os números e as tendências de longo e de curto prazo. Nenhum desses dados é usado isoladamente. Os dados são coletados a partir dos relatos dos alunos e das informações enviadas pelos dispositivos sincronizados dos alunos.',
  howToRead: 'Cada indicador apresenta uma dinâmica própria. Avaliamos a tendência de longo prazo, a tendência de curto prazo e como a última sessão se comportou em comparação com as suas tendências. Também observamos se as tendências estão apresentando sinais de mudança (tanto para melhor quanto para pior). Quanto mais indicadores apresentam tendências e comportamentos positivos, mais podemos considerar que você está evoluindo e suportando a evolução dos treinos.',
  numbersNote: 'A semana atual não entra na conta.',
  limitation: 'Os dados são coletados dos relatos dos alunos e daquilo que os dispositivos integrados nos entregam. A precisão da nossa análise depende da precisão da entrega dessas informações ao Panzeri Run.',
};

export const GUIDE_TEXT_OVERRIDES: Record<string, GuideTextOverride> = {
  'training.volumeCompletedTotalKm': {
    whatIs: ['Aqui contabilizamos quantos quilômetros você realmente correu na semana.'],
    howToRead: [
      'Não existe qualificação de bom ou ruim, pois cada corredor possui a sua individualidade. Sabemos que corredores que costumam correr maiores quantidades de quilômetros semanais tendem a apresentar melhores resultados, mas isso também pode trazer maior risco de fadiga e lesões.',
      'Aqui olhamos qual é o seu padrão de longo prazo, se esse padrão está se alterando e se essa alteração está aumentando ou reduzindo o seu padrão.',
    ],
    limitations: [
      'Os dados são coletados dos relatos dos alunos e daquilo que os dispositivos integrados nos entregam. A precisão da nossa análise depende da precisão da entrega dessas informações ao Panzeri Run.',
      'Só corrida entra nos quilômetros e a semana em curso fica fora até terminar.',
    ],
    howYouAre: 'standard',
  },
  'training.volumePrescribedKm': {
    whatIs: [
      'Aqui contabilizamos quantos quilômetros o seu treinador prescreveu para você. Você pode ter corrido mais, menos ou a quantidade programada.',
      'Como estipulamos a prescrição: após analisar o seu histórico, objetivos, contextos, relatos, individualidade e o seu comportamento em todos os indicadores que coletamos, criamos a sua prescrição para garantir evolução com o menor risco possível.',
    ],
    howToRead: [
      'Se o seu volume semanal está estabilizado, significa que, pelos nossos dados e pela rotina que você disponibiliza, não precisamos nem recomendamos correr mais quilômetros.',
      'Se a tendência é de aumento, significa que estamos interpretando que você está conseguindo evoluir sem aumentar demasiadamente os riscos.',
      'Se estamos reduzindo a tendência de quilômetros prescritos, significa que acreditamos que, neste momento, precisamos garantir mais segurança para os seus treinos, e continuar com a tendência maior poderia apresentar maiores riscos sem benefícios adicionais.',
    ],
    limitations: [
      'O corpo humano é um sistema complexo em que cada variável se relaciona com as outras, e elas são muitas. Nosso papel é avaliar o máximo delas, encontrar tendências e verificar se o seu contexto apresenta mais indicadores favoráveis ou não para definirmos os rumos do seu programa de treinamento. Com isso esperamos aumentar as possibilidades de ganhos, controlando e mantendo os riscos dentro de parâmetros aceitáveis.',
      'Os nossos dados dependem também da precisão dos relatos dos alunos e da precisão do que os dispositivos entregam ao nosso sistema.',
    ],
    howYouAre: 'prescribed',
  },
  'training.volumeRatioCompletedPrescribed': {
    whatIs: ['Aqui mostramos a razão entre o que você realizou e o que foi prescrito de volume semanal: 100% significa que você fez exatamente o prescrito.'],
    howToRead: [
      'Esse dado nos dá informação do quanto você está conseguindo cumprir aquilo que estamos propondo. Não usamos isso para julgar a conduta do aluno, mas para entender se o que estamos propondo está dentro da realidade dele. Entendemos que os contextos individuais permitem disponibilidades diferentes e pedem prescrições de acordo com o que cada aluno é capaz de fazer, e esse indicador nos dá informações e critérios para isso.',
      'Quanto mais acima de 100% estiver a sua tendência, significa que você está sempre treinando a mais. Isso não é necessariamente melhor nem pior.',
      'Quanto mais perto de 100%, mais alinhados estão o que prescrevemos e o que você consegue fazer. Queremos sempre o número mais perto de 100%, mas entendemos que nem sempre isso será possível.',
      'Quanto mais abaixo de 100%, significa que você não está conseguindo completar aquilo que estamos propondo. Isso também não é necessariamente bom ou ruim.',
    ],
    limitations: [
      'Esse indicador depende dos registros feitos por relato e pelos dispositivos integrados. Ele não é diagnóstico e sempre é analisado em conjunto com as outras informações do aluno.',
      'O realizado inclui os treinos extras; semana sem volume prescrito não entra, e a semana em curso fica fora até terminar.',
    ],
    howYouAre: 'standard',
  },
  'activity.cadenceAvg': {
    whatIs: ['Aqui mostramos o número de passos por minuto.'],
    howToRead: [
      'Não existe um número correto para a cadência. Ela pode variar de acordo com características físicas individuais, ritmo de corrida, terreno e outros fatores.',
      'O objetivo é avaliar como esse indicador se comporta no longo prazo e se ele apresenta alguma alteração de tendência no curto prazo. Usamos esse dado para fazer correlações com a evolução do ritmo, lesões e dores, eficiência mecânica, entre outros dados. Não existe bom ou ruim.',
    ],
    limitations: ['Esse é um dado que depende da integração com dispositivos que medem o número de passadas.'],
    howYouAre: 'standard',
  },
  'activity.avgPaceSecondsKm': {
    whatIs: ['É o ritmo médio que você correu: quanto tempo gastou para percorrer uma distância. Usamos quantos minutos você gastou para correr cada quilômetro, o que também se chama pace.'],
    howToRead: [
      'Cada treino tem um objetivo. Alguns precisam ser mais lentos, outros mais rápidos, e alguns misturam ritmos rápidos e lentos. Aqui coletamos a média total de cada treino.',
      'Quando a tendência mostra o ritmo médio mais lento, significa que os treinos estão predominantemente mais lentos, e não que a sua capacidade de correr está diminuindo. Muitas vezes precisamos de treinos mais lentos para conseguir correr mais rápido em treinos futuros. Quando a tendência mostra o ritmo médio mais rápido, significa que você está passando mais tempo correndo mais rápido; isso também não significa que você está ficando melhor, pode ser apenas que acumulou mais treinos que exigiam correr mais rápido.',
      'O importante aqui, como na maioria dos indicadores, é entender a sua tendência geral. Usamos esse parâmetro também para entender quanto esforço cada treino representou em relação ao seu padrão.',
    ],
    limitations: [
      'Os dados são coletados dos relatos dos alunos e daquilo que os dispositivos integrados nos entregam. A precisão da nossa análise depende da precisão da entrega dessas informações ao Panzeri Run.',
      'O ritmo estimado pelo GPS não entra nesta média, e treinos com ritmo impossível ficam de fora.',
    ],
    howYouAre: 'standard',
  },
  'execution.timeInBandPct': {
    whatIs: ['Um treino pode apresentar o ritmo médio igual ao que foi proposto, mas ter sido executado de forma muito diferente. Esse dado mostra como você seguiu a prescrição.'],
    howToRead: [
      'Quanto mais perto de 100%, mais você está seguindo a nossa prescrição. Esperamos que você siga ao máximo o que propomos, mas entendemos que nem sempre é possível manter o ritmo que pedimos, principalmente quando se corre na rua ou quando pedimos um ritmo muito diferente do que você está habituado.',
      'A tendência de longo prazo mostra a sua dificuldade em seguir os ritmos propostos, e a análise individual de cada treino mostra como você conseguiu seguir aquele treino. Se você tem a tendência de se afastar muito do que prescrevemos, significa que não está estimulando o corpo como planejamos, os resultados podem se afastar do que queremos e os riscos podem aumentar.',
    ],
    limitations: [
      'Manter o ritmo dentro do que foi prescrito é sempre desafiador, principalmente para quem corre na rua, pois há interferência do terreno, do trânsito e de outros obstáculos. Na esteira tende a ser mais fácil.',
      'Apesar de considerarmos importante que o aluno siga o mais próximo possível do que desejamos, entendemos que essas dificuldades limitam o uso deste indicador. Por isso ele nunca é considerado isoladamente.',
      'Só entram corridas com faixa de ritmo prescrita e dados do relógio.',
    ],
    howYouAre: 'standard',
  },
};
