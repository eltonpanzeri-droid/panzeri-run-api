import type { AcuteChronic } from './acute-chronic';

// Visão global por domínio (03/11/2026, ordem de Elton): a IA recebe a "fotografia" de cada domínio (sono, recuperação, desgaste físico, psicológico, carga, volume, aderência, eficiência, movimento diário)
// em vez de indicadores soltos. O servidor só DESCREVE (nível, tendência, quantos melhoram/pioram); NÃO existe nota, peso nem regra de decisão: quem decide subir, manter ou reduzir a carga é a IA.
// STATUS: 'rascunho_a_revisar' — direções, faixas favoráveis e textos são metodologia de Elton, redigidos a partir das explicações dele; ele revisa cada linha.
//
// Regras de leitura (Elton): (1) o NÍVEL importa mesmo quando é o padrão do aluno (dormir menos de 7 h é ruim ainda que seja o hábito); (2) a TENDÊNCIA que aproxima o indicador da sua faixa favorável é melhora,
// a que afasta é piora; (3) domínios contam separados, sem peso; (4) ausência nunca vira zero nem "normal"; (5) o aluno só é comparado consigo mesmo na tendência.

export const DOMAIN_OVERVIEW_VERSION = '2026-11-03';
export const DOMAIN_OVERVIEW_STATUS = 'rascunho_a_revisar' as const;

export type DomainId =
  | 'sono'
  | 'recuperacao_medida'
  | 'desgaste_fisico'
  | 'estado_psicologico'
  | 'carga_de_treino'
  | 'volume'
  | 'aderencia_execucao'
  | 'eficiencia_desempenho'
  | 'movimento_diario'
  | 'contexto';

type Zone = { favoravel: [number, number]; desfavoravel: [number, number] };
type Rule =
  | { kind: 'higher_better'; zone?: Zone } // quanto maior, melhor (sono profundo, VFC, motivação...)
  | { kind: 'lower_better'; zone?: Zone } // quanto maior, pior (cansaço, estresse, FC de repouso, carga, desacoplamento...)
  | { kind: 'band'; healthy: [number, number] } // faixa saudável: abaixo dela é desfavorável, dentro é favorável, acima é indefinido (ex.: sono de 7 a 9 h)
  | { kind: 'direction_only' } // subir/cair não é melhora nem piora por si (volume, passos, calorias)
  | { kind: 'context' }; // contexto para a IA entender o treino (elevação, potência...)

// Escalas de 1 a 5: 4–5 é o extremo favorável de "quanto maior melhor"; 1–2 é o favorável de "quanto menor melhor".
const H5: Rule = { kind: 'higher_better', zone: { favoravel: [4, 5], desfavoravel: [1, 2] } };
const L5: Rule = { kind: 'lower_better', zone: { favoravel: [1, 2], desfavoravel: [4, 5] } };
const H: Rule = { kind: 'higher_better' };
const L: Rule = { kind: 'lower_better' };
const DIR: Rule = { kind: 'direction_only' };
const CTX: Rule = { kind: 'context' };

interface IndicatorSpec {
  domain: DomainId;
  rule: Rule;
}

