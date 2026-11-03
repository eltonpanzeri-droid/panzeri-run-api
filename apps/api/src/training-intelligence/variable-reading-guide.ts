// Cadastro de leitura por indicador (03/11/2026, ordem de Elton): o que costuma significar quando a média AGUDA (7 registros mais recentes) fica ACIMA ou ABAIXO da CRÔNICA (28 mais recentes).
// Existe para o agente e a tela partirem de uma direção de leitura em vez de considerar todas as hipóteses possíveis; a incerteza diminui, não some.
//
// STATUS: 'rascunho_a_revisar' — redigido por Claude, é METODOLOGIA de Elton: ele revisa cada linha antes de valer como regra, e o advogado revisa o que for mostrado à aluna. Cada frase é a leitura
// MAIS PROVÁVEL, nunca causa direta nem diagnóstico, e pode ser contrariada pelos demais sinais. Indicador sem cadastro simplesmente não traz leitura (só os números).
// Versione/date qualquer troca de leitura (interpretações são datadas e substituíveis; o histórico de dados não muda).

export type ReadingGuideStatus = 'rascunho_a_revisar' | 'revisado';

export interface ReadingGuideEntry {
  /** Aguda acima da crônica. */
  above: string;
  /** Aguda abaixo da crônica. */
  below: string;
}

export const READING_GUIDE_VERSION = '2026-11-03';
export const READING_GUIDE_STATUS: ReadingGuideStatus = 'rascunho_a_revisar';

const DECOUPLING: ReadingGuideEntry = {
  above: 'a frequência cardíaca está subindo mais na segunda metade das corridas desta faixa do que o habitual: mais custo cardiovascular para sustentar o ritmo; se se repetir, sugere recuperação menor e queda de prontidão',
  below: 'a frequência cardíaca está subindo menos na segunda metade das corridas desta faixa do que o habitual: menos custo para sustentar o ritmo; sozinho, não indica melhora de desempenho',
};

