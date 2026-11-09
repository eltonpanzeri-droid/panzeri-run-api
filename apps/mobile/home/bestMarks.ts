// Melhores marcas (09/11/2026): tipos da resposta de GET /me/best-marks e formatadores PUROS usados pela tela. Nenhuma conta de treino aqui: o servidor calcula as marcas.

export type MarkSource = 'device' | 'manual' | 'test';
export interface BestMark {
  distanceId: string;
  seconds: number;
  paceSecondsKm: number;
  extraMeters: number;
  activityId: string;
  startedAt: string;
  localDate: string;
  runMeters: number | null;
  windowStartMeters: number | null;
  windowEndMeters: number | null;
  source: MarkSource;
  provider: string | null;
  method: 'whole' | 'segment';
  timeBasis: 'series_clock' | 'duration';
}
export interface DistanceMarks { distanceId: string; label: string; meters: number; best: BestMark | null; ranking: BestMark[] }
export interface SelfReportedRun { rank: 1 | 2 | 3; distanceKm: number | null; distanceRaw: string | null; timesRun: number | null; timeSeconds: number | null }
export interface BestMarksResponse { marks: DistanceMarks[]; selfReported: SelfReportedRun[]; notes: string[] }

export const TOP_LIMIT = 10;

export function formatMarkTime(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}

export function formatMarkPace(secondsPerKm: number): string {
  const s = Math.max(0, Math.round(secondsPerKm));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} /km`;
}

export function formatMarkDate(iso: string): string {
  const day = iso.slice(0, 10);
  return `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
}

// Etiquetas da origem de cada marca (sempre visiveis: a aluna precisa saber de onde veio o tempo).
export function markTags(mark: BestMark): string[] {
  const tags: string[] = [];
  if (mark.source === 'manual') tags.push('registro manual');
  else if (mark.source === 'test') tags.push('teste de 3 km');
  else tags.push('relógio');
  if (mark.method === 'segment') tags.push('trecho de uma corrida maior');
  if (mark.method === 'whole' && mark.extraMeters >= 1) tags.push('tempo da corrida inteira, que foi maior que esta distância');
  if (mark.source === 'device' && mark.timeBasis === 'duration') tags.push('tempo informado pelo relógio, sem série para conferir paradas');
  return tags;
}

export function selfReportedDistanceLabel(run: SelfReportedRun): string {
  if (run.distanceKm !== null) return `${String(run.distanceKm).replace('.', ',')} km`;
  return run.distanceRaw ?? 'distância não informada';
}

export function selfReportedLine(run: SelfReportedRun): string {
  const times = run.timesRun !== null ? `${run.timesRun} ${run.timesRun === 1 ? 'vez' : 'vezes'}` : 'quantidade de vezes não informada';
  const time = run.timeSeconds !== null ? `tempo ${formatMarkTime(run.timeSeconds)}` : 'tempo não informado';
  return `${times} · ${time}`;
}

export const RANK_LABEL: Record<number, string> = { 1: 'Maior distância', 2: '2ª maior distância', 3: '3ª maior distância' };

export const MARKS_EXPLANATION = 'As melhores marcas usam o tempo total da atividade, incluindo paradas. Dentro de uma corrida mais longa, um trecho só conta se o relógio não foi pausado nele. Andar durante o trecho conta como tempo. As marcas informadas por você aparecem separadas, com a etiqueta "registro manual".';
export const SELF_REPORT_EXPLANATION = 'Estas respostas foram dadas por você na entrevista, sobre os seis meses anteriores. São relatos seus, sem comprovação pelo relógio, e não entram nas melhores marcas registradas.';

const kmText = (meters: number) => `${(Math.round(meters / 10) / 100).toString().replace('.', ',')} km`;
const dayBr = (localDate: string) => `${localDate.slice(8, 10)}/${localDate.slice(5, 7)}/${localDate.slice(0, 4)}`;