export const INDICATOR_SPECS: Record<string, IndicatorSpec> = {
  // Sono relatado
  'workout.preSleepQuality': { domain: 'sono', rule: H5 },
  'workout.sleepDurationHoursEstimate': { domain: 'sono', rule: { kind: 'band', healthy: [7, 9] } },
  'workout.sleepInterruption': { domain: 'sono', rule: L5 },
  'workout.sleepDifficulty': { domain: 'sono', rule: L5 },
  // Sono medido
  'wearable.sleepDurationMin': { domain: 'sono', rule: { kind: 'band', healthy: [420, 540] } },
  'wearable.sleepDeepMin': { domain: 'sono', rule: H },
  'wearable.sleepRemMin': { domain: 'sono', rule: H },
  'wearable.sleepAwakeMin': { domain: 'sono', rule: L },
  'wearable.sleepScore': { domain: 'sono', rule: H },
  'wearable.sleepLightMin': { domain: 'sono', rule: CTX },
  'wearable.napTotalMin': { domain: 'sono', rule: CTX },
  // Recuperação medida
  'wearable.hrvLastNightAvg': { domain: 'recuperacao_medida', rule: H },
  'wearable.restingHeartRateBpm': { domain: 'recuperacao_medida', rule: L },
  // Desgaste físico
  'workout.prePhysicalFatigue': { domain: 'desgaste_fisico', rule: L5 },
  'workout.postPhysicalFatigue': { domain: 'desgaste_fisico', rule: L5 },
  'checkin.bodyResponseVsNormal': { domain: 'desgaste_fisico', rule: H5 },
  // Estado psicológico
  'workout.preMentalFatigue': { domain: 'estado_psicologico', rule: L5 },
  'workout.postMentalFatigue': { domain: 'estado_psicologico', rule: L5 },
  'workout.preStressLevel': { domain: 'estado_psicologico', rule: L5 },
  'workout.stressEventFrequency': { domain: 'estado_psicologico', rule: L5 },
  'workout.preMotivation': { domain: 'estado_psicologico', rule: H5 },
  'workout.emotionalExperienceDuring': { domain: 'estado_psicologico', rule: H5 },
  'workout.mentalStateChangePrePost': { domain: 'estado_psicologico', rule: H5 },
  'checkin.postWeekMotivation': { domain: 'estado_psicologico', rule: H5 },
  'workout.satisfactionElaboracao': { domain: 'estado_psicologico', rule: H5 },
  'checkin.prescriptionLiking': { domain: 'estado_psicologico', rule: H5 },
  'checkin.prescriptionSuitability': { domain: 'estado_psicologico', rule: H5 },
  'checkin.executionSatisfaction': { domain: 'estado_psicologico', rule: H5 },
  // Carga: sair do habitual para cima = mais desgaste e menor prontidão; reduzir = mais apto a evoluir
  'workout.perceivedEffort': { domain: 'carga_de_treino', rule: L },
  'workout.sessionInternalLoad': { domain: 'carga_de_treino', rule: L },
  'workout.weeklyInternalLoad': { domain: 'carga_de_treino', rule: L },
  'checkin.weekDemandVsNormal': { domain: 'carga_de_treino', rule: L },
  'training.acwr': { domain: 'carga_de_treino', rule: L },
  'workout.sessionDurationUsedMin': { domain: 'carga_de_treino', rule: CTX },
  // Volume
  'training.volumePrescribedKm': { domain: 'volume', rule: DIR },
  'training.volumeCompletedTotalKm': { domain: 'volume', rule: DIR },
  'training.volumeCompletedPrescribedOnlyKm': { domain: 'volume', rule: DIR },
  'training.volumeExtraKm': { domain: 'volume', rule: CTX },
  'training.volumeDiffAbsoluteKm': { domain: 'volume', rule: CTX },
  'training.volumeRatioCompletedPrescribed': { domain: 'volume', rule: CTX },
  // Aderência e execução
  'training.adherencePercent': { domain: 'aderencia_execucao', rule: H },
  'execution.timeInBandPct': { domain: 'aderencia_execucao', rule: H },
  'execution.distanceCompletionRatio': { domain: 'aderencia_execucao', rule: CTX },
  'execution.intervalStructureMatch': { domain: 'aderencia_execucao', rule: CTX },
  // Eficiência e desempenho
  'activity.avgPaceSecondsKm': { domain: 'eficiencia_desempenho', rule: L }, // segundos por km: menor = mais rápido
  'activity.weeklyAvgPaceSecondsKm': { domain: 'eficiencia_desempenho', rule: L },
  'activity.cadenceAvg': { domain: 'eficiencia_desempenho', rule: H },
  'activity.avgHeartRateBpm': { domain: 'eficiencia_desempenho', rule: L },
  'execution.avgHeartRateInBandBpm': { domain: 'eficiencia_desempenho', rule: L },
  'activity.hrDecoupling.d30': { domain: 'eficiencia_desempenho', rule: L },
  'activity.hrDecoupling.d60': { domain: 'eficiencia_desempenho', rule: L },
  'activity.hrDecoupling.d90': { domain: 'eficiencia_desempenho', rule: L },
  'activity.hrDecoupling.d120': { domain: 'eficiencia_desempenho', rule: L },
  'activity.hrDecoupling.d150': { domain: 'eficiencia_desempenho', rule: L },
  'activity.powerAvgWatts': { domain: 'eficiencia_desempenho', rule: CTX },
  'activity.elevationGainMeters': { domain: 'contexto', rule: CTX },
  // Movimento diário
  'wearable.dailySteps': { domain: 'movimento_diario', rule: DIR },
  'wearable.dailyActiveKcal': { domain: 'movimento_diario', rule: DIR },
};

