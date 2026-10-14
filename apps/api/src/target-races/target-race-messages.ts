// Textos de uma meta de prova nova: aviso ao treinador (Telegram) e linha do Prontuario. Puro texto (sem I/O): so' formata fatos que a aluna informou.
export interface RaceSummary {
  name: string;
  raceDate: Date;
  distanceKm: number;
  targetSeconds?: number | null;
  priority?: string | null;
  notes?: string | null;
  isFirstTimeAtDistance?: boolean | null;
  performanceIntent?: number | null;
  socialIntent?: number | null;
  personalImportance?: number | null;
  perceivedDifficulty?: number | null;
  dedicationWillingness?: number | null;
  achievementSatisfaction?: number | null;
  confidenceLevel?: number | null;
  injuryConcern?: number | null;
  adjustmentOpenness?: number | null;
  anxietyLevel?: number | null;
}

const SCALES: Array<[keyof RaceSummary, string]> = [
  ['performanceIntent', 'intencao de desempenho'],
  ['socialIntent', 'intencao social'],
  ['personalImportance', 'importancia pessoal'],
  ['perceivedDifficulty', 'dificuldade percebida'],
  ['dedicationWillingness', 'disposicao a se dedicar'],
  ['achievementSatisfaction', 'satisfacao ao conseguir'],
  ['confidenceLevel', 'confianca em alcancar'],
  ['injuryConcern', 'preocupacao com lesao'],
  ['adjustmentOpenness', 'abertura a ajustar a meta'],
  ['anxietyLevel', 'ansiedade'],
];

