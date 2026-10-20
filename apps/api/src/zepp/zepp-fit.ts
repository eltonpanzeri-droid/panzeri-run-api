import FitParser from 'fit-file-parser';

// Leitor e normalizador de FIT da Zepp (Lote 3, 20/10/2026). So' le o que o arquivo contem — nao interpreta treino, nao calcula prescricao.
// Principios:
//  - O FIT ORIGINAL NUNCA e' guardado: o buffer existe so' em memoria durante a leitura; o que sai daqui e' um conjunto pequeno de campos normalizados.
//  - Leitura ESTRITA do cabecalho/CRC (`force: false`): arquivo corrompido e' recusado, nao "consertado".
//  - Sem inventar: campo ausente ou fora de limites fisicos vira null (nunca zero). Limites sao de integridade de dado (impossibilidade), nao de prescricao.
//  - A cadencia so' e' gravada quando o fator de conversao para passos/min estiver CONFIRMADO (ZEPP_FIT_PROFILE): o FIT de corrida costuma trazer passadas por
//    minuto (uma perna) e nao sabemos qual convencao a Zepp usa. Confirmar com um FIT real de Amazfit antes de preencher.
//  - A filtragem por consentimento (o que pode ser GUARDADO) e' feita em zepp-fit-consent.ts, ANTES de qualquer gravacao.

export interface ZeppFitProfile {
  // Multiplicador de `cadence` (rpm do FIT) para passos por minuto em corrida: 2 se o FIT traz uma perna, 1 se ja' traz o total. null = nao confirmado => cadencia nao e gravada.
  runningCadenceMultiplier: number | null;
}
export const ZEPP_FIT_PROFILE: ZeppFitProfile = { runningCadenceMultiplier: null };

export interface ZeppFitPoint {
  offsetSec: number;
  distanceMeters: number | null;
  speedKmh: number | null;
  heartRateBpm: number | null;
  cadenceSpm: number | null;
  powerWatts: number | null;
  elevationMeters: number | null;
  latitude: number | null;
  longitude: number | null;
}

export interface ZeppFitActivity {
  startedAt: Date;
  // Fuso do relogio no momento da atividade (minutos em relacao ao UTC), obtido da mensagem "activity" do FIT (timestamp x local_timestamp). null = o arquivo nao informa;
  // sem ele o dia local da atividade seria assumido em UTC (corrida noturna cairia no dia seguinte), por isso o fato fica registrado em notes.
  utcOffsetMinutes: number | null;
  durationSec: number | null;
  distanceMeters: number | null;
  // Modalidade CANONICA do Panzeri Run (mesmo vocabulario de TrainingSession.modality) e o par bruto do FIT, para auditoria.
  modality: string;
  sportRaw: { sport: string | null; subSport: string | null };
  caloriesKcal: number | null;
  avgHeartRateBpm: number | null;
  maxHeartRateBpm: number | null;
  cadenceAvg: number | null;
  powerAvgWatts: number | null;
  elevationGainMeters: number | null;
  hasRoute: boolean;
  points: ZeppFitPoint[];
  // Observacoes de qualidade do arquivo (o que foi descartado por estar fora de limites, cadencia nao confirmada etc.). Nunca contem coordenadas.
  notes: string[];
}

export class ZeppFitError extends Error {
  constructor(public readonly code: 'invalid_fit' | 'no_session' | 'multiple_sessions' | 'no_start_time' | 'too_large', message: string) {
    super(message);
    this.name = 'ZeppFitError';
  }
}

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_POINTS = 50_000;
const SECONDS_PER_HOUR = 3600;

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const within = (value: number | null, min: number, max: number): number | null => (value !== null && value >= min && value <= max ? value : null);

// Modalidade canonica a partir do par sport/sub_sport do FIT. Desconhecido => 'outra' (so' registra o que foi feito; nunca vira corrida por palpite).
export function modalityFromFit(sport: string | null, subSport: string | null): string {
  const s = (sport ?? '').toLowerCase();
  const sub = (subSport ?? '').toLowerCase();
  if (s === 'running') return sub === 'treadmill' || sub === 'virtual_activity' ? 'esteira' : 'corrida';
  if (s === 'walking' || s === 'hiking') return 'caminhada';
  if (s === 'cycling' || s === 'e_biking') return 'bike';
  if (s === 'swimming') return 'natacao';
  if (s === 'training') return sub === 'strength_training' ? 'forca' : sub === 'cardio_training' || sub === 'hiit' ? 'funcional' : 'outra';
  return 'outra';
}

