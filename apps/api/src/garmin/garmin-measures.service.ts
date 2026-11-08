import { Controller, Get, Injectable, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { PrismaService } from '../prisma/prisma.service';
import { GARMIN_PROVIDER_ID } from './garmin.connector';

// "O que a Garmin trouxe" (08/11/2026): resumo SOMENTE LEITURA, por tipo, do que ja' foi recebido da Garmin de uma aluna — usado na tela da aluna (Dispositivos > Garmin) e na ficha dela no painel. Mostra
// quantidade, data da ultima medida e um texto curto do ultimo valor; nunca expoe token, identificador da conta Garmin nem coordenadas. Nada aqui interpreta, classifica ou diz se o valor e' bom ou ruim.
export interface GarminMeasureRow { id: string; label: string; count: number; lastAt: string | null; lastCalendarDate: string | null; text: string | null }
export interface GarminMeasuresResult {
  connected: boolean;
  grantedCategories: string[];
  grantedPurposes: string[];
  measures: GarminMeasureRow[];
}

export const GARMIN_MEASURE_LABELS: Record<string, string> = {
  activity: 'Atividades', sleep: 'Sono', hrv: 'HRV', daily: 'Dia (passos, calorias, FC de repouso)',
  lifestyle_load: 'Estresse e Body Battery', vo2_max: 'VO₂ máximo e idade fitness', body_composition: 'Peso e composição corporal',
  epoch: 'Atividade a cada 15 minutos', pulse_ox: 'Oxigenação do sangue (SpO₂)', respiration: 'Respiração', breathing_variations: 'Variações da respiração',
  health_snapshot: 'Health Snapshot', blood_pressure: 'Pressão arterial', skin_temperature: 'Temperatura da pele', nutrition: 'Nutrição', hydration: 'Hidratação',
};

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const fmt = (v: number, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toString().replace('.', ',');
function mean(map: unknown): number | null {
  if (!map || typeof map !== 'object') return null;
  const values = Object.values(map as Record<string, unknown>).map(num).filter((x): x is number => x !== null && x >= 0);
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

// Texto curto do ULTIMO valor de cada tipo (so' o que a Garmin mediu; ausente => null, nunca zero).
export function describeMeasure(kind: string, values: unknown): string | null {
  const v = (values && typeof values === 'object' ? values : {}) as Record<string, unknown>;
  const parts: string[] = [];
  const push = (label: string, value: number | null, unit = '', digits = 1) => { if (value !== null) parts.push(`${label} ${fmt(value, digits)}${unit}`); };
  switch (kind) {
    case 'lifestyle_load':
      if (v.kind === 'daily_stress_body_battery') { push('estresse médio', num(v.averageStressLevel), '', 0); const up = num(v.bodyBatteryChargedValue); const down = num(v.bodyBatteryDrainedValue); if (up !== null || down !== null) parts.push(`Body Battery ${up !== null ? '+' + fmt(up, 0) : ''}${up !== null && down !== null ? ' / ' : ''}${down !== null ? '−' + fmt(down, 0) : ''}`); }
      else parts.push('estresse e Body Battery ao longo do dia');
      break;
    case 'vo2_max': push('VO₂ máx', num(v.vo2Max)); push('bike', num(v.vo2MaxCycling)); push('idade fitness', num(v.fitnessAge), '', 0); break;
    case 'body_composition': { const g = num(v.weightInGrams); if (g !== null) parts.push(`peso ${fmt(g / 1000)} kg`); push('gordura', num(v.bodyFatInPercent), '%'); push('IMC', num(v.bodyMassIndex)); break; }
    case 'epoch': push('passos', num(v.steps), '', 0); push('em', num(v.durationInSeconds) !== null ? (num(v.durationInSeconds) as number) / 60 : null, ' min', 0); break;
    case 'pulse_ox': push('SpO₂ médio', mean(v.timeOffsetSpo2Values), '%', 0); break;
    case 'respiration': push('média', mean(v.timeOffsetEpochToBreaths), ' resp/min'); break;
    case 'breathing_variations': if (typeof v.variation === 'string' && v.variation.trim()) parts.push(`variações: ${v.variation.trim().toLowerCase()}`); break;
    case 'health_snapshot': {
      const hr = Array.isArray(v.summaries) ? (v.summaries as Array<Record<string, unknown>>).find((s) => s && s.summaryType === 'heart_rate') : undefined;
      push('FC média', num(hr?.avgValue), ' bpm', 0);
      break;
    }
    case 'blood_pressure': { const s = num(v.systolic); const d = num(v.diastolic); if (s !== null && d !== null) parts.push(`${fmt(s, 0)}/${fmt(d, 0)} mmHg`); push('pulso', num(v.pulse), '', 0); break; }
    case 'skin_temperature': push('desvio', num(v.avgDeviationCelsius), ' °C'); break;
    case 'nutrition': push('', num((v.dailyNutritionIntake as Record<string, unknown> | undefined)?.kiloCalories), ' kcal', 0); break;
    case 'hydration': push('', num(v.fluidIntakeInML), ' mL', 0); break;
    default: return null;
  }
  const text = parts.join(' · ').replace(/\s+/g, ' ').trim();
  return text || null;
}

@Injectable()
export class GarminMeasuresService {
  constructor(private readonly prisma: PrismaService) {}

  async forUser(userId: string): Promise<GarminMeasuresResult> {
    const provider = GARMIN_PROVIDER_ID;
    const connection = await this.prisma.providerConnection.findUnique({ where: { provider_userId: { provider, userId } }, select: { disconnectedAt: true, grantedCategories: true, grantedPurposes: true } });
    const asStrings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : []);
    const [activityCount, lastActivity, sleepCount, lastSleep, hrvCount, lastHrv, dailyCount, lastDaily, metricCounts, lastMetrics] = await Promise.all([
      this.prisma.activityLog.count({ where: { userId, provider } }),
      this.prisma.activityLog.findFirst({ where: { userId, provider }, orderBy: { startedAt: 'desc' }, select: { startedAt: true, sport: true, distanceMeters: true, durationSec: true } }),
      this.prisma.wearableSleepSummary.count({ where: { userId, provider } }),
      this.prisma.wearableSleepSummary.findFirst({ where: { userId, provider }, orderBy: { startTimeSec: 'desc' }, select: { calendarDate: true, startTimeSec: true, durationSec: true, scoreValue: true } }),
      this.prisma.wearableHrvSummary.count({ where: { userId, provider } }),
      this.prisma.wearableHrvSummary.findFirst({ where: { userId, provider }, orderBy: { startTimeSec: 'desc' }, select: { calendarDate: true, startTimeSec: true, lastNightAvg: true } }),
      this.prisma.wearableDailySummary.count({ where: { userId, provider } }),
      this.prisma.wearableDailySummary.findFirst({ where: { userId, provider }, orderBy: { startTimeSec: 'desc' }, select: { calendarDate: true, startTimeSec: true, steps: true, restingHeartRateBpm: true, activeKilocalories: true } }),
      this.prisma.wearableMetricRecord.groupBy({ by: ['metricKind'], where: { userId, provider }, _count: { _all: true } }),
      this.prisma.wearableMetricRecord.findMany({ where: { userId, provider }, orderBy: [{ metricKind: 'asc' }, { startTimeSec: 'desc' }], distinct: ['metricKind'], select: { metricKind: true, calendarDate: true, startTimeSec: true, values: true } }),
    ]);
    const iso = (sec: number | null | undefined) => (typeof sec === 'number' ? new Date(sec * 1000).toISOString() : null);
    const measures: GarminMeasureRow[] = [];
    const activityText = lastActivity ? [lastActivity.sport, lastActivity.distanceMeters != null ? `${fmt(lastActivity.distanceMeters / 1000, 2)} km` : null, lastActivity.durationSec != null ? `${fmt(lastActivity.durationSec / 60, 0)} min` : null].filter(Boolean).join(' · ') : null;
    measures.push({ id: 'activity', label: GARMIN_MEASURE_LABELS.activity, count: activityCount, lastAt: lastActivity?.startedAt.toISOString() ?? null, lastCalendarDate: null, text: activityText });
    measures.push({ id: 'sleep', label: GARMIN_MEASURE_LABELS.sleep, count: sleepCount, lastAt: iso(lastSleep?.startTimeSec), lastCalendarDate: lastSleep?.calendarDate ?? null, text: lastSleep ? [lastSleep.durationSec != null ? `${fmt(lastSleep.durationSec / 3600)} h` : null, lastSleep.scoreValue != null ? `pontuação ${lastSleep.scoreValue}` : null].filter(Boolean).join(' · ') || null : null });
    measures.push({ id: 'hrv', label: GARMIN_MEASURE_LABELS.hrv, count: hrvCount, lastAt: iso(lastHrv?.startTimeSec), lastCalendarDate: lastHrv?.calendarDate ?? null, text: lastHrv ? `média da noite ${fmt(lastHrv.lastNightAvg, 0)}` : null });
    measures.push({ id: 'daily', label: GARMIN_MEASURE_LABELS.daily, count: dailyCount, lastAt: iso(lastDaily?.startTimeSec), lastCalendarDate: lastDaily?.calendarDate ?? null, text: lastDaily ? [lastDaily.steps != null ? `${fmt(lastDaily.steps, 0)} passos` : null, lastDaily.restingHeartRateBpm != null ? `FC de repouso ${lastDaily.restingHeartRateBpm}` : null].filter(Boolean).join(' · ') || null : null });
    const countOf = new Map(metricCounts.map((row) => [row.metricKind, row._count._all]));
    const lastOf = new Map(lastMetrics.map((row) => [row.metricKind, row]));
    for (const kind of ['lifestyle_load', 'vo2_max', 'body_composition', 'epoch', 'pulse_ox', 'respiration', 'breathing_variations', 'health_snapshot', 'blood_pressure', 'skin_temperature', 'nutrition', 'hydration']) {
      const last = lastOf.get(kind);
      measures.push({ id: kind, label: GARMIN_MEASURE_LABELS[kind], count: countOf.get(kind) ?? 0, lastAt: iso(last?.startTimeSec), lastCalendarDate: last?.calendarDate ?? null, text: last ? describeMeasure(kind, last.values) : null });
    }
    return { connected: Boolean(connection && !connection.disconnectedAt), grantedCategories: asStrings(connection?.grantedCategories), grantedPurposes: asStrings(connection?.grantedPurposes), measures };
  }
}

// Aluna: so' os PROPRIOS dados (o id vem do JWT).
@Controller('garmin')
export class GarminMeasuresController {
  constructor(private readonly measures: GarminMeasuresService) {}

  @UseGuards(AuthGuard('jwt'))
  @Get('measures')
  mine(@CurrentUser() user: CurrentUserPayload) {
    return this.measures.forUser(user.sub);
  }
}

// Treinador/admin: a ficha da aluna no painel.
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('coach', 'admin')
@Controller('coach/students')
export class GarminCoachController {
  constructor(private readonly measures: GarminMeasuresService) {}

  @Get(':studentId/garmin-measures')
  forStudent(@Param('studentId') studentId: string) {
    return this.measures.forUser(studentId);
  }
}
