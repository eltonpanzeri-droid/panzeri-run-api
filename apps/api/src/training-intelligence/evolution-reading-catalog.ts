// Catálogo de LEITURA da Evolução da aluna (13/11/2026, decisão de Elton: 6 áreas, texto por REGRA, sem IA). Para cada indicador: o que a escala significa, por que importa e o que o nível da aluna indica.
// Escala (mínimo/máximo) NÃO é repetida aqui: vem do VariableRegistry (fonte única). Aqui ficam só a polaridade (o que é bom) e os textos.
//
// STATUS: 'rascunho_a_revisar' — textos escritos por Claude no tom do exemplo de Elton; ele revisa cada frase (e o advogado, o que for mostrado à aluna). Regras de redação (as mesmas de
// indicatorMeanings.ts): inferência com fonte é permitida ("está associado a"), nunca causa direta nem diagnóstico; nenhum indicador é analisado sozinho.
// Polaridade: levelGoodWhen = quando o NÍVEL é bom (alto/baixo); null = o nível sozinho não diz se é bom ou ruim (ex.: esforço, volume). trendGoodWhen = para que lado a MUDANÇA é melhora.
export const EVOLUTION_READING_STATUS = 'rascunho_a_revisar' as const;
export const EVOLUTION_READING_VERSION = '2026-11-13';
// Só semanas/registros desde esta data entram (regra de Elton, 05/11/2026).
export const EVOLUTION_SINCE = new Date('2026-08-01T00:00:00-03:00');

export type AreaId = 'training' | 'load' | 'sleep' | 'wellbeing' | 'adherence';
export type LevelGoodWhen = 'high' | 'low' | null;
export type TrendGoodWhen = 'up' | 'down' | null;

export interface IndicatorReading {
  variableId: string;
  area: AreaId;
  /** Nome curto, usado nas frases ("qualidade do sono"). */
  name: string;
  levelGoodWhen: LevelGoodWhen;
  trendGoodWhen: TrendGoodWhen;
  /** O que a escala significa (frase completa, já com o nome do indicador). */
  scaleText: string;
  /** Por que o indicador importa. */
  why: string;
  /** O que o nível da aluna indica. Indicadores sem direção (levelGoodWhen null) usam só `neutral`. */
  meaning: { good?: string; middle?: string; poor?: string; neutral?: string };
  /** Indicador sem "bom/ruim" que tem regra de texto pela POSIÇÃO da média na escala (ex.: esforço percebido alto/médio/baixo). Posição >= 0,65 = high; <= 0,4 = low. */
  positionMeaning?: { high: string; middle: string; low: string };
  /** Palavras da tendência quando o indicador não tem polaridade: above = valores subiram, below = valores caíram (ex.: ritmo: "ritmo mais lento"/"ritmo mais rápido"). */
  phrases?: { above: string; below: string };
  /** Mudança conta como 10% do valor de referência (e não da escala): para volume, ritmo e medidas do relógio, cuja escala do registro é só um limite técnico. */
  relativeChange?: boolean;
  /** Série semanal: a semana em curso (incompleta) fica fora e o texto comenta a ÚLTIMA SEMANA OBSERVÁVEL contra o padrão. */
  weekly?: { unitLabel: string };
  /** Medido pelo relógio: usa só a fonte principal da aluna (nunca mistura fontes) e, no sono, só a sessão principal da noite. */
  wearable?: boolean;
  /** Frase do padrão de longo prazo (substitui "O seu caso mostra uma média de..."). */
  habitualTemplate?: (mean: string, n: number) => string;
}

const WATCH_FOOTER = 'Esse indicador, sozinho, não diz se você está bem ou mal: cada dado é uma parte de um todo e pode ajudar mais ou atrapalhar mais conforme o número. O que mostramos é o seu padrão de longo prazo e para onde a sua tendência aponta, lidos junto com os demais dados para montar treinos mais assertivos. Não é diagnóstico.';
const NEUTRAL_FOOTER = 'Esse indicador não é "bom" ou "ruim" por si só: o que ele mostra depende da intenção dos seus treinos e do momento da preparação, por isso é acompanhado junto com os demais.';