export async function readZeppFit(buffer: Buffer, profile: ZeppFitProfile = ZEPP_FIT_PROFILE): Promise<ZeppFitActivity> {
  if (buffer.length === 0 || buffer.length > MAX_BYTES) throw new ZeppFitError(buffer.length === 0 ? 'invalid_fit' : 'too_large', buffer.length === 0 ? 'Arquivo FIT vazio.' : 'Arquivo FIT grande demais.');
  const parser = new FitParser({ force: false, mode: 'list', speedUnit: 'm/s', lengthUnit: 'm', elapsedRecordField: true });
  let data: Awaited<ReturnType<FitParser['parseAsync']>>;
  try {
    data = await parser.parseAsync(Uint8Array.from(buffer).buffer);
  } catch (error) {
    throw new ZeppFitError('invalid_fit', `Arquivo FIT invalido ou corrompido: ${typeof error === 'string' ? error : error instanceof Error ? error.message : 'erro'}`.slice(0, 200));
  }
  const sessions = (data.sessions ?? []) as Array<Record<string, unknown>>;
  if (sessions.length === 0) throw new ZeppFitError('no_session', 'FIT sem mensagem de sessao.');
  // Multiesporte (varias sessoes no mesmo arquivo) nao e' tratado: somar sessoes de modalidades diferentes seria inventar uma atividade.
  if (sessions.length > 1) throw new ZeppFitError('multiple_sessions', 'FIT com mais de uma sessao (multiesporte) nao e suportado.');
  const session = sessions[0];
  const start = session.start_time instanceof Date ? session.start_time : session.timestamp instanceof Date && num(session.total_elapsed_time) !== null ? new Date(session.timestamp.getTime() - (num(session.total_elapsed_time) as number) * 1000) : null;
  if (!start || Number.isNaN(start.getTime())) throw new ZeppFitError('no_start_time', 'FIT sem horario de inicio.');

  const notes: string[] = [];
  const activityMessage = (data as unknown as { activity?: { timestamp?: unknown; local_timestamp?: unknown } }).activity;
  let utcOffsetMinutes: number | null = null;
  if (activityMessage?.timestamp instanceof Date && activityMessage.local_timestamp instanceof Date) {
    const minutes = Math.round((activityMessage.local_timestamp.getTime() - activityMessage.timestamp.getTime()) / 60_000);
    if (minutes >= -14 * 60 && minutes <= 14 * 60) utcOffsetMinutes = minutes;
  }
  if (utcOffsetMinutes === null) notes.push('utc_offset_unknown: o FIT nao informa o fuso do relogio.');
  const rawRecords = (data.records ?? []) as Array<Record<string, unknown>>;
  if (rawRecords.length > MAX_POINTS) throw new ZeppFitError('too_large', 'FIT com registros demais.');

  const multiplier = profile.runningCadenceMultiplier;
  const sport = typeof session.sport === 'string' ? session.sport : null;
  const subSport = typeof session.sub_sport === 'string' ? session.sub_sport : null;
  const modality = modalityFromFit(sport, subSport);
  const isRunning = modality === 'corrida' || modality === 'esteira';
  let cadenceDropped = false;
  let outOfRange = 0;

  const byOffset = new Map<number, ZeppFitPoint>();
  for (const record of rawRecords) {
    const timestamp = record.timestamp instanceof Date ? record.timestamp.getTime() : null;
    if (timestamp === null) continue;
    const offsetSec = Math.round(((timestamp - start.getTime()) / 1000) * 10) / 10;
    if (offsetSec < 0) continue;
    const speed = within(num(record.enhanced_speed) ?? num(record.speed), 0, 12.5); // ate ~45 km/h: acima disso e' erro de sensor
    const hr = within(num(record.heart_rate), 30, 250);
    const cadenceRaw = within(num(record.cadence), 0, 255);
    const power = within(num(record.power), 0, 2500);
    const altitude = within(num(record.enhanced_altitude) ?? num(record.altitude), -500, 9000);
    const lat = within(num(record.position_lat), -90, 90);
    const lon = within(num(record.position_long), -180, 180);
    const validPosition = lat !== null && lon !== null && !(lat === 0 && lon === 0);
    if ((num(record.heart_rate) !== null && hr === null) || (num(record.enhanced_speed ?? record.speed) !== null && speed === null)) outOfRange += 1;
    let cadenceSpm: number | null = null;
    if (cadenceRaw !== null) {
      if (isRunning && multiplier === null) cadenceDropped = true;
      else cadenceSpm = Math.round(cadenceRaw * (isRunning ? (multiplier as number) : 1));
    }
    byOffset.set(offsetSec, {
      offsetSec,
      distanceMeters: within(num(record.distance), 0, 1_000_000),
      speedKmh: speed === null ? null : Math.round(speed * 3.6 * 1000) / 1000,
      heartRateBpm: hr === null ? null : Math.round(hr),
      cadenceSpm,
      powerWatts: power === null ? null : Math.round(power),
      elevationMeters: altitude === null ? null : Math.round(altitude * 10) / 10,
      latitude: validPosition ? lat : null,
      longitude: validPosition ? lon : null,
    });
  }
  const points = [...byOffset.values()].sort((a, b) => a.offsetSec - b.offsetSec);
  if (cadenceDropped) notes.push('cadence_unit_unconfirmed: cadencia do FIT nao gravada (fator para passos/min ainda nao confirmado).');
  if (outOfRange > 0) notes.push(`sensor_out_of_range: ${outOfRange} leitura(s) fora de limites fisicos descartada(s).`);

  const elapsed = num(session.total_timer_time) ?? num(session.total_elapsed_time);
  const durationSec = elapsed !== null && elapsed > 0 && elapsed < 48 * SECONDS_PER_HOUR ? Math.round(elapsed) : null;
  const distance = within(num(session.total_distance), 0, 1_000_000);
  const avgCadenceRaw = within(num(session.avg_cadence), 0, 255);
  let cadenceAvg: number | null = null;
  if (avgCadenceRaw !== null && avgCadenceRaw > 0) cadenceAvg = isRunning ? (multiplier === null ? null : Math.round(avgCadenceRaw * multiplier)) : Math.round(avgCadenceRaw);

  return {
    startedAt: start,
    utcOffsetMinutes,
    durationSec,
    distanceMeters: distance,
    modality,
    sportRaw: { sport, subSport },
    caloriesKcal: within(num(session.total_calories), 0, 30_000),
    avgHeartRateBpm: within(num(session.avg_heart_rate), 30, 250),
    maxHeartRateBpm: within(num(session.max_heart_rate), 30, 250),
    cadenceAvg,
    powerAvgWatts: within(num(session.avg_power), 0, 2500),
    elevationGainMeters: within(num(session.total_ascent), 0, 20_000),
    hasRoute: points.some((p) => p.latitude !== null),
    points,
    notes,
  };
}
