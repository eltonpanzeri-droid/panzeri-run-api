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

// ---------------------------------------------------------------------------------------------
// Narrativa dos quatro dominios (04/10/2026). Substitui a antiga "bateria de frases por variavel":
// recebe as MESMAS saidas do motor (tendencia, veredito de faixa habitual, variabilidade, ultimo
// valor) e monta um resumo curto, em portugues corrido. Nao calcula nada novo e nao decide
// evidencia: variavel sem tendencia/veredito/variabilidade sustentados pelo motor simplesmente nao
// entra na narrativa. n e limites exatos da faixa ficam nos graficos/detalhes, nao aqui.
//
// Prioridade (do mais relevante ao menos): 1) fora da faixa habitual, 2) tendencia/mudanca,
// 3) variabilidade, 4) estado atual, 5) fecho de estabilidade/faixa, 6) abertura. Padroes
// convergentes (varias variaveis na mesma direcao) viram UMA frase. Maximo de 4 frases: se passar,
// descartam-se as de menor prioridade. Descricao, nunca julgamento: "aumentou" nao vira "piorou".
// ---------------------------------------------------------------------------------------------

interface NarrativeSubject {
  /** Nucleo do sintagma, com artigo, ex.: "a qualidade". */
  core: string;
  /** Complemento comum que pode ser fatorado em grupo, ex.: " do sono". */
  suffix: string;
  plural?: boolean;
}

const NARRATIVE_SUBJECTS: Record<string, NarrativeSubject> = {
  'workout.preSleepQuality': { core: 'a qualidade', suffix: ' do sono' },
  'workout.sleepDurationHoursEstimate': { core: 'a duração', suffix: ' do sono' },
  'workout.sleepInterruption': { core: 'as interrupções', suffix: ' do sono', plural: true },
  'workout.sleepDifficulty': { core: 'a dificuldade para pegar no sono', suffix: '' },
  'workout.prePhysicalFatigue': { core: 'o cansaço físico', suffix: ' antes do treino' },
  'workout.preMentalFatigue': { core: 'o cansaço mental', suffix: ' antes do treino' },
  'workout.preStressLevel': { core: 'o estresse', suffix: '' },
  'workout.preMotivation': { core: 'a vontade de treinar', suffix: '' },
  'workout.perceivedEffort': { core: 'o esforço percebido', suffix: '' },
  'workout.postPhysicalFatigue': { core: 'o cansaço físico', suffix: ' provocado pelos treinos' },
  'workout.postMentalFatigue': { core: 'o cansaço mental', suffix: ' provocado pelos treinos' },
  'workout.emotionalExperienceDuring': { core: 'a experiência emocional', suffix: ' durante os treinos' },
  'workout.mentalStateChangePrePost': { core: 'a mudança do estado mental', suffix: ' após o exercício' },
};

const DOMAIN_TEXT: Record<FeelingDomain, { intro: string; subject: string }> = {
  sleep: { intro: 'Seu sono tem apresentado algumas mudanças nas últimas semanas.', subject: 'seu sono' },
  readiness: { intro: 'Você tem chegado aos treinos com algumas mudanças nas últimas semanas.', subject: 'como você tem chegado aos treinos' },
  effort: { intro: 'Seu esforço percebido tem apresentado mudanças nas últimas semanas.', subject: 'seu esforço percebido' },
  response: { intro: 'Sua resposta aos treinos apresentou mudanças nas últimas semanas.', subject: 'sua resposta aos treinos' },
};

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
}

function upperFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Sintagma de um grupo: fatora o complemento comum ("a qualidade e a duração do sono"). */
function groupPhrase(ids: string[]): string {
  const subjects = ids.map((id) => NARRATIVE_SUBJECTS[id]);
  const commonSuffix = subjects[0].suffix;
  if (ids.length > 1 && commonSuffix && subjects.every((s) => s.suffix === commonSuffix)) {
    return `${joinList(subjects.map((s) => s.core))}${commonSuffix}`;
  }
  return joinList(subjects.map((s) => `${s.core}${s.suffix}`));
}

function isPluralGroup(ids: string[]): boolean {
  return ids.length > 1 || Boolean(NARRATIVE_SUBJECTS[ids[0]]?.plural);
}

