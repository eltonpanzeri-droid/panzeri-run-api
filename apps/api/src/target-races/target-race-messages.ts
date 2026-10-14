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
