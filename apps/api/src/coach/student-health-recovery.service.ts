import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MathLayerService } from '../training-intelligence/math-layer.service';
import { rankSources, sourceKeyOf } from '../training-intelligence/wearable-source';
import { StudentIntegrationsService } from './student-integrations.service';
import {
  buildSleepNights, compareSummaries, inPeriod, parseDay, summarize, validatePeriod,
  type DayValue, type Period, type PeriodDelta, type PeriodSummary, type SleepNightView, type SleepRow,
} from './health-recovery';

// Painel do treinador > Aluno > Saude e Recuperacao (23/10/2026). SOMENTE LEITURA, sem tabela nova: le as mesmas linhas Wearable* que o Atlas usa (Zepp e Health Connect).
//
// CONTROLE DE ACESSO (aluna x finalidade x categoria): so' aparece o que a aluna autorizou. A autorizacao vem do MESMO calculo da aba Integracoes (conexao ativa, texto vigente,
// categoria concedida). A finalidade 'coach_view' (treinador ve os dados) e' OBRIGATORIA e fixa nos documentos das duas conexoes — este servico nao a consulta por separado.
// Categoria nao autorizada => nada dessa fonte aparece e o painel diz "nao autorizada" (estado derivado da AUTORIZACAO, nunca de existirem linhas ocultas), nunca mostra o dado. Nenhum valor de uma fonte e' misturado com o de outra: cada indicador e' mostrado para UMA fonte por vez.

export type IndicatorId = 'sleep' | 'hrv' | 'restingHr' | 'steps' | 'activeKcal';
type Category = 'sleep' | 'hrv' | 'restingHr' | 'daily';

// Ids de categoria na aba Integracoes: Zepp usa 'resting_heart_rate'; o Health Connect (grupos de consentimento) usa 'resting_hr'.
const CATEGORY_ID: Record<string, Record<Category, string>> = {
  zepp: { sleep: 'sleep', hrv: 'hrv', restingHr: 'resting_heart_rate', daily: 'daily' },
  health_connect: { sleep: 'sleep', hrv: 'hrv', restingHr: 'resting_hr', daily: 'daily' },
};
const INDICATOR_CATEGORY: Record<IndicatorId, Category> = { sleep: 'sleep', hrv: 'hrv', restingHr: 'restingHr', steps: 'daily', activeKcal: 'daily' };
const INDICATOR_LABEL: Record<IndicatorId, { label: string; unit: string }> = {
  sleep: { label: 'Sono', unit: 'min' },
  hrv: { label: 'Variabilidade da frequência cardíaca (HRV)', unit: '' },
  restingHr: { label: 'Frequência cardíaca de repouso', unit: 'bpm' },
  steps: { label: 'Passos', unit: 'passos' },
  activeKcal: { label: 'Calorias ativas', unit: 'kcal' },
};

export interface SourceInfo {
  key: string;
  name: string;
  /** Dias com dado (em todo o historico). */
  n: number;
  firstDate: string;
  lastDate: string;
  /** Ultima vez que esta fonte entregou dado deste indicador ao servidor. */
  lastReceivedAt: string | null;
}

export type IndicatorState = 'ok' | 'sem_dados_no_periodo' | 'sem_dados' | 'nao_autorizada' | 'fonte_sem_este_indicador';

export interface IndicatorBlock {
  id: IndicatorId;
  label: string;
  unit: string;
  state: IndicatorState;
  sources: SourceInfo[];
  selectedSource: string | null;
  mainSource: string | null;
  /** Mais de uma fonte autorizada com dado: os valores NAO sao comparaveis entre fontes. */
  mixedSources: boolean;
  methodNote: string | null;
  points: DayValue[];
  summary: PeriodSummary;
  compare: { summary: PeriodSummary; delta: PeriodDelta } | null;
}

export interface SleepBlock extends Omit<IndicatorBlock, 'id' | 'points' | 'summary' | 'compare'> {
  id: 'sleep';
  nights: SleepNightView[];
  /** Resumo do TOTAL da noite (so' noites com total determinado). */
  summary: PeriodSummary;
  compare: { summary: PeriodSummary; delta: PeriodDelta } | null;
  stageMeans: { deepMin: number | null; lightMin: number | null; remMin: number | null; awakeMin: number | null; napMin: number | null };
  nightsTotal: number;
  nightsWithoutSafeTotal: number;
  scorePoints: DayValue[];
}

export interface HealthRecoveryResult {
  studentId: string;
  generatedAt: string;
  period: Period;
  comparePeriod: Period | null;
  /** Primeiro e ultimo dia com algum dado autorizado (qualquer indicador/fonte). */
  availableRange: { from: string | null; to: string | null };
  requestedSource: string | null;
  /** Todas as fontes autorizadas com algum dado, para o seletor. */
  sources: Array<{ key: string; name: string }>;
  sleep: SleepBlock;
  indicators: IndicatorBlock[];
}