export const READING_CATALOG: IndicatorReading[] = [
  // ------------------------------------------------------------------ Sono e recuperação
  {
    variableId: 'workout.preSleepQuality', area: 'sleep', name: 'qualidade do sono', levelGoodWhen: 'high', trendGoodWhen: 'up',
    scaleText: 'Nesse quesito (qualidade do sono, de 1 a 5), números mais perto de 5 significam que você tende a dormir bem.',
    why: 'Dormir bem é importante para a recuperação, a prontidão e a possibilidade de evoluir: um bom sono está associado a menos risco de lesões e indica que você está suportando bem a carga de treinamento.',
    meaning: {
      good: 'Por esse parâmetro, você tem boas condições de recuperação, de prontidão para treinar e de tolerância ao esforço.',
      middle: 'Por esse parâmetro, a sua recuperação está num nível intermediário: há espaço para melhorar a prontidão e a tolerância ao esforço.',
      poor: 'Por esse parâmetro, você tem menos prontidão para treinar e menor tolerância ao esforço, e pode ter dificuldade para evoluir. Vale observar também a fadiga, o esforço percebido e a sua resposta aos treinos.',
    },
  },
  {
    variableId: 'workout.sleepInterruption', area: 'sleep', name: 'interrupções do sono', levelGoodWhen: 'low', trendGoodWhen: 'down',
    scaleText: 'Nesse quesito (interrupções do sono, de 1 a 5), números mais perto de 1 significam que o seu sono quase não é interrompido; mais perto de 5, que ele é muito interrompido.',
    why: 'Um sono fragmentado costuma ser menos reparador, mesmo quando o total de horas parece suficiente, e pode reduzir a recuperação entre os treinos.',
    meaning: {
      good: 'Por esse parâmetro, o seu sono tende a ser contínuo, o que favorece a recuperação.',
      middle: 'Por esse parâmetro, o seu sono tem algumas interrupções: a recuperação pode ficar um pouco abaixo do que seria possível.',
      poor: 'Por esse parâmetro, o seu sono é bastante interrompido, o que tende a reduzir a recuperação, a prontidão e a tolerância ao esforço.',
    },
  },
  {
    variableId: 'workout.sleepDifficulty', area: 'sleep', name: 'dificuldade para pegar no sono', levelGoodWhen: 'low', trendGoodWhen: 'down',
    scaleText: 'Nesse quesito (dificuldade para pegar no sono, de 1 a 5), números mais perto de 1 significam que você dorme com facilidade; mais perto de 5, que tem muita dificuldade.',
    why: 'Demorar para dormir costuma vir de estresse, excesso de estímulos à noite, treino tarde ou ansiedade, e quando se repete pode encurtar o sono e reduzir a recuperação.',
    meaning: {
      good: 'Por esse parâmetro, você pega no sono com facilidade, o que favorece a recuperação.',
      middle: 'Por esse parâmetro, às vezes você demora para dormir: vale cuidar da rotina da noite para proteger a recuperação.',
      poor: 'Por esse parâmetro, você tem bastante dificuldade para pegar no sono, o que tende a reduzir o tempo de descanso, a prontidão e a tolerância ao esforço.',
    },
  },
  // ------------------------------------------------------------------ Bem-estar
  {
    variableId: 'workout.preMentalFatigue', area: 'wellbeing', name: 'cansaço mental antes do treino', levelGoodWhen: 'low', trendGoodWhen: 'down',
    scaleText: 'Nesse quesito (cansaço mental antes do treino, de 1 a 5), números mais perto de 1 significam que você chega aos treinos com a cabeça descansada; mais perto de 5, com muito cansaço mental.',
    why: 'O cansaço mental pesa na disposição e na qualidade da execução; quando se repete, costuma acompanhar sobrecarga de rotina, estresse ou recuperação insuficiente.',
    meaning: {
      good: 'Por esse parâmetro, você tem chegado aos treinos com boa disposição mental.',
      middle: 'Por esse parâmetro, você chega aos treinos com algum cansaço mental, o que pode reduzir um pouco a disposição.',
      poor: 'Por esse parâmetro, você tem chegado aos treinos com muito cansaço mental, o que costuma reduzir a disposição e a qualidade da execução.',
    },
  },
  {
    variableId: 'workout.preStressLevel', area: 'wellbeing', name: 'nível de estresse', levelGoodWhen: 'low', trendGoodWhen: 'down',
    scaleText: 'Nesse quesito (nível de estresse, de 1 a 5), números mais perto de 1 significam pouco estresse; mais perto de 5, muito estresse.',
    why: 'O estresse do dia a dia soma-se ao do treino: quando fica alto por muito tempo, a recuperação e a tolerância à carga tendem a cair.',
    meaning: {
      good: 'Por esse parâmetro, o seu nível de estresse está baixo, o que favorece a recuperação e a tolerância ao treino.',
      middle: 'Por esse parâmetro, o seu estresse está num nível intermediário: vale observar como ele evolui junto com o sono e a fadiga.',
      poor: 'Por esse parâmetro, o seu estresse está alto, o que tende a reduzir a recuperação e a tolerância à carga de treino.',
    },
  },
  {
    variableId: 'workout.stressEventFrequency', area: 'wellbeing', name: 'momentos de estresse nas últimas 24 horas', levelGoodWhen: 'low', trendGoodWhen: 'down',
    scaleText: 'Nesse quesito (momentos de estresse nas últimas 24 horas, de 1 a 5), números mais perto de 1 significam poucos momentos de estresse; mais perto de 5, muitos.',
    why: 'Muitos momentos de estresse ao longo do dia indicam uma rotina mais pesada, que tende a competir com a recuperação.',
    meaning: {
      good: 'Por esse parâmetro, o seu dia a dia tem tido poucos momentos de estresse.',
      middle: 'Por esse parâmetro, o seu dia a dia tem alguns momentos de estresse, num nível intermediário.',
      poor: 'Por esse parâmetro, o seu dia a dia tem tido muitos momentos de estresse, o que tende a competir com a sua recuperação.',
    },
  },
  {
    variableId: 'workout.preMotivation', area: 'wellbeing', name: 'vontade de treinar', levelGoodWhen: 'high', trendGoodWhen: 'up',
    scaleText: 'Nesse quesito (vontade de treinar, de 1 a 5), números mais perto de 5 significam muita vontade de treinar; mais perto de 1, pouca.',
    why: 'A motivação sustenta a constância, e uma queda prolongada pode acompanhar fadiga, sobrecarga ou mudanças na rotina, entre outras causas.',
    meaning: {
      good: 'Por esse parâmetro, você está com boa vontade de treinar, o que ajuda a manter a constância.',
      middle: 'Por esse parâmetro, a sua vontade de treinar está num nível intermediário.',
      poor: 'Por esse parâmetro, a sua vontade de treinar está baixa, o que pode acompanhar cansaço, sobrecarga ou mudanças na rotina e merece atenção.',
    },
  },
  // ------------------------------------------------------------------ Resposta à carga
  {
    variableId: 'workout.prePhysicalFatigue', area: 'load', name: 'cansaço físico antes do treino', levelGoodWhen: 'low', trendGoodWhen: 'down',
    scaleText: 'Nesse quesito (cansaço físico antes do treino, de 1 a 5), números mais perto de 1 significam que você chega aos treinos com o corpo descansado; mais perto de 5, com muito cansaço.',
    why: 'Chegar com cansaço aos treinos, de forma repetida, costuma indicar recuperação insuficiente entre as sessões e pode aumentar o risco de lesões.',
    meaning: {
      good: 'Por esse parâmetro, você tem chegado aos treinos com o corpo bem recuperado, o que indica boa tolerância à carga.',
      middle: 'Por esse parâmetro, você chega aos treinos com algum cansaço físico: a recuperação entre as sessões está num nível intermediário.',
      poor: 'Por esse parâmetro, você tem chegado aos treinos com muito cansaço físico, o que sugere recuperação insuficiente entre as sessões.',
    },
  },
  {
    variableId: 'workout.postPhysicalFatigue', area: 'load', name: 'cansaço físico provocado pelo treino', levelGoodWhen: null, trendGoodWhen: null,
    scaleText: 'Nesse quesito (cansaço físico provocado pelo treino, de 1 a 5), números mais perto de 5 significam que o treino te deixou com muito cansaço.',
    why: 'Mostra o quanto cada treino pesa no seu corpo; é esperado variar com a intensidade e a duração prescritas.',
    meaning: { neutral: NEUTRAL_FOOTER },
  },
  {
    variableId: 'workout.perceivedEffort', area: 'load', name: 'esforço percebido', levelGoodWhen: null, trendGoodWhen: null,
    scaleText: 'Nesse quesito (esforço percebido, de 1 a 10), números mais perto de 10 significam treinos sentidos como muito difíceis; mais perto de 1, muito leves.',
    why: 'É a sua leitura do esforço de cada treino e, junto com o tempo de treino, compõe a carga interna que usamos para acompanhar a sua resposta ao treinamento. Quem está começando, por ter menor capacidade física, costuma perceber os treinos com esforço maior.',
    meaning: { neutral: NEUTRAL_FOOTER },
    positionMeaning: {
      high: 'Perceber os treinos quase sempre com esforço alto pode indicar boa tolerância ao esforço, mas também que a intensidade está sempre muito forte, o que pode comprometer o seu desenvolvimento no médio e no longo prazo, aumentar o risco de lesões e até levar ao abandono dos treinos.',
      middle: 'Perceber os treinos com esforço intermediário, variando conforme a intenção de cada sessão, é esperado numa preparação que alterna treinos leves, moderados e intensos.',
      low: 'Perceber os treinos quase sempre com esforço baixo pode indicar boa tolerância ao esforço ou treinos mais leves, o que é esperado em fases de base e de recuperação; vale ler junto com o ritmo e com a evolução dos seus treinos.',
    },
    relativeChange: true,
  },
  {
    variableId: 'checkin.weekDemandVsNormal', area: 'load', name: 'exigência da semana comparada ao seu normal', levelGoodWhen: null, trendGoodWhen: null,
    scaleText: 'Nesse quesito (exigência da semana comparada ao seu normal, de 1 a 5), números mais perto de 5 significam semanas sentidas como bem mais exigentes que o normal.',
    why: 'Ajuda a perceber semanas mais pesadas que o habitual, que merecem mais cuidado com o descanso.',
    meaning: { neutral: NEUTRAL_FOOTER },
  },
  // ------------------------------------------------------------------ Aderência
  {
    variableId: 'training.adherencePercent', area: 'adherence', name: 'aderência semanal', levelGoodWhen: 'high', trendGoodWhen: 'up',
    scaleText: 'Nesse quesito (aderência semanal, de 0% a 100%), números mais perto de 100% significam que você tem feito a maior parte dos treinos registrados.',
    why: 'A constância é um dos principais motores da evolução: treinar com regularidade permite que o corpo se adapte de forma segura.',
    meaning: {
      good: 'Por esse parâmetro, você tem sido constante nos treinos, o que favorece a adaptação e a evolução.',
      middle: 'Por esse parâmetro, a sua constância está num nível intermediário: há espaço para consolidar a rotina de treinos.',
      poor: 'Por esse parâmetro, a sua constância tem sido baixa, o que dificulta a adaptação e a evolução; vale entender o que tem atrapalhado a rotina.',
    },
  },
  {
    variableId: 'execution.timeInBandPct', area: 'adherence', name: 'tempo dentro da faixa de ritmo prescrita', levelGoodWhen: 'high', trendGoodWhen: 'up',
    scaleText: 'Nesse quesito (tempo dentro da faixa de ritmo prescrita, de 0% a 100%), números mais perto de 100% significam que você correu quase todo o tempo no ritmo pedido.',
    why: 'Correr no ritmo prescrito é o que dá ao treino o estímulo planejado: nem de menos, nem de mais.',
    meaning: {
      good: 'Por esse parâmetro, você tem executado os treinos de forma fiel ao ritmo prescrito.',
      middle: 'Por esse parâmetro, você tem ficado parte do tempo dentro do ritmo prescrito e parte fora.',
      poor: 'Por esse parâmetro, você tem passado pouco tempo dentro do ritmo prescrito, o que muda o estímulo que o treino pretendia dar.',
    },
  },
  // ------------------------------------------------------------------ Treinamento
  {
    variableId: 'training.volumeCompletedTotalKm', area: 'training', name: 'volume semanal realizado', levelGoodWhen: null, trendGoodWhen: null,
    scaleText: 'Nesse quesito (volume semanal realizado, em quilômetros), números maiores significam mais quilômetros percorridos na semana.',
    why: 'Em geral, correr mais quilômetros por semana tende a levar a melhores resultados, mas também pode trazer maior risco de lesões e de sobrecarga. Por isso não qualificamos o seu volume como bom ou ruim: mostramos o seu padrão e a sua tendência.',
    meaning: {},
    relativeChange: true,
    weekly: { unitLabel: 'semana' },
    phrases: { above: 'aumento do volume', below: 'redução do volume' },
    habitualTemplate: (mean, n) => `A sua tendência de longo prazo é de cerca de ${mean} de volume por semana (${n} semanas completas desde 01/08/2026).`,
  },
  {
    variableId: 'training.volumePrescribedKm', area: 'training', name: 'volume semanal prescrito', levelGoodWhen: null, trendGoodWhen: null,
    scaleText: 'Nesse quesito (volume semanal prescrito, em quilômetros), números maiores significam que o seu programa pediu mais quilômetros na semana.',
    why: 'É o que o programa pediu, não o que você fez: as mudanças aqui vêm das decisões do programa. Não qualificamos o volume: mostramos o padrão e a tendência.',
    meaning: {}, relativeChange: true, weekly: { unitLabel: 'semana' },
    phrases: { above: 'aumento do volume prescrito', below: 'redução do volume prescrito' },
    habitualTemplate: (mean, n) => `O seu programa tem pedido cerca de ${mean} por semana (${n} semanas completas desde 01/08/2026).`,
  },
  {
    variableId: 'training.volumeRatioCompletedPrescribed', area: 'training', name: 'realizado em relação ao prescrito', levelGoodWhen: null, trendGoodWhen: null,
    scaleText: 'Nesse quesito (realizado em relação ao prescrito, em %), 100% significa que você fez exatamente o volume prescrito; mais que isso, mais do que o prescrito; menos, menos do que o prescrito.',
    why: 'Mostra o quanto o que você fez se aproximou do que o programa pediu, semana a semana. Não qualifica: o que importa é o seu padrão e para onde a tendência aponta.',
    meaning: {}, relativeChange: true, weekly: { unitLabel: 'semana' },
    phrases: { above: 'realizado mais acima do prescrito', below: 'realizado mais abaixo do prescrito' },
    habitualTemplate: (mean, n) => `Em média, você realizou ${mean} do volume prescrito (${n} semanas completas desde 01/08/2026).`,
  },
  {
    variableId: 'training.volumeExtraKm', area: 'training', name: 'volume extra semanal', levelGoodWhen: null, trendGoodWhen: null,
    scaleText: 'Nesse quesito (volume extra semanal, em quilômetros), números maiores significam mais quilômetros feitos por iniciativa sua, além do prescrito.',
    why: 'Mostra o quanto você correu além do que o programa pediu. Não qualificamos: mostramos o padrão e a tendência.',
    meaning: {}, relativeChange: true, weekly: { unitLabel: 'semana' },
    phrases: { above: 'aumento dos quilômetros extras', below: 'redução dos quilômetros extras' },
    habitualTemplate: (mean, n) => `Nas semanas em que fez extras, você correu cerca de ${mean} além do prescrito (${n} semanas desde 01/08/2026).`,
  },
  {
    variableId: 'activity.avgPaceSecondsKm', area: 'training', name: 'ritmo médio', levelGoodWhen: null, trendGoodWhen: null,
    scaleText: 'Nesse quesito (ritmo médio, em minutos por quilômetro), números menores significam ritmo mais rápido; maiores, mais lento.',
    why: 'Mostramos apenas a métrica e a tendência, sem avaliar capacidade: o ritmo médio depende do tipo de treino do dia (leve, longo ou intenso). Com o passar do tempo é natural que a média fique mais rápida, mas isso acontece principalmente no longo prazo.',
    meaning: {},
    relativeChange: true,
    phrases: { above: 'ritmo médio mais lento', below: 'ritmo médio mais rápido' },
  },
  // ------------------------------------------------------------------ Sono e recuperação medidos pelo RELÓGIO (14/11/2026: números objetivos + a nossa matemática; só tendência, sem julgar o nível)
  {
    variableId: 'wearable.sleepDurationMin', area: 'sleep', name: 'tempo total de sono (relógio)', levelGoodWhen: null, trendGoodWhen: null, wearable: true, relativeChange: true,
    scaleText: 'Nesse quesito (tempo total de sono medido pelo relógio, em horas), números maiores significam mais horas dormidas por noite.',
    why: 'O tempo de sono é a base da recuperação entre os treinos. O relógio estima esse tempo, então usamos o seu próprio padrão como referência.',
    meaning: { neutral: WATCH_FOOTER }, phrases: { above: 'aumento do tempo de sono', below: 'queda do tempo de sono' },
  },
  {
    variableId: 'wearable.sleepDeepMin', area: 'sleep', name: 'sono profundo (relógio)', levelGoodWhen: null, trendGoodWhen: null, wearable: true, relativeChange: true,
    scaleText: 'Nesse quesito (sono profundo estimado pelo relógio, em horas), números maiores significam mais tempo na fase mais restauradora do sono.',
    why: 'O sono profundo está associado à recuperação física. As fases do sono são estimativas do aparelho, não medidas clínicas, e variam entre marcas.',
    meaning: { neutral: WATCH_FOOTER }, phrases: { above: 'aumento do sono profundo', below: 'queda do sono profundo' },
  },
  {
    variableId: 'wearable.sleepRemMin', area: 'sleep', name: 'sono REM (relógio)', levelGoodWhen: null, trendGoodWhen: null, wearable: true, relativeChange: true,
    scaleText: 'Nesse quesito (sono REM estimado pelo relógio, em horas), números maiores significam mais tempo na fase do sono ligada à recuperação mental e ao aprendizado.',
    why: 'O sono REM está associado à recuperação mental e emocional. As fases do sono são estimativas do aparelho, não medidas clínicas, e variam entre marcas.',
    meaning: { neutral: WATCH_FOOTER }, phrases: { above: 'aumento do sono REM', below: 'queda do sono REM' },
  },
  {
    variableId: 'wearable.hrvLastNightAvg', area: 'sleep', name: 'variabilidade da frequência cardíaca (HRV) da noite', levelGoodWhen: null, trendGoodWhen: null, wearable: true, relativeChange: true,
    scaleText: 'Nesse quesito (variabilidade da frequência cardíaca, HRV, medida pelo relógio durante a noite), a unidade e o método dependem do aparelho, por isso só comparamos com o seu próprio padrão.',
    why: 'A HRV mostra o quanto o intervalo entre os batimentos varia. Em geral, valores acima do seu normal costumam acompanhar boa recuperação, e valores abaixo podem acompanhar cansaço, estresse ou sono ruim, entre outras causas.',
    meaning: { neutral: WATCH_FOOTER }, phrases: { above: 'aumento da HRV', below: 'queda da HRV' },
  },
  {
    variableId: 'wearable.restingHeartRateBpm', area: 'sleep', name: 'frequência cardíaca de repouso (relógio)', levelGoodWhen: null, trendGoodWhen: null, wearable: true, relativeChange: true,
    scaleText: 'Nesse quesito (frequência cardíaca de repouso medida pelo relógio, em batimentos por minuto), números menores significam um coração batendo mais devagar em repouso.',
    why: 'Em geral, a frequência de repouso cai com o melhor condicionamento e com boa recuperação; valores acima do seu normal podem acompanhar cansaço, estresse ou sono ruim, entre outras causas.',
    meaning: { neutral: WATCH_FOOTER }, phrases: { above: 'aumento da frequência de repouso', below: 'queda da frequência de repouso' },
  },
];