// "Como esta marca foi coletada": frases curtas, uma por fato, montadas SO' dos campos que o servidor devolveu (nada e' deduzido aqui).
export function howCollected(mark: BestMark, distanceLabel: string): string[] {
  const lines: string[] = [];
  const day = dayBr(mark.localDate);
  const run = mark.runMeters !== null ? ` com ${kmText(mark.runMeters)}` : '';
  if (mark.source === 'test') {
    lines.push(`Teste de 3 km feito em ${day}. Vale o tempo total do teste.`);
    return lines;
  }
  if (mark.source === 'manual') {
    lines.push(`Registro manual feito por você em ${day}${run}. O Panzeri Run não confere esse dado com o relógio.`);
    if (mark.extraMeters >= 1) lines.push(`Você registrou mais que ${distanceLabel}. Sem a série do relógio para isolar a distância, vale o tempo do treino todo.`);
    else lines.push('Vale o tempo total que você registrou.');
    return lines;
  }
  lines.push(`Atividade do relógio${mark.provider ? ` (${mark.provider})` : ''} de ${day}${run}.`);
  if (mark.method === 'segment' && mark.windowStartMeters !== null && mark.windowEndMeters !== null) {
    lines.push(`Este é o melhor trecho de ${distanceLabel} dentro dela: do km ${(Math.round(mark.windowStartMeters / 10) / 100).toString().replace('.', ',')} ao km ${(Math.round(mark.windowEndMeters / 10) / 100).toString().replace('.', ',')}, lido da série de dados do relógio.`);
    lines.push('Tempo de relógio corrido, sem nenhuma pausa do relógio dentro do trecho. Andar durante o trecho conta como tempo.');
    return lines;
  }
  if (mark.extraMeters >= 1) lines.push(`A atividade foi maior que ${distanceLabel}. Sem um trecho sem pausa para isolar a distância, vale o tempo da atividade toda.`);
  lines.push(mark.timeBasis === 'series_clock' ? 'Tempo total da atividade pelo relógio corrido, incluindo paradas.' : 'Tempo informado no resumo do relógio. Sem a série de dados, não dá para conferir se houve paradas.');
  return lines;
}

// Segunda-feira da semana do dia (para abrir a semana certa). Entrada 'YYYY-MM-DD'.
export function mondayOf(localDate: string): string {
  const d = new Date(`${localDate.slice(0, 10)}T12:00:00Z`);
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return d.toISOString().slice(0, 10);
}

export interface MarkChartPoint { key: string; mark: BestMark; day: number; seconds: number; isRecord: boolean }

export const markKey = (mark: BestMark) => `${mark.activityId}:${mark.method}`;

// Pontos do grafico em ordem de data; "marca batida" = ficou mais rapida que todas as anteriores. Dois treinos no mesmo dia: o mais rapido define o recorde do dia.
export function markChartPoints(ranking: BestMark[]): MarkChartPoint[] {
  const points = ranking
    .map((mark) => ({ key: markKey(mark), mark, day: Math.floor(Date.parse(`${mark.localDate}T12:00:00Z`) / 86_400_000), seconds: mark.seconds, isRecord: false }))
    .sort((a, b) => a.day - b.day || a.seconds - b.seconds);
  let best = Infinity;
  for (const point of points) {
    if (point.seconds < best) { point.isRecord = true; best = point.seconds; }
  }
  return points;
}

export function marksSummary(marks: DistanceMarks[]): { withMark: number; total: number; latest: { label: string; localDate: string } | null } {
  const withBest = marks.filter((entry) => entry.best);
  let latest: { label: string; localDate: string } | null = null;
  for (const entry of withBest) {
    const date = (entry.best as BestMark).localDate;
    if (!latest || date > latest.localDate) latest = { label: entry.label, localDate: date };
  }
  return { withMark: withBest.length, total: marks.length, latest };
}

export const HOW_COLLECTED_STEPS: string[] = [
  'Fonte: as atividades que o seu relógio enviou ao Panzeri Run, os treinos que você registrou à mão e o teste de 3 km. Dados do Strava não são usados.',
  'Corrida menor que a distância não conta. Corrida igual ou maior conta.',
  'Se você correu mais que a distância e o relógio enviou a série de dados, o Panzeri Run procura o melhor trecho daquela distância dentro da corrida, desde que o relógio não tenha sido pausado nele.',
  'Sem a série de dados (ou em registro manual), vale o tempo da atividade toda, que é sempre um tempo igual ou mais lento que o real.',
  'O tempo é sempre de relógio corrido, incluindo paradas. Andar conta como tempo.',
];
