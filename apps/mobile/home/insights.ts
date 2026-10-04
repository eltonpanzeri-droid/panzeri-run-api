// Interpretacao textual DETERMINISTICA das series longitudinais (04/10/2026). Funcoes PURAS (sem
// React Native, sem LLM): traduzem em frases os calculos que o backend JA entrega
// (GET /me/observations/:variableId -> VariableSnapshotResponse: tendencia, media movel, faixa
// habitual, variabilidade). Nada e' recalculado aqui — so' selecao + redacao.
//
// Regras: nunca afirma causalidade; nunca nota/"bom/ruim"; escala original preservada (5 = mais do
// construto, nao "melhor"); evidencia insuficiente => frase de insuficiencia ou nenhuma frase.
// Home e telas de dominio usam ESTAS mesmas funcoes, para nunca contradizerem uma a outra.

export interface SnapshotLite {
  variable: { id?: string; dataType?: string; constructLabel?: string; scale?: { min: number; max: number; unit?: string } };
  mathApplicable: boolean;
  current: number | null;
  movingAverages?: Record<string, { value: number | null; n: number; isPartialWindow?: boolean }> | null;
  movingAverageSeries?: Record<string, Array<{ timestamp: string; value: number | null }>> | null;
  baseline?: { value: number | null; n: number } | null;
  deviation?: { absoluteDeviation: number | null; relativeDeviation: number | null } | null;
  trend: Record<string, { direction: string; n?: number }> | null;
  habitualRange?: { lower: number | null; upper: number | null; median: number | null; n: number; isPartialWindow?: boolean } | null;
  variabilityChange?: { direction: string } | null;
  persistence?: { currentlyOutsideHabitualRange: boolean | null; direction?: 'above' | 'below' | null } | null;
  observations: Array<{ timestamp: string; value: number | string; context?: { modality?: string; activityLogId?: string } | null }>;
  evidence: { n: number };
}

// SUFICIENCIA DE EVIDENCIA pertence ao motor longitudinal, nunca a este arquivo. Sinais canonicos
// usados aqui (sem nenhum limite proprio de n):
//   - trend.direction === 'insufficient_data'  -> motor nao sustenta tendencia;
//   - persistence.currentlyOutsideHabitualRange === null -> motor nao sustenta faixa habitual
//     (sem observacoes / sem limites);
//   - variabilityChange.direction === 'insufficient_data' -> motor nao sustenta variabilidade.
// n e isPartialWindow vem do motor e sao apenas COMUNICADOS (transparencia), nunca usados como porta.

export interface Descriptor {
  /** Rotulo ja' capitalizado do que e' medido, ex.: "Qualidade do sono". */
  label: string;
  fmt: (v: number) => string;
}

export function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

const TREND_WINDOW_LABEL: Record<string, string> = { short_21d: 'nas últimas 3 semanas', medium_60d: 'nos últimos 2 meses' };

/** Tendencia — a mesma frase usada na Home e nas telas de dominio. Null quando nao ha evidencia. */
export function trendSentence(snapshot: SnapshotLite | null | undefined, d: Descriptor): string | null {
  if (!snapshot || !snapshot.mathApplicable || !snapshot.trend) return null;
  for (const key of ['short_21d', 'medium_60d']) {
    const t = snapshot.trend[key];
    if (!t || t.direction === 'insufficient_data') continue;
    const when = TREND_WINDOW_LABEL[key];
    if (t.direction === 'stable') return `${d.label} permaneceu estável ${when}.`;
    if (t.direction === 'increasing') return `${d.label} apresenta tendência de aumento ${when}.`;
    if (t.direction === 'decreasing') return `${d.label} apresenta tendência de queda ${when}.`;
  }
  return null;
}

/**
 * Veredito do MOTOR sobre o ultimo registro x faixa habitual individual. Quem decide se ha evidencia
 * e' o motor (persistence.currentlyOutsideHabitualRange === null => sem faixa sustentada); aqui so'
 * se le o resultado — nenhuma comparacao propria entre current e os limites.
 */