const SLEEP_LIKE_READING =
  'Nível desfavorável (mesmo sendo o padrão do aluno) e/ou tendência de piora indicam queda de qualidade: menor prontidão para o treino, menor recuperação, menor tolerância ao esforço e a cargas maiores, mais risco de lesão, menor aderência ao treino e menor chance de seguir orientação alimentar. Quanto mais indicadores pioram e maior a magnitude, mais isso se confirma. O inverso vale para melhora.';

export const DOMAIN_READINGS: Record<DomainId, { rotulo: string; leitura: string }> = {
  sono: { rotulo: 'Sono', leitura: SLEEP_LIKE_READING },
  recuperacao_medida: { rotulo: 'Recuperação medida pelo relógio (VFC da noite, FC de repouso)', leitura: 'Mesma lógica do sono. ' + SLEEP_LIKE_READING },
  desgaste_fisico: { rotulo: 'Desgaste físico (cansaço e resposta do corpo)', leitura: 'Mesma lógica do sono. ' + SLEEP_LIKE_READING },
  estado_psicologico: { rotulo: 'Estado psicológico', leitura: 'Mesma lógica do sono. ' + SLEEP_LIKE_READING },
  carga_de_treino: {
    rotulo: 'Carga de treino percebida',
    leitura: 'Quando a carga foge do habitual para cima, o aluno tende a estar em maior desgaste e menor prontidão; quando reduz, tende a estar mais apto a evoluir.',
  },
  volume: {
    rotulo: 'Volume',
    leitura:
      'Volume prescrito ou realizado em alta indica avanço de carga, mas pode estar acumulando cansaço: confirme se os outros domínios começaram a piorar. Em queda, pode ser fase de absorção ou de melhora em outros indicadores. Volume extra muito acima da variação normal do aluno (referência: cerca de 50% acima) pode indicar baixa aderência ao plano; a diferença e a razão realizado/prescrito ajudam a medir.',
  },
  aderencia_execucao: {
    rotulo: 'Aderência e execução',
    leitura: 'Mais aderência e mais tempo dentro da faixa prescrita indicam mais chance de evolução, boa recuperação e segurança: o caminho parece estar agradando e trazendo resultado.',
  },
  eficiencia_desempenho: {
    rotulo: 'Eficiência e desempenho (ritmo, cadência, FC média, desacoplamento)',
    leitura:
      'Ritmo médio, no longo prazo, mostra melhora ou piora; na comparação aguda × crônica mostra maior desgaste recente ou alívio (depende da estrutura dos treinos). Cadência subindo pode indicar maior eficiência mecânica. FC média da atividade mais alta que o padrão do aluno indica maior desgaste; mais baixa, melhor aceitação da carga (mesmo com interferências, some ao conjunto). Desacoplamento da FC maior, ou em tendência de aumento, indica provável maior desgaste para sustentar a segunda metade e possível perda de eficiência mecânica; não significa, por si só, pior desempenho. Em tendência de redução, menor desgaste.',
  },
  movimento_diario: {
    rotulo: 'Movimento diário (passos e calorias ativas)',
    leitura:
      'Mais passos e calorias ativas indicam menos sedentarismo e, em geral, melhor saúde, mas podem gerar maior desgaste físico; o total do dia é o que vale. Aumento muito fora do normal tende a trazer desgaste agudo; aumento crônico exige ver se outros indicadores corroboram mais desgaste. Queda aguda ou crônica, sem outra evidência, pode significar corpo mais descansado.',
  },
  contexto: { rotulo: 'Contexto do treino', leitura: 'Dado neutro: serve para a IA entender se o desgaste do treino se explica por um fator do percurso fora do habitual do aluno.' },
};

export type Nivel = 'favoravel' | 'intermediario' | 'desfavoravel' | 'indefinido';
export type Tendencia = 'melhorando' | 'piorando' | 'estavel' | 'indefinido' | 'sem_comparacao' | 'subindo' | 'caindo';

export interface OverviewIndicatorInput {
  variableId: string;
  acuteChronic: AcuteChronic | null | undefined;
}

export interface OverviewRow {
  id: string;
  aguda?: number;
  cronica?: number;
  nivel?: Nivel;
  tendencia: Tendencia;
  diferencaPct?: number;
  foraDaFaixaHabitual?: 'acima' | 'abaixo';
}

