// Melhores marcas (09/11/2026): tipos da resposta de GET /me/best-marks e formatadores PUROS usados pela tela. Nenhuma conta de treino aqui: o servidor calcula as marcas.

export type MarkSource = 'device' | 'manual' | 'test';
export interface BestMark {
  distanceId: string;
  seconds: number;
  paceSecondsKm: number;
  activityId: string;
  startedAt: string;
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