export const READING_GUIDE: Record<string, ReadingGuideEntry> = {
  // Sono relatado
  'workout.preSleepQuality': { above: 'sono recente percebido como melhor que o habitual', below: 'sono recente percebido como pior que o habitual: a recuperação pode estar menor' },
  'workout.sleepDurationHoursEstimate': { above: 'dormindo mais que o habitual (pode refletir maior necessidade de recuperação ou período mais leve)', below: 'dormindo menos que o habitual: pode reduzir a recuperação' },
  'workout.sleepInterruption': { above: 'sono mais interrompido que o habitual: menos reparador', below: 'sono menos interrompido que o habitual' },
  'workout.sleepDifficulty': { above: 'mais dificuldade para pegar no sono que o habitual (estresse, ansiedade, treino tarde são causas possíveis)', below: 'menos dificuldade para dormir que o habitual' },
  // Sono medido pelo relógio
  'wearable.sleepDurationMin': { above: 'o relógio registra mais sono que o habitual', below: 'o relógio registra menos sono que o habitual: pode reduzir a recuperação' },
  'wearable.sleepDeepMin': { above: 'mais sono profundo que o habitual segundo o relógio', below: 'menos sono profundo que o habitual segundo o relógio (a medida varia por aparelho)' },
  'wearable.sleepScore': { above: 'pontuação de sono do aparelho acima do habitual', below: 'pontuação de sono do aparelho abaixo do habitual (cada fabricante calcula a sua)' },
  // Recuperação medida
  'wearable.hrvLastNightAvg': { above: 'variabilidade cardíaca acima do habitual: costuma acompanhar boa recuperação (outras causas são possíveis)', below: 'variabilidade cardíaca abaixo do habitual: costuma acompanhar recuperação reduzida, estresse, doença ou carga acumulada' },
  'wearable.restingHeartRateBpm': { above: 'frequência cardíaca de repouso acima do habitual: costuma acompanhar fadiga acumulada, estresse, doença ou calor', below: 'frequência cardíaca de repouso abaixo do habitual: costuma acompanhar boa recuperação' },
  // Fadiga, estresse e motivação relatados
  'workout.prePhysicalFatigue': { above: 'chegando aos treinos com mais cansaço físico que o habitual', below: 'chegando aos treinos com menos cansaço físico que o habitual' },
  'workout.postPhysicalFatigue': { above: 'saindo dos treinos com mais cansaço físico que o habitual', below: 'saindo dos treinos com menos cansaço físico que o habitual' },
  'workout.preMentalFatigue': { above: 'chegando aos treinos com mais cansaço mental que o habitual', below: 'chegando aos treinos com menos cansaço mental que o habitual' },
  'workout.postMentalFatigue': { above: 'saindo dos treinos com mais cansaço mental que o habitual', below: 'saindo dos treinos com menos cansaço mental que o habitual' },
  'workout.preStressLevel': { above: 'estresse relatado acima do habitual', below: 'estresse relatado abaixo do habitual' },
  'workout.stressEventFrequency': { above: 'mais eventos de estresse que o habitual', below: 'menos eventos de estresse que o habitual' },
  'workout.preMotivation': { above: 'motivação acima do habitual', below: 'motivação abaixo do habitual (pode acompanhar fadiga ou sobrecarga, entre outras causas)' },
  // Esforço e carga
  'workout.perceivedEffort': { above: 'treinos percebidos como mais difíceis que o habitual (intensidade maior, fadiga ou recuperação menor são possibilidades)', below: 'treinos percebidos como mais leves que o habitual' },
  'workout.sessionInternalLoad': { above: 'carga de cada treino acima do habitual', below: 'carga de cada treino abaixo do habitual' },
  'workout.weeklyInternalLoad': { above: 'semanas com carga acima do habitual', below: 'semanas com carga abaixo do habitual' },
  'checkin.weekDemandVsNormal': { above: 'semanas sentidas como mais exigentes que o normal', below: 'semanas sentidas como menos exigentes que o normal' },
  // Volume e aderência
  'training.volumeCompletedTotalKm': { above: 'volume semanal recente acima do habitual (aumento de carga)', below: 'volume semanal recente abaixo do habitual (folga, interrupção ou redução)' },
  'training.adherencePercent': { above: 'mais treinos feitos entre os registrados do que o habitual', below: 'menos treinos feitos entre os registrados do que o habitual' },
  // Objetivas de atividade
  'activity.avgPaceSecondsKm': { above: 'ritmo médio mais lento que o habitual (segundos por km maiores); depende da intenção dos treinos', below: 'ritmo médio mais rápido que o habitual (segundos por km menores); depende da intenção dos treinos' },
  'activity.weeklyAvgPaceSecondsKm': { above: 'ritmo médio semanal mais lento que o habitual', below: 'ritmo médio semanal mais rápido que o habitual' },
  'activity.avgHeartRateBpm': { above: 'frequência cardíaca média das atividades acima do habitual (intensidade maior, calor, fadiga ou outros fatores)', below: 'frequência cardíaca média das atividades abaixo do habitual' },
  'execution.timeInBandPct': { above: 'mais tempo dentro da faixa de ritmo prescrita que o habitual: execução mais fiel ao prescrito', below: 'menos tempo dentro da faixa de ritmo prescrita que o habitual' },
  // Desacoplamento da frequência cardíaca (uma entrada por faixa de duração)
  'activity.hrDecoupling.d30': DECOUPLING,
  'activity.hrDecoupling.d60': DECOUPLING,
  'activity.hrDecoupling.d90': DECOUPLING,
  'activity.hrDecoupling.d120': DECOUPLING,
  'activity.hrDecoupling.d150': DECOUPLING,
};

export function readingFor(variableId: string, direction: 'acute_above' | 'acute_below'): { text: string; status: ReadingGuideStatus } | null {
  const entry = READING_GUIDE[variableId];
  if (!entry) return null;
  return { text: direction === 'acute_above' ? entry.above : entry.below, status: READING_GUIDE_STATUS };
}