export function engineRangeVerdict(snapshot: SnapshotLite | null | undefined): { verdict: 'above' | 'below' | 'within'; lower: number; upper: number; n: number; isPartialWindow: boolean } | null {
  if (!snapshot || !snapshot.mathApplicable || snapshot.current == null) return null;
  const range = snapshot.habitualRange;
  const persistence = snapshot.persistence;
  if (!range || range.lower == null || range.upper == null || !persistence || persistence.currentlyOutsideHabitualRange == null) return null;
  const verdict = persistence.currentlyOutsideHabitualRange ? (persistence.direction === 'below' ? 'below' : 'above') : 'within';
  return { verdict, lower: range.lower, upper: range.upper, n: range.n, isPartialWindow: range.isPartialWindow === true };
}

/** Faixa habitual para desenhar no grafico — so' quando o motor a sustenta. */
export function habitualBand(snapshot: SnapshotLite | null | undefined): { lower: number; upper: number; label: string } | undefined {
  const v = engineRangeVerdict(snapshot);
  return v ? { lower: v.lower, upper: v.upper, label: 'faixa habitual' } : undefined;
}

function basisNote(n: number, isPartialWindow: boolean): string {
  return `calculada com ${n} registro${n === 1 ? '' : 's'}${isPartialWindow ? ', histórico ainda curto' : ''}`;
}

/** Ultimo valor x faixa habitual individual (P10-P90 da janela longa, calculada pelo motor). */
export function habitualRangeSentence(snapshot: SnapshotLite | null | undefined, d: Descriptor): string | null {
  const v = engineRangeVerdict(snapshot);
  if (!v || !snapshot || snapshot.current == null) return null;
  const faixa = `${d.fmt(v.lower)}–${d.fmt(v.upper)}, ${basisNote(v.n, v.isPartialWindow)}`;
  if (v.verdict === 'above') return `${d.label}: o último registro (${d.fmt(snapshot.current)}) ficou acima da sua faixa habitual (${faixa}).`;
  if (v.verdict === 'below') return `${d.label}: o último registro (${d.fmt(snapshot.current)}) ficou abaixo da sua faixa habitual (${faixa}).`;
  return `${d.label}: o último registro (${d.fmt(snapshot.current)}) está dentro da sua faixa habitual (${faixa}).`;
}

// Chips curtos dos cards da Home — MESMAS regras de evidencia das frases (nunca divergem).
export function trendChip(snapshot: SnapshotLite | null | undefined): string | null {
  if (!snapshot || !snapshot.mathApplicable || !snapshot.trend) return null;
  for (const key of ['short_21d', 'medium_60d']) {
    const t = snapshot.trend[key];
    if (!t || t.direction === 'insufficient_data') continue;
    if (t.direction === 'stable') return 'estável';
    if (t.direction === 'increasing') return 'em aumento';
    if (t.direction === 'decreasing') return 'em queda';
  }
  return null;
}

export function rangeChip(snapshot: SnapshotLite | null | undefined): string | null {
  const v = engineRangeVerdict(snapshot);
  if (!v) return null;
  return v.verdict === 'above' ? 'acima da faixa habitual' : v.verdict === 'below' ? 'abaixo da faixa habitual' : 'na faixa habitual';
}

export function variabilitySentence(snapshot: SnapshotLite | null | undefined, d: Descriptor): string | null {
  const dir = snapshot?.variabilityChange?.direction;
  if (dir === 'increased') return `${d.label} está oscilando mais do que o habitual recentemente.`;
  if (dir === 'decreased') return `${d.label} está oscilando menos do que o habitual recentemente.`;
  return null;
}

