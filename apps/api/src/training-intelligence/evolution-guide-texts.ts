// Textos escritos por Elton (15/11/2026) para a área "Evolução do treinamento" e seus indicadores. Servidor, por regra (sem IA). Rascunho a revisar por Elton; não alterar sem ordem dele.
// Cada indicador pode trocar: "O que é?", "Como interpretar?" e "Limitações". O "Como você está?" vem de um molde com os números da aluna (ver evolution-summary.ts).

export interface GuideTextOverride {
  whatIs: string[];
  howToRead: string[];
  limitations: string[];
  /** Molde do "Como você está?": 'standard' (média, longo, curto, tendência, último) ou 'prescribed' (como o programa prescreve o volume). */
  howYouAre: 'standard' | 'prescribed';
  /** O que a mudança de tendência pode representar (voz de professor, sem medo de dizer que piora se liga a pior desempenho e mais risco). */
  interpretation?: { above: string; below: string; stable: string };
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

// Área "Resposta à carga" (15/11/2026): rascunho meu no estilo da Evolução do treinamento, a revisar por Elton.
export const LOAD_AREA_TEXTS = {
  whatIs: 'Aqui mostramos como o seu corpo responde à carga dos treinos: o esforço que você percebe, a carga de cada treino, a carga acumulada nas semanas, a relação entre o volume recente e o seu hábito e o tamanho dos aumentos semanais de quilômetros. Alguns gráficos podem ser vistos com todas as modalidades juntas ou com cada modalidade separada, e os números e os textos de cada gráfico acompanham a modalidade que você escolher. Nenhum desses dados é usado isoladamente.',
  howToRead: 'Carga é o quanto de trabalho o treino pede e o quanto isso custa ao seu corpo. Observamos o padrão de longo prazo, o de curto prazo e como o último treino ou a última semana se comportou em relação a eles. Quando a carga e o esforço sobem de forma gradual e o seu corpo acompanha, é sinal de adaptação. Quando a carga sobe rápido demais, ou o esforço fica alto demais para o que foi pedido, aumenta a chance de fadiga acumulada, queda de desempenho e lesão. Por isso olhamos sempre o conjunto, e não um número só.',
  numbersNote: 'A semana atual não entra na conta.',
  limitation: 'Estes dados vêm dos relatos dos alunos (como o esforço percebido) e do que os dispositivos integrados nos entregam, e a precisão da nossa análise depende da precisão dessas informações. Cada aluno tem o seu contexto de vida, trabalho, sono e estresse, e isso interfere em como executa e responde a cada treino. Esses indicadores não são os únicos que olhamos: sempre os lemos junto com os demais.',
  closingWorse: 'Quando indicadores de carga e de esforço pioram ao mesmo tempo e se mantêm assim, costuma haver relação com pior desempenho nos treinos e maior risco de fadiga e de lesão. É o momento de olhar com atenção o descanso, o sono e o ajuste da carga, sempre considerando o seu contexto.',
  closingOk: 'Neste momento, os indicadores de carga que observamos não mostram sinais combinados de sobrecarga. Seguimos acompanhando, porque a resposta do corpo muda com o contexto de cada semana.',
};

const MODALITY_NOTE = 'Você pode ver todas as modalidades juntas ou cada uma separada, porque o esforço e a carga de uma corrida e de um treino de força não são comparáveis. Os números e os textos acompanham a modalidade escolhida.';
const CONTEXT_LIMIT = 'Cada aluno tem o seu contexto, e isso interfere em como executa e responde a cada treino.';
const NOT_ONLY = 'Este não é o único dado que olhamos: ele é lido junto com os demais indicadores.';

Object.assign(GUIDE_TEXT_OVERRIDES, {
  'workout.perceivedEffort': {
    whatIs: ['RPE (esforço percebido) é a nota de 1 a 10 que você dá para o esforço de cada treino, no feedback. 1 é muito leve e 10 é o máximo que você consegue.'],
    howToRead: [
      'Cada treino tem uma intenção: treinos leves devem ser sentidos como leves, e treinos intensos como intensos. O esforço que você percebe mostra se a carga prescrita está chegando ao seu corpo do jeito que planejamos.',
      'Quando treinos que deveriam ser leves passam a ser sentidos como difíceis, ou o esforço médio sobe semana após semana sem que a prescrição tenha aumentado, o corpo está pagando um preço maior pelo mesmo treino. Isso costuma estar ligado a fadiga acumulada, pior desempenho nos treinos seguintes e maior risco de lesão. Quando o esforço cai para o mesmo treino, normalmente é sinal de adaptação.',
      MODALITY_NOTE,
    ],
    limitations: ['O RPE é a sua percepção, e ela muda com sono, estresse, calor, alimentação e humor; duas pessoas sentem o mesmo treino de formas diferentes.', CONTEXT_LIMIT, NOT_ONLY],
    howYouAre: 'standard',
    interpretation: {
      above: 'Esforço percebido em alta significa que os mesmos treinos estão custando mais ao seu corpo. Se isso se mantém, aumenta a chance de fadiga acumulada, queda de desempenho e lesão, e é um sinal para olharmos a carga e o seu descanso.',
      below: 'Esforço percebido em queda indica que o corpo está lidando melhor com os treinos. Se a prescrição não ficou mais leve, costuma ser sinal de adaptação e de espaço para evoluir com segurança.',
      stable: 'Esforço percebido estável indica que a carga está sendo absorvida de forma constante, sem sinal de sobrecarga crescente nem de folga grande.',
    },
  },
  'workout.sessionInternalLoad': {
    whatIs: ['A carga de cada treino é o esforço que você percebeu multiplicado pelos minutos de treino, em UA (unidade arbitrária). Ela mostra o peso de cada sessão específica.'],
    howToRead: [
      'Um treino longo e leve e um treino curto e intenso podem ter cargas parecidas: o que importa é o conjunto. Olhamos como a carga das suas sessões se comporta no longo prazo, no curto prazo e como a última sessão ficou em relação a elas.',
      'Sessões com carga muito acima do seu padrão exigem mais recuperação, e quando vários treinos seguidos ficam muito acima, o risco de fadiga e de lesão aumenta. Sessões abaixo do padrão costumam indicar recuperação ou fase de base.',
      MODALITY_NOTE,
    ],
    limitations: ['A carga depende do esforço que você informa e do tempo registrado do treino.', 'Em "Todas" somamos esforços de modalidades diferentes; use os botões para ver cada modalidade separada.', CONTEXT_LIMIT, NOT_ONLY],
    howYouAre: 'standard',
    interpretation: {
      above: 'Carga por treino em alta indica que as suas sessões estão pesando mais. Mantida por muito tempo sem descanso, essa tendência está ligada a fadiga acumulada, pior desempenho e maior risco de lesão.',
      below: 'Carga por treino em queda indica sessões mais leves ou mais curtas. Pode ser recuperação planejada ou fase de base; se não foi planejado, vale olharmos o que está limitando os treinos.',
      stable: 'Carga por treino estável indica que as sessões vêm pesando de forma parecida, o que facilita a adaptação.',
    },
  },
  'workout.weeklyInternalLoad': {
    whatIs: ['A carga acumulada por semana soma a carga (esforço × minutos) de todos os treinos da semana. Ela mostra a tendência semanal do que o seu corpo recebeu.'],
    howToRead: [
      'Aqui olhamos a semana como um todo. O corpo se adapta quando a carga semanal sobe aos poucos e alterna semanas mais pesadas com semanas mais leves. Semanas muito mais pesadas que o seu padrão, uma atrás da outra, são as que mais se associam a fadiga acumulada, queda de desempenho e lesão.',
      'Comparamos o seu padrão de longo prazo, o de curto prazo e como a última semana fechada ficou em relação a eles.',
      MODALITY_NOTE,
    ],
    limitations: ['Semana sem nenhum treino com esforço e duração registrados fica sem ponto (não é contada como zero) e a semana em curso fica fora até terminar.', 'Em "Todas" somamos esforços de modalidades diferentes; use os botões para ver cada modalidade separada.', CONTEXT_LIMIT, NOT_ONLY],
    howYouAre: 'standard',
    interpretation: {
      above: 'Carga semanal em alta significa que o seu corpo está recebendo mais trabalho do que o seu padrão. Se a alta continua sem semanas de descarga, cresce o risco de fadiga acumulada e de lesão.',
      below: 'Carga semanal em queda indica semanas mais leves que o seu padrão. É esperado em semanas de descarga; se foi sem planejamento, vale entender o motivo.',
      stable: 'Carga semanal estável indica que o seu corpo está recebendo um volume de trabalho constante, o que favorece a adaptação.',
    },
  },
  'training.acwr': {
    whatIs: ['Compara o volume em quilômetros dos últimos 28 dias com o dos últimos 42 dias. Em outras palavras: o quanto você correu nas últimas 4 semanas em relação ao seu hábito das últimas 6 semanas.'],
    howToRead: [
      'Perto de 1,0, o volume recente é parecido com o seu hábito. Acima de 1,0, você correu mais do que está acostumada; abaixo de 1,0, menos. Usamos janelas longas porque o volume é registrado por semana, e elas evitam que uma única semana forte ou fraca distorça a leitura.',
      'Subidas rápidas e acentuadas costumam aumentar o risco de fadiga e de lesão, porque o corpo não teve tempo de se adaptar. Quedas grandes mostram recuperação ou perda do ritmo de treino. O que importa é a direção e a velocidade da mudança.',
    ],
    limitations: ['É a relação do volume em km (28 ÷ 42 dias), e não a da carga de esforço mostrada em outro gráfico.', 'Só corrida entra nos quilômetros e a semana em curso fica fora até terminar.', CONTEXT_LIMIT, NOT_ONLY],
    howYouAre: 'standard',
    interpretation: {
      above: 'A relação em alta indica que o seu volume recente está maior que o seu hábito. Quanto mais rápida a subida, maior o risco de sobrecarga; subidas graduais são as que o corpo costuma absorver melhor.',
      below: 'A relação em queda indica que o volume recente está menor que o seu hábito. Pode ser descarga planejada ou um período de menos treinos.',
      stable: 'A relação estável indica que o volume recente acompanha o seu hábito, sem mudança brusca de carga.',
    },
  },
  'training.volumeIncreasePct': {
    whatIs: ['Mostra, semana a semana, quanto o seu volume realizado de corrida aumentou ou diminuiu em relação à semana anterior, em %. As cores indicam o tamanho do aumento: verde para aumentos mais seguros e vermelho para aumentos maiores.'],
    howToRead: [
      'Aumentos graduais permitem que músculos, tendões e ossos se adaptem. Saltos grandes de uma semana para a outra estão entre os fatores mais associados a lesões por sobrecarga, e por isso o vermelho pede atenção. Reduções costumam ser semanas de descarga.',
      'Olhamos o seu padrão de variação, se os aumentos estão ficando maiores e como a última semana fechada se comportou.',
    ],
    limitations: ['Só entra corrida realizada, em semanas fechadas. A porcentagem é calculada sobre a semana anterior: depois de uma semana muito curta, um volume normal aparece como um grande aumento, e isso pode ser só retomada.', 'As faixas de cor são uma referência geral e não conhecem o seu contexto.', CONTEXT_LIMIT, NOT_ONLY],
    howYouAre: 'standard',
    interpretation: {
      above: 'Os aumentos semanais estão ficando maiores. Saltos grandes e repetidos de volume são o cenário em que o risco de lesão e de fadiga mais cresce, e pedem atenção.',
      below: 'Os aumentos semanais estão ficando menores ou virando reduções, o que dá ao corpo tempo para absorver o trabalho e costuma reduzir o risco.',
      stable: 'Os aumentos semanais vêm num ritmo parecido, sem mudança brusca na forma como o volume cresce.',
    },
  },
} satisfies Record<string, GuideTextOverride>);

// Bem-estar e rotina (15/11/2026): rascunho meu no estilo da Evolução do treinamento, a revisar por Elton.
export const WELLBEING_AREA_TEXTS = {
  whatIs: 'Aqui reunimos o que você sente no dia a dia e como é a sua rotina: o cansaço físico e mental com que você chega aos treinos, o estresse, a vontade de treinar, o seu check-in da semana e o que o seu relógio mostra do seu movimento diário (passos, calorias e distância). Nenhum desses dados é usado isoladamente.',
  howToRead: 'Em cansaço físico, cansaço mental e estresse, números menores são melhores; em vontade de treinar e no check-in da semana, números maiores indicam mais disposição. Passos, calorias e distância não são bons nem ruins: mostram o quanto você se movimenta fora dos treinos, e isso pesa na sua carga total do dia. Quando o cansaço e o estresse sobem e a vontade cai de forma contínua, o corpo e a mente têm menos capacidade de absorver os treinos, o que costuma vir junto com pior desempenho e maior risco de lesão. Observamos o padrão de longo prazo, o de curto prazo e como o último registro se comportou em relação a eles.',
  limitation: 'Boa parte destes dados é informada por você e reflete a sua percepção no momento do registro, e os dados do relógio são estimativas do aparelho, que variam de uma marca para outra. A precisão da nossa análise depende da precisão dessas informações. Cada aluno tem o seu contexto de vida, trabalho e família, e isso interfere no bem-estar e na rotina. Estes indicadores não são os únicos que olhamos: sempre os lemos junto com os demais.',
};

const SHIFT_LIMITS_SELF = [
  'É um relato seu em faixas (até 30 minutos, de 30 a 60 minutos e mais de 1 hora): o teto da escala é "mais de 1 hora", então ela não distingue 1h30 de 3 horas. Se você tem relógio, o gráfico do relógio mostra o horário com precisão.',
  'O horário habitual é o que você considera habitual; se ele muda aos poucos, o gráfico continua perto de zero.',
  CONTEXT_LIMIT,
  NOT_ONLY,
];
const SHIFT_LIMITS_WATCH = [
  'O relógio marca o início do sono quando detecta que você adormeceu, que pode ser depois de deitar, e o fim quando detecta que você acordou.',
  'O seu padrão é a mediana das suas últimas noites no mesmo relógio e só existe a partir de 5 noites; fontes diferentes nunca se misturam.',
  'É uma estimativa do relógio e varia de uma marca para outra.',
  CONTEXT_LIMIT,
  NOT_ONLY,
];

Object.assign(GUIDE_TEXT_OVERRIDES, {
  'workout.bedtimeShiftScore': {
    whatIs: ['Mostra a que horas você foi dormir em relação ao seu horário habitual, pelo que você relata no feedback dos treinos. A linha em zero é o seu habitual: acima de zero você dormiu mais cedo; abaixo, mais tarde. O valor 3 (ou −3) é mais de 1 hora antes (ou depois) do habitual e é o limite da escala.'],
    howToRead: [
      'Não existe horário certo: o que importa é a regularidade. Dormir sempre perto do mesmo horário ajuda o corpo a recuperar. Variações grandes e frequentes, principalmente para mais tarde, costumam reduzir o sono e a recuperação e, com isso, piorar o desempenho e aumentar o risco de lesão.',
      'Este gráfico é a sua percepção. Se o seu relógio mede o sono, compare com o gráfico do relógio: às vezes o que sentimos não é o que acontece de verdade.',
    ],
    limitations: SHIFT_LIMITS_SELF,
    howYouAre: 'standard',
    interpretation: {
      above: 'Você vem relatando dormir mais cedo que o habitual. Isso costuma favorecer a recuperação, desde que seja uma mudança sustentada e não uma noite isolada.',
      below: 'Você vem relatando dormir mais tarde que o habitual. Quando isso se repete, o sono encurta e a recuperação piora, o que se liga a pior desempenho e a maior risco de lesão.',
      stable: 'Você vem relatando dormir perto do seu horário habitual, o que favorece a regularidade do sono.',
    },
  },
  'workout.wakeTimeShiftScore': {
    whatIs: ['Mostra a que horas você acordou em relação ao seu horário habitual, pelo que você relata no feedback dos treinos. A linha em zero é o seu habitual: acima de zero você acordou mais cedo; abaixo, mais tarde. O valor 3 (ou −3) é mais de 1 hora antes (ou depois) do habitual e é o limite da escala.'],
    howToRead: [
      'Não existe horário certo: o que importa é a regularidade. Acordar sempre perto do mesmo horário ajuda o corpo a manter o ritmo de sono. Acordar bem mais cedo que o habitual, repetidamente, pode significar sono encurtado; acordar bem mais tarde pode refletir noites mais longas ou desorganizadas.',
      'Este gráfico é a sua percepção. Se o seu relógio mede o sono, compare com o gráfico do relógio.',
    ],
    limitations: SHIFT_LIMITS_SELF,
    howYouAre: 'standard',
    interpretation: {
      above: 'Você vem relatando acordar mais cedo que o habitual. Se o horário de dormir não acompanhou, o sono encurta, o que se liga a pior recuperação e a maior risco de lesão.',
      below: 'Você vem relatando acordar mais tarde que o habitual. Vale olhar junto com o horário de dormir para entender se são noites mais longas ou uma rotina mudando.',
      stable: 'Você vem relatando acordar perto do seu horário habitual, o que favorece a regularidade do sono.',
    },
  },
  'wearable.bedtimeDeviationMin': {
    whatIs: ['Mostra a que horas o seu relógio registrou que você adormeceu, comparado ao seu padrão (a mediana das suas últimas noites). Zero é o seu padrão; acima de zero você dormiu mais cedo; abaixo, mais tarde, em minutos.'],
    howToRead: [
      'Aqui vemos a regularidade do horário de dormir com precisão. Não existe horário certo, e sim um padrão que o seu corpo reconhece. Noites muito fora do padrão, principalmente para mais tarde e de forma repetida, reduzem o tempo de sono e a recuperação, o que se liga a pior desempenho e a maior risco de lesão.',
      'Compare com o gráfico do seu relato: às vezes a nossa percepção do horário é diferente do que o relógio registra.',
    ],
    limitations: SHIFT_LIMITS_WATCH,
    howYouAre: 'standard',
    interpretation: {
      above: 'O relógio mostra que você vem dormindo mais cedo que o seu padrão. Se for sustentado, tende a ajudar a recuperação; se for pontual, é só uma variação.',
      below: 'O relógio mostra que você vem dormindo mais tarde que o seu padrão. Repetido, isso encurta o sono e prejudica a recuperação, e se liga a pior desempenho e a maior risco de lesão.',
      stable: 'O relógio mostra que você vem dormindo perto do seu padrão, o que indica uma rotina de sono regular.',
    },
  },
  'wearable.wakeDeviationMin': {
    whatIs: ['Mostra a que horas o seu relógio registrou que você acordou, comparado ao seu padrão (a mediana das suas últimas noites). Zero é o seu padrão; acima de zero você acordou mais cedo; abaixo, mais tarde, em minutos.'],
    howToRead: [
      'Aqui vemos a regularidade do horário de acordar com precisão. Um horário estável ajuda o corpo a manter o ritmo de sono. Acordar bem mais cedo que o padrão, repetidamente, costuma significar sono encurtado.',
      'Compare com o gráfico do seu relato: às vezes a nossa percepção do horário é diferente do que o relógio registra.',
    ],
    limitations: SHIFT_LIMITS_WATCH,
    howYouAre: 'standard',
    interpretation: {
      above: 'O relógio mostra que você vem acordando mais cedo que o seu padrão. Se o horário de dormir não acompanhou, o sono encurta e a recuperação piora.',
      below: 'O relógio mostra que você vem acordando mais tarde que o seu padrão. Vale olhar junto com o horário de dormir.',
      stable: 'O relógio mostra que você vem acordando perto do seu padrão, o que indica uma rotina de sono regular.',
    },
  },
  'wearable.dailySteps': {
    whatIs: ['Mostra quantos passos o seu relógio registrou por dia, somando os treinos e o movimento do dia a dia.'],
    howToRead: [
      'Não existe número certo de passos: ele reflete a sua rotina de trabalho, deslocamentos e treinos. O que importa é o seu padrão e se ele está mudando.',
      'Muito movimento fora dos treinos soma carga no seu corpo, principalmente em dias de treino pesado, e pode atrapalhar a recuperação. Dias com muito pouco movimento podem indicar descanso ou uma rotina muito parada.',
    ],
    limitations: ['É uma medida do relógio e varia de uma marca para outra; usamos só a fonte principal do seu relógio. Não distingue treino de movimento do dia a dia, e dia sem uso do relógio fica sem dado.', CONTEXT_LIMIT, NOT_ONLY],
    howYouAre: 'standard',
    interpretation: {
      above: 'Você vem se movimentando mais no dia a dia. Se isso soma com treinos mais pesados, vale cuidar do descanso, porque a carga total do dia está maior.',
      below: 'Você vem se movimentando menos no dia a dia. Pode ser descanso ou mudança de rotina; vale olhar junto com o seu cansaço e o seu humor.',
      stable: 'O seu movimento diário vem constante, o que facilita para o corpo se adaptar à carga dos treinos.',
    },
  },
  'wearable.dailyActiveKcal': {
    whatIs: ['Mostra as calorias ativas que o seu relógio estimou por dia, ou seja, o gasto de energia fora do repouso, somando treino e rotina.'],
    howToRead: [
      'Não existe número certo de calorias ativas: ele depende do seu corpo, dos treinos e da sua rotina. O que importa é o seu padrão e a direção da mudança.',
      'Dias com gasto muito acima do seu padrão, repetidos, somam carga e pedem mais recuperação; gasto abaixo costuma indicar descanso ou rotina mais parada.',
    ],
    limitations: ['É uma estimativa do fabricante do relógio, não uma medida direta do gasto de energia, e varia de uma marca para outra; usamos só a fonte principal do seu relógio.', CONTEXT_LIMIT, NOT_ONLY],
    howYouAre: 'standard',
    interpretation: {
      above: 'Você vem gastando mais energia por dia. Se isso se mantém junto com treinos pesados, a recuperação precisa acompanhar.',
      below: 'Você vem gastando menos energia por dia, o que pode ser descanso ou rotina mais parada.',
      stable: 'O seu gasto diário de energia vem constante, o que facilita a adaptação ao treino.',
    },
  },
  'wearable.dailyDistanceKm': {
    whatIs: ['Mostra a distância que o seu relógio registrou por dia, somando treinos e deslocamentos do dia a dia.'],
    howToRead: [
      'Não existe distância certa por dia: ela reflete os seus treinos e a sua rotina. O que importa é o seu padrão e se ele está mudando.',
      'Distâncias muito acima do seu padrão, em sequência, somam carga e pedem mais recuperação; distâncias abaixo costumam indicar descanso.',
    ],
    limitations: ['É uma medida do relógio e varia de uma marca para outra; usamos só a fonte principal do seu relógio. Soma treino e movimento do dia a dia, e dia sem uso do relógio fica sem dado.', CONTEXT_LIMIT, NOT_ONLY],
    howYouAre: 'standard',
    interpretation: {
      above: 'Você vem percorrendo mais distância por dia. Se isso se mantém junto com treinos pesados, a recuperação precisa acompanhar.',
      below: 'Você vem percorrendo menos distância por dia, o que pode ser descanso ou mudança de rotina.',
      stable: 'A sua distância diária vem constante, o que facilita a adaptação ao treino.',
    },
  },
} satisfies Record<string, GuideTextOverride>);

Object.assign(GUIDE_TEXT_OVERRIDES, {
  'pain.perWorkout': {
    whatIs: ['Mostra a dor que você relatou em cada treino, numa escala de 0 a 3: 0 é sem dor, 1 é dor leve, 2 é moderada e 3 é forte. Todo treino registrado conta: se você marcou que não sentiu dor, vale 0; e treino registrado sem feedback também vale 0, porque não houve relato de dor.'],
    howToRead: [
      'Dor é um dos sinais mais importantes que acompanhamos. Treinos sem dor em sequência indicam que o corpo está tolerando a carga. Dor que aparece, se repete, aumenta ou surge mais cedo no treino costuma estar ligada a uma carga acima do que o corpo suporta naquele momento, a pior desempenho e a maior risco de lesão.',
      'Olhamos o seu padrão de longo prazo, o de curto prazo e se a dor está aumentando.',
    ],
    limitations: ['O treino registrado sem feedback entra como zero porque não houve relato, mas pode haver dor que não foi informada.', 'A dor é a sua percepção, e a escala tem poucos níveis (sem dor, leve, moderada e forte).', CONTEXT_LIMIT, NOT_ONLY],
    howYouAre: 'standard',
    interpretation: {
      above: 'A dor vem aparecendo mais nos seus treinos. Se continua, aumenta o risco de lesão e pede que olhemos a carga e o que está doendo.',
      below: 'A dor vem diminuindo ao longo dos treinos, sinal de que o corpo está se adaptando ou se recuperando.',
      stable: 'A dor vem num padrão parecido ao de sempre, sem mudança relevante.',
    },
  },
  'pain.reports': {
    whatIs: ['São os relatos que você fez em "Relatar dor", com a região do corpo, a intensidade de 1 a 10 e se a dor está piorando, estável ou melhorando.'],
    howToRead: [
      'Dor que persiste, piora ou atrapalha o dia a dia é um sinal importante, e é por isso que pedimos o relato com detalhes. Quanto mais alta e mais frequente a intensidade, maior a chance de a dor estar limitando o seu desempenho e aumentando o risco de lesão.',
      'Este gráfico é separado da dor por treino porque é outro tipo de relato.',
    ],
    limitations: ['Só aparecem os relatos que você fez em "Relatar dor"; dor que não foi relatada não entra.', 'A intensidade é a sua percepção.', CONTEXT_LIMIT, NOT_ONLY],
    howYouAre: 'standard',
    interpretation: {
      above: 'A intensidade dos seus relatos de dor vem aumentando. Se continua, aumenta o risco de lesão e pede que olhemos a carga e a região que dói.',
      below: 'A intensidade dos seus relatos de dor vem diminuindo, sinal de recuperação.',
      stable: 'A intensidade dos seus relatos de dor vem num patamar parecido ao de sempre.',
    },
  },
} satisfies Record<string, GuideTextOverride>);