export interface AreaReading {
  id: AreaId;
  title: string;
  /** Texto da síntese conforme o predomínio: favorável / misto / atenção. Fixo, igual para todas as alunas. */
  meaning: { favorable: string; mixed: string; attention: string };
}

export const AREA_READING: AreaReading[] = [
  {
    id: 'sleep', title: 'Sono e recuperação',
    meaning: {
      favorable: 'Isso indica que o seu corpo está recuperando bem entre os treinos, o que sustenta a prontidão, a tolerância à carga e a evolução.',
      mixed: 'Isso indica que a sua recuperação está em equilíbrio: há pontos bons e pontos que merecem cuidado para não limitar a prontidão e a evolução.',
      attention: 'Isso indica que a sua recuperação está limitada: com menos descanso, a prontidão e a tolerância ao esforço tendem a cair e a evolução pode ficar mais lenta.',
    },
  },
  {
    id: 'wellbeing', title: 'Bem-estar',
    meaning: {
      favorable: 'Isso indica que a sua disposição e o seu equilíbrio emocional estão favorecendo o treino e a constância.',
      mixed: 'Isso indica que o seu bem-estar tem altos e baixos: vale acompanhar de perto para que a rotina não pese na recuperação.',
      attention: 'Isso indica que a rotina está pesando na sua disposição, o que tende a reduzir a recuperação e a constância se continuar assim.',
    },
  },
  {
    id: 'load', title: 'Resposta à carga',
    meaning: {
      favorable: 'Isso indica que o seu corpo está respondendo bem à carga de treino atual.',
      mixed: 'Isso indica que a resposta à carga está em equilíbrio, com alguns sinais de cansaço que merecem acompanhamento.',
      attention: 'Isso indica que o corpo está tendo dificuldade para se recuperar da carga atual: é um sinal para observar o descanso e como você se sente nos próximos treinos.',
    },
  },
  {
    id: 'adherence', title: 'Aderência',
    meaning: {
      favorable: 'Isso indica que você está sendo constante e fiel ao que foi prescrito, o que favorece a adaptação e a evolução.',
      mixed: 'Isso indica que a sua constância está em equilíbrio: há espaço para consolidar a rotina e a fidelidade ao prescrito.',
      attention: 'Isso indica que a constância ou a fidelidade ao prescrito estão baixas, o que dificulta a adaptação e a evolução.',
    },
  },
  {
    id: 'training', title: 'Evolução do treinamento',
    meaning: {
      favorable: 'Isso indica que a sua preparação está evoluindo de forma consistente.',
      mixed: 'Isso indica que a sua preparação segue em andamento; esses indicadores são acompanhados junto com a intenção de cada treino.',
      attention: 'Isso indica pontos da preparação que merecem atenção; esses indicadores são lidos junto com a intenção de cada treino.',
    },
  },
];
