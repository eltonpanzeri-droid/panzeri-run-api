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
}

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
    why: 'É a sua leitura do esforço de cada treino, e junto com o tempo de treino compõe a carga interna que usamos para acompanhar a sua resposta ao treinamento.',
    meaning: { neutral: NEUTRAL_FOOTER },
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
    why: 'O volume é a base da preparação, mas o que importa é a sua progressão ao longo das semanas, e não um número isolado.',
    meaning: { neutral: NEUTRAL_FOOTER },
  },
  {
    variableId: 'activity.avgPaceSecondsKm', area: 'training', name: 'ritmo médio', levelGoodWhen: null, trendGoodWhen: null,
    scaleText: 'Nesse quesito (ritmo médio, em minutos por quilômetro), números menores significam ritmo mais rápido; maiores, mais lento.',
    why: 'O ritmo médio depende do tipo de treino do dia (leve, longo ou intenso), por isso só diz algo junto com a intenção de cada sessão.',
    meaning: { neutral: NEUTRAL_FOOTER },
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