const round = (value: number, decimals = 2) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const inRange = (value: number, [min, max]: [number, number]) => value >= min && value <= max;
const gap = (value: number, [min, max]: [number, number]) => (value < min ? min - value : value > max ? value - max : 0);

function levelOf(rule: Rule, acute: number): Nivel | undefined {
  if (rule.kind === 'band') return acute < rule.healthy[0] ? 'desfavoravel' : acute <= rule.healthy[1] ? 'favoravel' : 'indefinido';
  if ((rule.kind === 'higher_better' || rule.kind === 'lower_better') && rule.zone) {
    if (inRange(acute, rule.zone.favoravel)) return 'favoravel';
    if (inRange(acute, rule.zone.desfavoravel)) return 'desfavoravel';
    return 'intermediario';
  }
  return undefined;
}

function trendOf(rule: Rule, acuteChronic: AcuteChronic): Tendencia {
  if (acuteChronic.direction === 'insufficient') return 'sem_comparacao';
  if (acuteChronic.direction === 'equal') return 'estavel';
  const up = acuteChronic.direction === 'acute_above';
  const acute = acuteChronic.acute.value as number;
  const chronic = acuteChronic.chronic.value as number;
  switch (rule.kind) {
    case 'higher_better': return up ? 'melhorando' : 'piorando';
    case 'lower_better': return up ? 'piorando' : 'melhorando';
    case 'band': {
      if (acute > rule.healthy[1] || chronic > rule.healthy[1]) return 'indefinido'; // acima da faixa saudável: indefinido (Elton)
      const dAcute = gap(acute, rule.healthy);
      const dChronic = gap(chronic, rule.healthy);
      return dAcute < dChronic ? 'melhorando' : dAcute > dChronic ? 'piorando' : 'estavel';
    }
    default: return up ? 'subindo' : 'caindo';
  }
}

export function buildOverviewRow(variableId: string, acuteChronic: AcuteChronic | null | undefined): { domain: DomainId; row: OverviewRow } | null {
  const spec = INDICATOR_SPECS[variableId];
  if (!spec || !acuteChronic) return null;
  const acuteValue = acuteChronic.acute.complete ? acuteChronic.acute.value : null;
  const chronicValue = acuteChronic.chronic.complete ? acuteChronic.chronic.value : null;
  if (acuteValue == null && chronicValue == null) return null; // sem dado suficiente: ausência nunca vira zero nem "normal"
  const comparable = acuteChronic.direction !== 'insufficient' && acuteValue != null && chronicValue != null;
  const row: OverviewRow = {
    id: variableId,
    ...(acuteValue != null ? { aguda: round(acuteValue) } : {}),
    ...(chronicValue != null ? { cronica: round(chronicValue) } : {}),
    tendencia: comparable ? trendOf(spec.rule, acuteChronic) : 'sem_comparacao',
  };
  const nivel = acuteValue != null ? levelOf(spec.rule, acuteValue) : undefined;
  if (nivel) row.nivel = nivel;
  if (comparable && acuteChronic.relativeDifferencePct != null) row.diferencaPct = round(acuteChronic.relativeDifferencePct, 1);
  if (acuteChronic.acuteVsHabitualRange === 'above') row.foraDaFaixaHabitual = 'acima';
  else if (acuteChronic.acuteVsHabitualRange === 'below') row.foraDaFaixaHabitual = 'abaixo';
  return { domain: spec.domain, row };
}

export interface DomainCount {
  melhorando: number;
  piorando: number;
  estaveis: number;
  nivelFavoravel: number;
  nivelDesfavoravel: number;
}

const DIRECTIONAL: Tendencia[] = ['melhorando', 'piorando', 'estavel'];

/** Contagem descritiva (NÃO é nota nem peso): só indicadores com direção definida (melhor/pior) entram. */
export function countRows(rows: OverviewRow[]): DomainCount {
  return {
    melhorando: rows.filter((r) => r.tendencia === 'melhorando').length,
    piorando: rows.filter((r) => r.tendencia === 'piorando').length,
    estaveis: rows.filter((r) => r.tendencia === 'estavel').length,
    nivelFavoravel: rows.filter((r) => r.nivel === 'favoravel').length,
    nivelDesfavoravel: rows.filter((r) => r.nivel === 'desfavoravel').length,
  };
}