export interface HealthRecoveryQuery { from?: string; to?: string; source?: string; compareFrom?: string; compareTo?: string }

const SOURCE_NAME: Record<string, string> = { zepp: 'Zepp / Amazfit', health_connect: 'Health Connect' };
const ORIGIN_NAME: Record<string, string> = { 'com.sec.android.app.shealth': 'Samsung Health', 'com.google.android.apps.fitness': 'Google Fit', 'fi.polar.polarflow': 'Polar Flow', 'com.garmin.android.apps.connectmobile': 'Garmin Connect', 'com.strava': 'Strava' };
export function sourceDisplayName(key: string): string {
  if (!key.startsWith('health_connect:')) return SOURCE_NAME[key] ?? key;
  const origin = key.slice('health_connect:'.length);
  return `Health Connect · ${ORIGIN_NAME[origin] ?? (origin === 'origem_desconhecida' ? 'app não identificado' : origin)}`;
}
const METHOD_NOTE: Record<IndicatorId, (key: string) => string | null> = {
  sleep: () => null,
  hrv: (key) => (key === 'zepp'
    ? 'Média de HRV da noite anterior informada pela Zepp. A Zepp não especifica a unidade; compare apenas com a própria aluna nesta mesma fonte.'
    : key.startsWith('health_connect')
      ? 'Média de HRV (RMSSD, em milissegundos) das medições do dia, calculada a partir do Health Connect. Não é a mesma medida da Zepp.'
      : null),
  restingHr: () => null, steps: () => null, activeKcal: () => null,
};

const noonIso = (date: string) => new Date(`${date}T12:00:00.000Z`);
const todayIso = () => new Date().toISOString().slice(0, 10);
const addDays = (date: string, days: number) => new Date(noonIso(date).getTime() + days * 86_400_000).toISOString().slice(0, 10);

interface DayRow { sourceKey: string; date: string; value: number; receivedAt: Date }

