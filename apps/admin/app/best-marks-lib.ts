// Melhores marcas no painel (09/11/2026): tipos da resposta de GET /coach/students/:id/best-marks e formatadores/textos PUROS. A conta das marcas e' do servidor; aqui so' se formata e se explica.
// (Espelho do que o app da aluna usa em apps/mobile/home/bestMarks.ts: o painel e' outro aplicativo e nao importa codigo do app.)

export type MarkSource = 'device' | 'manual' | 'test';
export interface Mark {
  distanceId: string; seconds: number; paceSecondsKm: number; extraMeters: number; activityId: string; startedAt: string; localDate: string;
  runMeters: number | null; windowStartMeters: number | null; windowEndMeters: number | null;
  source: MarkSource; provider: string | null; method: 'whole' | 'segment'; timeBasis: 'series_clock' | 'duration';
}
export interface DistanceMarks { distanceId: string; label: string; meters: number; best: Mark | null; ranking: Mark[] }
export interface SelfReported { rank: 1 | 2 | 3; distanceKm: number | null; distanceRaw: string | null; timesRun: number | null; timeSeconds: number | null }
export interface BestMarksResult { marks: DistanceMarks[]; selfReported: SelfReported[]; notes: string[] }

const two = (n: number) => String(n).padStart(2, '0');
export function fmtTime(total: number): string {
  const s = Math.max(0, Math.round(total));
  const h = Math.floor(s / 3600);
  return h > 0 ? `${h}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}` : `${Math.floor(s / 60)}:${two(s % 60)}`;
}
export const fmtPace = (s: number) => `${Math.floor(s / 60)}:${two(Math.round(s) % 60)} /km`;
export const fmtDate = (localDate: string) => `${localDate.slice(8, 10)}/${localDate.slice(5, 7)}/${localDate.slice(0, 4)}`;
const kmText = (meters: number) => `${(Math.round(meters / 10) / 100).toString().replace('.', ',')} km`;

export const markKey = (mark: Mark) => `${mark.activityId}:${mark.method}`;

export function markTags(mark: Mark): string[] {
  const tags: string[] = [];
  if (mark.source === 'manual') tags.push('registro manual');
  else if (mark.source === 'test') tags.push('teste de 3 km');
  else tags.push(`relógio${mark.provider ? ` (${mark.provider})` : ''}`);
  if (mark.method === 'segment') tags.push('trecho de corrida maior');
  if (mark.method === 'whole' && mark.extraMeters >= 1) tags.push('tempo da corrida inteira (maior que a distância)');
  if (mark.source === 'device' && mark.timeBasis === 'duration') tags.push('sem série para conferir paradas');
  return tags;
}

export function howCollected(mark: Mark, distanceLabel: string): string[] {
  const day = fmtDate(mark.localDate);
  const run = mark.runMeters !== null ? ` com ${kmText(mark.runMeters)}` : '';
  if (mark.source === 'test') return [`Teste de 3 km feito em ${day}. Vale o tempo total do teste.`];
  if (mark.source === 'manual') {
    return [`Registro manual feito pela aluna em ${day}${run}. Não é conferido com o relógio.`, mark.extraMeters >= 1 ? `Ela registrou mais que ${distanceLabel}; sem a série do relógio, vale o tempo do treino todo.` : 'Vale o tempo total registrado.'];
  }
  const lines = [`Atividade do relógio${mark.provider ? ` (${mark.provider})` : ''} de ${day}${run}.`];
  if (mark.method === 'segment' && mark.windowStartMeters !== null && mark.windowEndMeters !== null) {
    lines.push(`Melhor trecho de ${distanceLabel} dentro dela: do km ${kmText(mark.windowStartMeters).replace(' km', '')} ao km ${kmText(mark.windowEndMeters).replace(' km', '')}, lido da série de dados do relógio.`);
    lines.push('Tempo de relógio corrido, sem pausa do relógio dentro do trecho. Andar conta como tempo.');
    return lines;
  }
  if (mark.extraMeters >= 1) lines.push(`A atividade foi maior que ${distanceLabel}; sem um trecho sem pausa para isolar a distância, vale o tempo da atividade toda.`);
  lines.push(mark.timeBasis === 'series_clock' ? 'Tempo total da atividade pelo relógio corrido, incluindo paradas.' : 'Tempo informado no resumo do relógio; sem a série de dados não dá para conferir se houve paradas.');
  return lines;
}

export interface ChartPoint { key: string; mark: Mark; day: number; seconds: number; isRecord: boolean }
export function chartPoints(ranking: Mark[]): ChartPoint[] {
  const points = ranking
    .map((mark) => ({ key: markKey(mark), mark, day: Math.floor(Date.parse(`${mark.localDate}T12:00:00Z`) / 86_400_000), seconds: mark.seconds, isRecord: false }))
    .sort((a, b) => a.day - b.day || a.seconds - b.seconds);
  let best = Infinity;
  for (const point of points) if (point.seconds < best) { point.isRecord = true; best = point.seconds; }
  return points;
}

export function summaryOf(marks: DistanceMarks[]): { withMark: number; total: number; latest: { label: string; localDate: string } | null } {
  const withBest = marks.filter((entry) => entry.best);
  let latest: { label: string; localDate: string } | null = null;
  for (const entry of withBest) {
    const date = (entry.best as Mark).localDate;
    if (!latest || date > latest.localDate) latest = { label: entry.label, localDate: date };
  }
  return { withMark: withBest.length, total: marks.length, latest };
}

export const RANK_LABEL: Record<number, string> = { 1: 'Maior distância', 2: '2ª maior distância', 3: '3ª maior distância' };
export function selfLine(run: SelfReported): string {
  const times = run.timesRun !== null ? `${run.timesRun} ${run.timesRun === 1 ? 'vez' : 'vezes'} nos últimos 6 meses` : 'quantidade de vezes não informada';
  return `${times} · ${run.timeSeconds !== null ? `tempo ${fmtTime(run.timeSeconds)}` : 'tempo não informado'}`;
}
export const selfDistance = (run: SelfReported) => (run.distanceKm !== null ? `${String(run.distanceKm).replace('.', ',')} km` : (run.distanceRaw ?? 'não informada'));