export function formatRaceDate(date: Date): string {
  const iso = date.toISOString().slice(0, 10);
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

export function formatTargetTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}h${String(m).padStart(2, '0')}min${String(s).padStart(2, '0')}s`;
}

function scalesLine(race: RaceSummary): string | null {
  const parts = SCALES.filter(([key]) => typeof race[key] === 'number').map(([key, label]) => `${label} ${race[key] as number}/10`);
  return parts.length ? `Contexto informado (1 a 10): ${parts.join('; ')}.` : null;
}

function baseLines(race: RaceSummary): string[] {
  const lines = [`${race.name} — ${race.distanceKm} km em ${formatRaceDate(race.raceDate)}`];
  lines.push(race.targetSeconds ? `Tempo-alvo: ${formatTargetTime(race.targetSeconds)}` : 'Sem tempo-alvo informado');
  lines.push(`Prioridade: ${race.priority === 'secundaria' ? 'secundaria' : 'principal'}`);
  if (typeof race.isFirstTimeAtDistance === 'boolean') lines.push(`Primeira vez nessa distancia: ${race.isFirstTimeAtDistance ? 'sim' : 'nao'}`);
  return lines;
}

// Mensagem unica ao treinador; motivos de risco (quando ha) entram na MESMA mensagem.
export function formatRaceForTelegram(race: RaceSummary, student: { name: string; code: string }, riskReasons: string[]): string {
  const parts = [`🏁 Nova meta de prova cadastrada\nAluno: ${student.name} (Cod. ${student.code})`, ...baseLines(race)];
  const scales = scalesLine(race);
  if (scales) parts.push(scales);
  if (race.notes?.trim()) parts.push(`Observacao da aluna: ${race.notes.trim()}`);
  if (riskReasons.length) parts.push(`\n⚠️ Merece um olhar:\n${riskReasons.map((reason) => `• ${reason}`).join('\n')}\n\nSo um aviso — nao bloqueia nada, a prescricao segue normal.`);
  return parts.join('\n');
}

// Linha do Prontuario (fato estruturado informado pela aluna; sem interpretacao).
export function formatRaceForProfile(race: RaceSummary): string {
  const parts = ['Meta de prova cadastrada pela aluna.', ...baseLines(race)];
  const scales = scalesLine(race);
  if (scales) parts.push(scales);
  if (race.notes?.trim()) parts.push(`Observacao da aluna: ${race.notes.trim()}`);
  return parts.join(' | ');
}

// ── Alteracao e exclusao (14/10/2026) ───────────────────────────────────────────────────────────────────────────────────────────────
export interface RaceState extends RaceSummary {
  status?: string | null;
}

const STATUS_LABEL: Record<string, string> = { em_andamento: 'em andamento', concluida: 'concluida', arquivada: 'arquivada' };

const yesNo = (value: boolean | null | undefined) => (typeof value === 'boolean' ? (value ? 'sim' : 'nao') : 'nao informado');
const timeOf = (seconds: number | null | undefined) => (seconds ? formatTargetTime(seconds) : 'sem tempo-alvo');
const noteOf = (notes: string | null | undefined) => (notes?.trim() ? notes.trim() : '(vazio)');
const scaleOf = (value: number | null | undefined) => (typeof value === 'number' ? `${value}/10` : 'nao informado');

// Lista legivel do que mudou ("campo: antes -> depois"). Vazia quando nada mudou de fato (reenvio igual nao gera aviso).
export function describeRaceChanges(before: RaceState, after: RaceState): string[] {
  const changes: string[] = [];
  const push = (label: string, from: string, to: string) => { if (from !== to) changes.push(`${label}: ${from} -> ${to}`); };
  push('Nome', before.name, after.name);
  push('Data', formatRaceDate(before.raceDate), formatRaceDate(after.raceDate));
  push('Distancia', `${before.distanceKm} km`, `${after.distanceKm} km`);
  push('Tempo-alvo', timeOf(before.targetSeconds), timeOf(after.targetSeconds));
  push('Prioridade', before.priority === 'secundaria' ? 'secundaria' : 'principal', after.priority === 'secundaria' ? 'secundaria' : 'principal');
  push('Status', STATUS_LABEL[before.status ?? ''] ?? String(before.status ?? ''), STATUS_LABEL[after.status ?? ''] ?? String(after.status ?? ''));
  push('Primeira vez na distancia', yesNo(before.isFirstTimeAtDistance), yesNo(after.isFirstTimeAtDistance));
  push('Observacao', noteOf(before.notes), noteOf(after.notes));
  for (const [key, label] of SCALES) push(label, scaleOf(before[key] as number | null | undefined), scaleOf(after[key] as number | null | undefined));
  return changes;
}

export function formatRaceChangeForTelegram(after: RaceState, student: { name: string; code: string }, changes: string[], riskReasons: string[]): string {
  const statusChanged = changes.some((line) => line.startsWith('Status:'));
  const parts = [
    `${statusChanged ? '🔁 Status de meta de prova alterado' : '✏️ Meta de prova alterada'}\nAluno: ${student.name} (Cod. ${student.code})`,
    `Prova: ${after.name} — ${after.distanceKm} km em ${formatRaceDate(after.raceDate)}`,
    ...changes.map((line) => `• ${line}`),
  ];
  if (riskReasons.length) parts.push(`\n⚠️ Merece um olhar:\n${riskReasons.map((reason) => `• ${reason}`).join('\n')}\n\nSo um aviso — nao bloqueia nada, a prescricao segue normal.`);
  return parts.join('\n');
}

export function formatRaceChangeForProfile(after: RaceState, changes: string[]): string {
  return [`Meta de prova alterada pela aluna: ${after.name} — ${after.distanceKm} km em ${formatRaceDate(after.raceDate)}.`, ...changes].join(' | ');
}

export function formatRaceRemovalForTelegram(race: RaceState, student: { name: string; code: string }): string {
  return `🗑️ Meta de prova removida pela aluna\nAluno: ${student.name} (Cod. ${student.code})\nProva: ${race.name} — ${race.distanceKm} km em ${formatRaceDate(race.raceDate)} (status antes: ${STATUS_LABEL[race.status ?? ''] ?? race.status ?? 'nao informado'})`;
}

export function formatRaceRemovalForProfile(race: RaceState): string {
  return `Meta de prova removida pela aluna: ${race.name} — ${race.distanceKm} km em ${formatRaceDate(race.raceDate)} (status antes: ${STATUS_LABEL[race.status ?? ''] ?? race.status ?? 'nao informado'}).`;
}