@Injectable()
export class StudentHealthRecoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: StudentIntegrationsService,
    private readonly math: MathLayerService,
  ) {}

  async forStudent(studentId: string, query: HealthRecoveryQuery): Promise<HealthRecoveryResult> {
    const exists = await this.prisma.user.findUnique({ where: { id: studentId }, select: { id: true } });
    if (!exists) throw new NotFoundException('Aluno nao encontrado.');

    const parsed = (value: string | undefined, label: string) => {
      if (value === undefined || value === '') return null;
      const day = parseDay(value);
      if (!day) throw new BadRequestException(`Data inválida em ${label}. Use o formato AAAA-MM-DD.`);
      return day;
    };
    const to = parsed(query.to, 'data final') ?? todayIso();
    const from = parsed(query.from, 'data inicial') ?? addDays(to, -29);
    const problem = validatePeriod(from, to);
    if (problem) throw new BadRequestException(problem);
    const compareFrom = parsed(query.compareFrom, 'comparação (início)');
    const compareTo = parsed(query.compareTo, 'comparação (fim)');
    if ((compareFrom == null) !== (compareTo == null)) throw new BadRequestException('Informe início e fim do período de comparação.');
    const comparePeriod: Period | null = compareFrom && compareTo ? { from: compareFrom, to: compareTo } : null;
    if (comparePeriod) { const p = validatePeriod(comparePeriod.from, comparePeriod.to); if (p) throw new BadRequestException(p); }
    const period: Period = { from, to };
    const requestedSource = typeof query.source === 'string' && query.source.length > 0 && query.source.length <= 120 ? query.source : null;

    // Autorizacao por fonte e categoria (a mesma da aba Integracoes).
    const integrations = await this.integrations.forStudent(studentId);
    const authorized = (provider: string, category: Category): boolean => {
      const entry = integrations.integrations.find((i) => i.provider === provider);
      const id = CATEGORY_ID[provider]?.[category];
      return Boolean(entry && id && entry.categories.find((c) => c.id === id)?.authorized === true);
    };

    const [sleepRows, hrvRows, dailyRows] = await Promise.all([
      this.prisma.wearableSleepSummary.findMany({
        where: { userId: studentId },
        select: { id: true, provider: true, providerSummaryId: true, calendarDate: true, startTimeSec: true, startOffsetSec: true, endTimeSec: true, durationSec: true, deepSleepSec: true, lightSleepSec: true, remSleepSec: true, awakeSec: true, napTotalSec: true, scoreValue: true, receivedAt: true },
      }),
      this.prisma.wearableHrvSummary.findMany({ where: { userId: studentId }, select: { provider: true, providerSummaryId: true, calendarDate: true, lastNightAvg: true, receivedAt: true } }),
      this.prisma.wearableDailySummary.findMany({
        where: { userId: studentId },
        select: { provider: true, providerSummaryId: true, calendarDate: true, steps: true, activeKilocalories: true, restingHeartRateBpm: true, receivedAt: true },
      }),
    ]);

    // Linhas por indicador, ja' so' das fontes/categorias AUTORIZADAS.
    const sleepAllowed = sleepRows.filter((row) => authorized(row.provider, 'sleep'));
    // "Nao autorizada" = existe conexao com esta aluna e NENHUMA das conexoes autoriza a categoria (independe de haver linhas).
    const connected = Object.keys(CATEGORY_ID).filter((provider) => { const e = integrations.integrations.find((i) => i.provider === provider); return Boolean(e && e.state !== 'not_connected'); });
    const blockedCategory = (category: Category) => connected.length > 0 && connected.every((provider) => !authorized(provider, category));
    const dayRows = (rows: Array<{ provider: string; providerSummaryId: string | null; calendarDate: string; receivedAt: Date }>, pick: (row: any) => number | null | undefined, indicator: IndicatorId): DayRow[] => {
      const latest = new Map<string, DayRow>(); // uma linha por fonte+dia; se houver duas, vale a recebida por ultimo
      for (const row of rows) {
        const value = pick(row);
        if (value == null || !Number.isFinite(value)) continue;
        if (!authorized(row.provider, INDICATOR_CATEGORY[indicator])) continue;
        const key = sourceKeyOf(row.provider, row.providerSummaryId);
        const id = `${key}|${row.calendarDate}`;
        const current = latest.get(id);
        if (!current || row.receivedAt > current.receivedAt) latest.set(id, { sourceKey: key, date: row.calendarDate, value, receivedAt: row.receivedAt });
      }
      return [...latest.values()];
    };

    const byIndicator: Record<Exclude<IndicatorId, 'sleep'>, DayRow[]> = {
      hrv: dayRows(hrvRows, (r) => r.lastNightAvg, 'hrv'),
      restingHr: dayRows(dailyRows, (r) => r.restingHeartRateBpm, 'restingHr'),
      steps: dayRows(dailyRows, (r) => r.steps, 'steps'),
      activeKcal: dayRows(dailyRows, (r) => r.activeKilocalories, 'activeKcal'),
    };

    const sleepByKey = new Map<string, typeof sleepAllowed>();
    for (const row of sleepAllowed) {
      const key = sourceKeyOf(row.provider, row.providerSummaryId);
      const list = sleepByKey.get(key);
      if (list) list.push(row);
      else sleepByKey.set(key, [row]);
    }

    const sourcesOf = (rows: DayRow[]): SourceInfo[] => {
      const groups = new Map<string, DayRow[]>();
      for (const row of rows) { const l = groups.get(row.sourceKey); if (l) l.push(row); else groups.set(row.sourceKey, [row]); }
      const ranking = rankSources([...groups].map(([key, list]) => ({ key, timestamps: list.map((r) => noonIso(r.date)) })), null, new Date());
      return ranking.map((key) => infoOf(key, groups.get(key)!.map((r) => ({ date: r.date, receivedAt: r.receivedAt }))));
    };
    const infoOf = (key: string, items: Array<{ date: string; receivedAt: Date }>): SourceInfo => {
      const dates = [...new Set(items.map((i) => i.date))].sort();
      const last = items.reduce<Date | null>((max, i) => (!max || i.receivedAt > max ? i.receivedAt : max), null);
      return { key, name: sourceDisplayName(key), n: dates.length, firstDate: dates[0], lastDate: dates[dates.length - 1], lastReceivedAt: last ? last.toISOString() : null };
    };
    const pickSource = (sources: SourceInfo[]): { selected: string | null; missing: boolean } => {
      if (sources.length === 0) return { selected: null, missing: false };
      if (!requestedSource) return { selected: sources[0].key, missing: false };
      return sources.some((s) => s.key === requestedSource) ? { selected: requestedSource, missing: false } : { selected: null, missing: true };
    };
    const stateOf = (indicator: IndicatorId, sources: SourceInfo[], missing: boolean, hasInPeriod: boolean): IndicatorState => {
      if (sources.length === 0) return blockedCategory(INDICATOR_CATEGORY[indicator]) ? 'nao_autorizada' : 'sem_dados';
      if (missing) return 'fonte_sem_este_indicador';
      return hasInPeriod ? 'ok' : 'sem_dados_no_periodo';
    };

    const indicators: IndicatorBlock[] = (['hrv', 'restingHr', 'steps', 'activeKcal'] as const).map((id) => {
      const rows = byIndicator[id];
      const sources = sourcesOf(rows);
      const { selected, missing } = pickSource(sources);
      const points: DayValue[] = rows.filter((r) => r.sourceKey === selected).map((r) => ({ date: r.date, value: r.value })).sort((a, b) => (a.date < b.date ? -1 : 1));
      const inside = points.filter((p) => inPeriod(p.date, period));
      const summary = summarize(points, period, this.math);
      const compare = comparePeriod ? (() => { const s = summarize(points, comparePeriod, this.math); return { summary: s, delta: compareSummaries(s, summary) }; })() : null;
      return {
        id, label: INDICATOR_LABEL[id].label, unit: INDICATOR_LABEL[id].unit, state: stateOf(id, sources, missing, inside.length > 0),
        sources, selectedSource: selected, mainSource: sources[0]?.key ?? null, mixedSources: sources.length > 1,
        methodNote: selected ? METHOD_NOTE[id](selected) : null, points: inside, summary, compare,
      };
    });

    // Sono
    const sleepSources = [...sleepByKey].map(([key, list]) => ({ key, list }));
    const sleepRanking = rankSources(sleepSources.map(({ key, list }) => ({ key, timestamps: list.map((r) => noonIso(r.calendarDate)) })), null, new Date());
    const sleepInfos = sleepRanking.map((key) => infoOf(key, sleepByKey.get(key)!.map((r) => ({ date: r.calendarDate, receivedAt: r.receivedAt }))));
    const sleepPick = pickSource(sleepInfos);
    const sleepRowsSelected: SleepRow[] = sleepPick.selected ? (sleepByKey.get(sleepPick.selected) ?? []).map((r) => ({
      id: r.id, calendarDate: r.calendarDate, startTimeSec: r.startTimeSec, startOffsetSec: r.startOffsetSec, endTimeSec: r.endTimeSec, durationSec: r.durationSec,
      deepSleepSec: r.deepSleepSec, lightSleepSec: r.lightSleepSec, remSleepSec: r.remSleepSec, awakeSec: r.awakeSec, napTotalSec: r.napTotalSec, scoreValue: r.scoreValue,
    })) : [];
    const allNights = buildSleepNights(sleepRowsSelected);
    const nights = allNights.filter((n) => inPeriod(n.date, period));
    const totals: DayValue[] = allNights.filter((n) => n.totalMin != null).map((n) => ({ date: n.date, value: n.totalMin as number }));
    const stageMean = (pick: (n: SleepNightView) => number | null) => {
      const values = nights.map(pick).filter((v): v is number => v != null);
      return values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null;
    };
    const sleepSummary = summarize(totals, period, this.math);
    const sleep: SleepBlock = {
      id: 'sleep', label: INDICATOR_LABEL.sleep.label, unit: 'min',
      state: stateOf('sleep', sleepInfos, sleepPick.missing, nights.length > 0),
      sources: sleepInfos, selectedSource: sleepPick.selected, mainSource: sleepInfos[0]?.key ?? null, mixedSources: sleepInfos.length > 1, methodNote: null,
      nights, summary: sleepSummary,
      compare: comparePeriod ? (() => { const s = summarize(totals, comparePeriod, this.math); return { summary: s, delta: compareSummaries(s, sleepSummary) }; })() : null,
      stageMeans: { deepMin: stageMean((n) => n.deepMin), lightMin: stageMean((n) => n.lightMin), remMin: stageMean((n) => n.remMin), awakeMin: stageMean((n) => n.awakeMin), napMin: stageMean((n) => n.napMin) },
      nightsTotal: nights.length, nightsWithoutSafeTotal: nights.filter((n) => n.totalMin == null).length,
      scorePoints: nights.flatMap((n) => { const s = n.sessions.find((x) => x.role === 'principal')?.scoreValue; return s == null ? [] : [{ date: n.date, value: s }]; }),
    };

    // Fontes para o seletor e intervalo disponivel
    const sourceMap = new Map<string, string>();
    for (const info of [...sleepInfos, ...indicators.flatMap((i) => i.sources)]) sourceMap.set(info.key, info.name);
    const dates = [...sleepInfos, ...indicators.flatMap((i) => i.sources)].flatMap((i) => [i.firstDate, i.lastDate]).sort();

    return {
      studentId, generatedAt: new Date().toISOString(), period, comparePeriod,
      availableRange: { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null },
      requestedSource, sources: [...sourceMap].map(([key, name]) => ({ key, name })).sort((a, b) => (a.key < b.key ? -1 : 1)),
      sleep, indicators,
    };

  }
}