function formatHours(hours: number): string {
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

function formatScaleValue(id: string, snapshot: SnapshotLite): string | null {
  if (snapshot.current == null) return null;
  if (id === 'workout.sleepDurationHoursEstimate') return formatHours(snapshot.current);
  const max = snapshot.variable.scale?.max;
  const value = String(Math.round(snapshot.current * 10) / 10).replace('.', ',');
  return max != null ? `${value}/${max}` : value;
}

/** Direcao de tendencia sustentada pelo motor (janela curta; media se a curta nao sustenta). */
function engineTrendDirection(snapshot: SnapshotLite | null | undefined): 'increasing' | 'decreasing' | 'stable' | null {
  if (!snapshot || !snapshot.mathApplicable || !snapshot.trend) return null;
  for (const key of ['short_21d', 'medium_60d']) {
    const t = snapshot.trend[key];
    if (!t || t.direction === 'insufficient_data') continue;
    if (t.direction === 'increasing' || t.direction === 'decreasing' || t.direction === 'stable') return t.direction;
  }
  return null;
}

interface NarrativeItem { priority: number; text: string }

export function domainSentences(domain: FeelingDomain, snapshots: Record<string, SnapshotLite | null | undefined>): string[] {
  const cfg = FEELING_DOMAINS[domain];
  const ids = cfg.variables.filter((v) => !v.categorical && NARRATIVE_SUBJECTS[v.id]).map((v) => v.id).filter((id) => (snapshots[id]?.evidence.n ?? 0) > 0);
  if (ids.length === 0) return [];

  const trend = new Map(ids.map((id) => [id, engineTrendDirection(snapshots[id])] as const));
  const verdict = new Map(ids.map((id) => [id, engineRangeVerdict(snapshots[id])?.verdict ?? null] as const));
  const variability = new Map(ids.map((id) => [id, snapshots[id]?.variabilityChange?.direction ?? null] as const));

  const supported = ids.filter((id) => trend.get(id) != null || verdict.get(id) != null || variability.get(id) === 'increased' || variability.get(id) === 'decreased');
  if (supported.length === 0) {
    return [`Ainda não há registros suficientes para descrever como ${DOMAIN_TEXT[domain].subject} tem se comportado.`];
  }

  const items: NarrativeItem[] = [];
  const increasing = ids.filter((id) => trend.get(id) === 'increasing');
  const decreasing = ids.filter((id) => trend.get(id) === 'decreasing');
  const stable = ids.filter((id) => trend.get(id) === 'stable');
  const above = ids.filter((id) => verdict.get(id) === 'above');
  const below = ids.filter((id) => verdict.get(id) === 'below');
  const within = ids.filter((id) => verdict.get(id) === 'within');
  const hasChange = increasing.length + decreasing.length > 0;

  // 1) Fora da faixa habitual
  if (above.length + below.length > 0) {
    const parts: string[] = [];
    const withValue = (group: string[]) => {
      const v = group.length === 1 ? formatScaleValue(group[0], snapshots[group[0]] as SnapshotLite) : null;
      return v ? ` (${v})` : '';
    };
    if (above.length) parts.push(`${groupPhrase(above)} ${isPluralGroup(above) ? 'ficaram' : 'ficou'} acima do seu padrão habitual${withValue(above)}`);
    if (below.length) parts.push(`${groupPhrase(below)} ${isPluralGroup(below) ? 'ficaram' : 'ficou'} abaixo do seu padrão habitual${withValue(below)}`);
    const rest = within.length ? '; os demais valores recentes seguem dentro do padrão habitual' : '';
    items.push({ priority: 1, text: `No último registro, ${parts.join(' e ')}${rest}.` });
  }

  // 2) Tendencia — padroes convergentes numa unica frase
  const varIncreased = ids.filter((id) => variability.get(id) === 'increased');
  const varDecreased = ids.filter((id) => variability.get(id) === 'decreased');
  let variabilityMerged = false;
  if (hasChange) {
    const clauses: Array<{ ids: string[]; verb: (plural: boolean) => string }> = [];
    const first = [...increasing, ...decreasing].sort((a, b) => ids.indexOf(a) - ids.indexOf(b))[0];
    const groups = first && decreasing.includes(first) ? [decreasing, increasing] : [increasing, decreasing];
    for (const g of groups) {
      if (g.length === 0) continue;
      const isInc = g === increasing;
      clauses.push({ ids: g, verb: (p) => `${p ? 'vêm' : 'vem'} ${isInc ? 'aumentando' : 'diminuindo'}` });
    }
    const written = clauses.map((c) => `${groupPhrase(c.ids)} ${c.verb(isPluralGroup(c.ids))}`);
    let sentence = upperFirst(written.join(', enquanto '));
    if (stable.length) sentence += `; já ${groupPhrase(stable)} ${isPluralGroup(stable) ? 'permanecem estáveis' : 'permanece estável'}`;
    items.push({ priority: 2, text: `${sentence}.` });
    items.push({ priority: 6, text: DOMAIN_TEXT[domain].intro });
  } else if (stable.length > 0) {
    // Estabilidade predominante: tudo estavel. Variabilidade (se houver) vira ", mas ..." na mesma frase.
    const plural = isPluralGroup(stable);
    let sentence = `${upperFirst(groupPhrase(stable))} ${plural ? 'permanecem relativamente estáveis' : 'permanece relativamente estável'} nas últimas semanas`;
    if (varIncreased.length > 0 && varIncreased.every((id) => stable.includes(id)) && varDecreased.length === 0) {
      const sameSubject = varIncreased.length === stable.length;
      sentence += `, mas ${sameSubject ? '' : `${groupPhrase(varIncreased)} `}${isPluralGroup(varIncreased) ? 'têm oscilado' : 'tem oscilado'} mais do que o habitual`;
      variabilityMerged = true;
    }
    items.push({ priority: 2, text: `${sentence}.` });
  }

  // 3) Variabilidade
  if (!variabilityMerged && (varIncreased.length > 0 || varDecreased.length > 0)) {
    const parts: string[] = [];
    if (varIncreased.length) parts.push(`${groupPhrase(varIncreased)} ${isPluralGroup(varIncreased) ? 'têm oscilado' : 'tem oscilado'} mais do que o habitual`);
    if (varDecreased.length) parts.push(`${groupPhrase(varDecreased)} ${isPluralGroup(varDecreased) ? 'têm oscilado' : 'tem oscilado'} menos do que o habitual`);
    items.push({ priority: 3, text: `${upperFirst(parts.join(', enquanto '))} recentemente.` });
  }

  // 4) Estado atual (valores mais recentes das variaveis relevantes)
  let currentCoversVerdict = false;
  if (domain === 'sleep') {
    const dur = snapshots['workout.sleepDurationHoursEstimate'];
    const qual = snapshots['workout.preSleepQuality'];
    const durText = dur && dur.current != null ? `dormiu cerca de ${formatHours(dur.current)}` : null;
    const qualText = qual && qual.current != null ? `avaliou a qualidade do sono em ${formatScaleValue('workout.preSleepQuality', qual)}` : null;
    const parts = [durText, qualText].filter((p): p is string => p != null);
    if (parts.length > 0) items.push({ priority: 4, text: `Na última noite registrada, você ${joinList(parts)}.` });
  } else if (domain === 'effort') {
    const snap = snapshots['workout.perceivedEffort'];
    const value = snap ? formatScaleValue('workout.perceivedEffort', snap) : null;
    if (value) {
      const tail = verdict.get('workout.perceivedEffort') === 'within' ? ', dentro da faixa que costuma aparecer nos seus treinos' : '';
      currentCoversVerdict = tail !== '';
      items.push({ priority: 4, text: `Seu último registro foi ${value}${tail}.` });
    }
  } else {
    const alreadyWithValue = [...above, ...below].length > 0 && [...above, ...below].length === 1 ? [...above, ...below] : [];
    const relevant = [...above, ...below, ...increasing, ...decreasing].filter((id, i, arr) => arr.indexOf(id) === i && !alreadyWithValue.includes(id)).slice(0, 2);
    const parts = relevant
      .map((id) => {
        const s = NARRATIVE_SUBJECTS[id];
        const v = formatScaleValue(id, snapshots[id] as SnapshotLite);
        return v ? `${s.core}${s.suffix} ${s.plural ? 'foram' : 'foi'} ${v}` : null;
      })
      .filter((p): p is string => p != null);
    if (parts.length > 0) items.push({ priority: 4, text: `No último registro, ${joinList(parts)}.` });
  }

  // 5) Fecho: valores recentes dentro do padrao habitual (so' se TODOS os comparaveis estiverem dentro)
  if (above.length + below.length === 0 && within.length > 0 && within.length === ids.filter((id) => verdict.get(id) != null).length && !currentCoversVerdict) {
    items.push({
      priority: 5,
      text: hasChange ? 'Apesar dessas mudanças, os valores mais recentes continuam dentro do seu padrão habitual.' : 'Os valores mais recentes estão dentro do seu padrão habitual.',
    });
  }

  // Limite de 4 frases: descarta as de menor prioridade (maior numero) primeiro; ordem final = prioridade,
  // exceto a abertura (priority 6) que, quando sobrevive, vem antes da frase de tendencia.
  const kept = [...items].sort((a, b) => a.priority - b.priority).slice(0, 4);
  const intro = kept.find((i) => i.priority === 6);
  const body = kept.filter((i) => i.priority !== 6);
  const ordered = intro ? [...body.filter((i) => i.priority < 2), intro, ...body.filter((i) => i.priority >= 2)] : body;
  return ordered.map((i) => i.text);
}