function snapshotText(rotulo: string, rows: OverviewRow[], count: DomainCount): string {
  const directional = rows.filter((r) => DIRECTIONAL.includes(r.tendencia)).length;
  const levels = rows.filter((r) => r.nivel).length;
  const parts: string[] = [];
  if (directional > 0) parts.push(`tendência: ${count.piorando} piorando, ${count.melhorando} melhorando, ${count.estaveis} estáveis (de ${directional} com comparação)`);
  if (levels > 0) parts.push(`nível atual: ${count.nivelDesfavoravel} desfavorável, ${count.nivelFavoravel} favorável (de ${levels} com faixa definida)`);
  if (parts.length === 0) parts.push('sem indicador com direção definida; leia como contexto');
  return `${rotulo} — ${parts.join('; ')}`;
}

export interface DomainBlock {
  dominio: DomainId;
  leituraDoDominio: string;
  fotografia: string;
  contagem: DomainCount;
  indicadores: OverviewRow[];
}

function assemble(rowsByDomain: Map<DomainId, OverviewRow[]>): DomainBlock[] {
  const order = Object.keys(DOMAIN_READINGS) as DomainId[];
  return order
    .filter((domain) => (rowsByDomain.get(domain) ?? []).length > 0)
    .map((domain) => {
      const rows = rowsByDomain.get(domain) as OverviewRow[];
      const count = countRows(rows);
      return { dominio: domain, leituraDoDominio: DOMAIN_READINGS[domain].leitura, fotografia: snapshotText(DOMAIN_READINGS[domain].rotulo, rows, count), contagem: count, indicadores: rows };
    });
}

/** Bloco `visaoGlobalPorDominio`. null = nenhum indicador com dado suficiente. Nunca gera nota: só nível, tendência e contagem descritiva por domínio. */
export function buildDomainOverview(indicators: OverviewIndicatorInput[]) {
  const rowsByDomain = new Map<DomainId, OverviewRow[]>();
  for (const { variableId, acuteChronic } of indicators) {
    const built = buildOverviewRow(variableId, acuteChronic);
    if (!built) continue;
    rowsByDomain.set(built.domain, [...(rowsByDomain.get(built.domain) ?? []), built.row]);
  }
  const dominios = assemble(rowsByDomain);
  if (dominios.length === 0) return null;
  return {
    comoLer:
      'Fotografia GLOBAL por domínio, já calculada pelo sistema (você não calcula). Cada indicador traz o nível atual (média dos 7 registros mais recentes — "aguda") quando existe faixa favorável definida, e a tendência em relação à média dos 28 ("crônica"): melhorando = a média aguda se aproxima da faixa favorável do indicador, piorando = se afasta, estável = igual, sem_comparacao = menos de 28 registros, indefinido = fora da faixa saudável para cima (ex.: mais de 9 h de sono). Nível e tendência valem juntos: nível desfavorável conta mesmo quando é o padrão do aluno. subindo/caindo = dado sem sentido de melhora ou piora por si. Domínio ausente = sem dados suficientes, nunca zero nem normal. Os domínios contam separados, sem peso e sem nota.',
    dominios,
  };
}

export type DomainOverviewContext = NonNullable<ReturnType<typeof buildDomainOverview>>;

const isIntegrationOverviewId = (id: string) => id.startsWith('wearable.') || id.startsWith('activity.');

/** Teto de tamanho: tira os indicadores de integração (relógio/atividade) e recalcula as contagens dos domínios que sobram. Null se nada restar. */
export function withoutIntegrationIndicators(block: DomainOverviewContext): DomainOverviewContext | null {
  const rowsByDomain = new Map<DomainId, OverviewRow[]>();
  for (const domain of block.dominios) {
    const rows = domain.indicadores.filter((row) => !isIntegrationOverviewId(row.id));
    if (rows.length > 0) rowsByDomain.set(domain.dominio, rows);
  }
  const dominios = assemble(rowsByDomain);
  return dominios.length > 0 ? { ...block, dominios } : null;
}

/** Ids extras que a visão global precisa e que não estão nas listas de domínio do snapshot (atividade objetiva e a carga interna semanal/duração da sessão — 03/11/2026, ordem de Elton: usar todos os indicadores). */
export const OVERVIEW_EXTRA_VARIABLE_IDS = [
  'activity.avgPaceSecondsKm',
  'activity.weeklyAvgPaceSecondsKm',
  'activity.cadenceAvg',
  'activity.avgHeartRateBpm',
  'activity.powerAvgWatts',
  'activity.elevationGainMeters',
  'workout.sessionDurationUsedMin',
  'workout.weeklyInternalLoad',
] as const;