/** Frases de uma variavel, sem repetir a mesma ideia: tendencia + faixa habitual + variabilidade. */
export function describeVariable(snapshot: SnapshotLite | null | undefined, d: Descriptor): string[] {
  if (!snapshot || snapshot.evidence.n === 0) return [];
  if (!snapshot.mathApplicable) return [];
  const out = [trendSentence(snapshot, d), habitualRangeSentence(snapshot, d), variabilitySentence(snapshot, d)].filter((s): s is string => s != null);
  if (out.length === 0) {
    return [`${d.label}: ainda não há evidência suficiente (${snapshot.evidence.n} registro${snapshot.evidence.n === 1 ? '' : 's'}) para indicar tendência ou faixa habitual.`];
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Volume — a partir das semanas que o backend ja' entrega (overview) + snapshot do volume.
// ---------------------------------------------------------------------------------------------

export interface WeekVolumeLite {
  weekStart: string;
  kmPercorridos: number | null;
  kmPrescritos: number | null;
  kmExtras: number | null;
}

const fmtKm = (v: number) => `${(Math.round(v * 10) / 10).toString().replace('.', ',')} km`;

function isCurrentWeek(weekStart: string, todayIso: string): boolean {
  const start = new Date(weekStart + 'T00:00:00Z').getTime();
  const today = new Date(todayIso + 'T00:00:00Z').getTime();
  return today >= start && today < start + 7 * 86400000;
}

export function volumeSentences(weeks: WeekVolumeLite[], todayIso: string, volumeSnapshot?: SnapshotLite | null): string[] {
  const out: string[] = [];
  const completed = weeks.filter((w) => !isCurrentWeek(w.weekStart, todayIso) && w.kmPercorridos != null).slice(-4);
  if (completed.length >= 1) {
    const avg = completed.reduce((s, w) => s + (w.kmPercorridos as number), 0) / completed.length;
    out.push(completed.length === 1
      ? `Na última semana completa com registro, você realizou ${fmtKm(avg)}.`
      : `Nas últimas ${completed.length} semanas completas com registro, seu volume médio foi de ${fmtKm(avg)} por semana.`);
  }
  const trend = trendSentence(volumeSnapshot, { label: 'O volume semanal realizado', fmt: fmtKm });
  if (trend) out.push(trend);

  const current = weeks.find((w) => isCurrentWeek(w.weekStart, todayIso));
  if (current && current.kmPercorridos != null) {
    if (current.kmPrescritos != null && current.kmPrescritos > 0) {
      const diff = current.kmPercorridos - current.kmPrescritos;
      const rel = Math.abs(diff) < 0.05 ? 'igual ao prescrito' : `${fmtKm(Math.abs(diff))} ${diff > 0 ? 'acima' : 'abaixo'} do prescrito`;
      out.push(`Nesta semana, até agora, você realizou ${fmtKm(current.kmPercorridos)} (prescrito: ${fmtKm(current.kmPrescritos)}) — ${rel}.`);
    } else {
      out.push(`Nesta semana, até agora, você realizou ${fmtKm(current.kmPercorridos)}.`);
    }
    const previous = completed[completed.length - 1];
    if (previous && previous.kmPercorridos != null) {
      const diff = current.kmPercorridos - previous.kmPercorridos;
      out.push(`A semana anterior fechou em ${fmtKm(previous.kmPercorridos)}${Math.abs(diff) < 0.05 ? ', igual ao acumulado desta semana' : ` (${fmtKm(Math.abs(diff))} ${diff > 0 ? 'a menos' : 'a mais'} que o acumulado desta semana até agora)`}.`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Pace e cadencia (variaveis activity.* do motor).
// ---------------------------------------------------------------------------------------------

export function formatPaceSeconds(seconds: number): string {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}/km`;
}

/**
 * "Recente" = media movel de 21 dias (a mesma do motor). Compara com o ultimo treino sem julgar.
 * `unit` so' aparece quando ha' valor; sem valor valido nao ha' frase (nunca zero).
 */
export function recentVsLastSentences(
  snapshot: SnapshotLite | null | undefined,
  d: { noun: string; fmt: (v: number) => string },
): string[] {
  if (!snapshot || !snapshot.mathApplicable || snapshot.current == null) return [];
  const mm = snapshot.movingAverages?.short_21d;
  const out: string[] = [];
  // A media movel de 21 dias e' do motor (value null = motor nao sustenta); n e' comunicado, nao usado como porta.
  if (mm && mm.value != null) {
    out.push(`Sua ${d.noun} média nas últimas 3 semanas (${mm.n} treino${mm.n === 1 ? '' : 's'}) é ${d.fmt(mm.value)}. No último treino registrado, foi ${d.fmt(snapshot.current)}.`);
  } else {
    out.push(`No último treino registrado, sua ${d.noun} foi ${d.fmt(snapshot.current)}. Não há treinos suficientes nas últimas 3 semanas para uma média.`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Dominios de "Como voce esta" — variaveis que PERTENCEM a cada dominio (nunca fundidas).
// ---------------------------------------------------------------------------------------------

export type FeelingDomain = 'sleep' | 'readiness' | 'effort' | 'response';

export interface DomainVariable {
  id: string;
  label: string;
  /** Texto de apoio do que "mais" significa (escala original, 5 = mais do construto). */
  scaleHint?: string;
  unit?: string;
  categorical?: boolean;
}

export const FEELING_DOMAINS: Record<FeelingDomain, { title: string; subtitle: string; primary: string; variables: DomainVariable[] }> = {
  sleep: {
    title: 'Sono',
    subtitle: 'Como foram suas noites antes dos treinos.',
    primary: 'workout.preSleepQuality',
    variables: [
      { id: 'workout.preSleepQuality', label: 'Qualidade do sono', scaleHint: '1 = muito ruim · 5 = excelente' },
      { id: 'workout.sleepDurationHoursEstimate', label: 'Duração estimada do sono', unit: 'h' },
      { id: 'workout.sleepInterruption', label: 'Interrupções do sono', scaleHint: '1 = nada ou quase nada · 5 = extremamente' },
      { id: 'workout.sleepDifficulty', label: 'Dificuldade para pegar no sono', scaleHint: '1 = nenhuma · 5 = extrema' },
      { id: 'workout.bedtimeShiftDirection', label: 'Horário de dormir vs. habitual', categorical: true },
      { id: 'workout.wakeTimeShiftDirection', label: 'Horário de acordar vs. habitual', categorical: true },
    ],
  },
  readiness: {
    title: 'Prontidão pré-treino',
    subtitle: 'Como você chegou aos treinos.',
    primary: 'workout.prePhysicalFatigue',
    variables: [
      { id: 'workout.prePhysicalFatigue', label: 'Cansaço físico antes do treino', scaleHint: '1 = muito baixo · 5 = muito alto' },
      { id: 'workout.preMentalFatigue', label: 'Cansaço mental antes do treino', scaleHint: '1 = muito baixo · 5 = muito alto' },
      { id: 'workout.preStressLevel', label: 'Nível de estresse', scaleHint: '1 = muito baixo · 5 = muito alto' },
      { id: 'workout.preMotivation', label: 'Vontade de treinar', scaleHint: '1 = muito baixa · 5 = muito alta' },
    ],
  },
  effort: {
    title: 'Percepção de esforço',
    subtitle: 'O esforço que você percebeu em cada treino (RPE, escala 1–10).',
    primary: 'workout.perceivedEffort',
    variables: [{ id: 'workout.perceivedEffort', label: 'Esforço percebido (RPE)', scaleHint: 'escala de 1 a 10' }],
  },
  response: {
    title: 'Resposta pós-treino',
    subtitle: 'Como seu corpo e sua cabeça responderam aos treinos.',
    primary: 'workout.postPhysicalFatigue',
    variables: [
      { id: 'workout.postPhysicalFatigue', label: 'Cansaço físico provocado pelo treino', scaleHint: '1 = muito pouco · 5 = extremamente' },
      { id: 'workout.postMentalFatigue', label: 'Cansaço mental provocado pelo treino', scaleHint: '1 = muito pouco · 5 = extremamente' },
      { id: 'workout.emotionalExperienceDuring', label: 'Experiência emocional durante o treino', scaleHint: '1 = muito mal · 5 = muito bem' },
      { id: 'workout.mentalStateChangePrePost', label: 'Mudança do estado mental (antes × depois)', scaleHint: '1 = muito pior · 5 = muito melhor' },
    ],
  },
};

const SHIFT_LABELS: Record<string, string> = {
  much_earlier: 'Mais de 1h mais cedo',
  moderately_earlier: '30-60min mais cedo',
  slightly_earlier: 'Até 30min mais cedo',
  on_time: 'Próximo do horário habitual',
  slightly_later: 'Até 30min mais tarde',
  moderately_later: '30-60min mais tarde',
  much_later: 'Mais de 1h mais tarde',
};

export function shiftLabel(value: string): string {
  return SHIFT_LABELS[value] ?? value;
}

/**
 * Frases do dominio inteiro: uma bateria de descricoes por variavel numerica (mesmas funcoes da
 * Home). RPE usa a escala 1-10; as demais, 1-5 — fmt apenas arredonda, nunca reescala.
 */
export function domainSentences(domain: FeelingDomain, snapshots: Record<string, SnapshotLite | null | undefined>): string[] {
  const cfg = FEELING_DOMAINS[domain];
  const out: string[] = [];
  for (const v of cfg.variables) {
    if (v.categorical) continue;
    const d: Descriptor = {
      label: v.label,
      fmt: (n) => `${(Math.round(n * 10) / 10).toString().replace('.', ',')}${v.unit ? ` ${v.unit}` : ''}`,
    };
    out.push(...describeVariable(snapshots[v.id], d));
  }
  return out;
}
