import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { pickCanonicalPerEvent } from '../activity-execution/canonical-observation';
import { modalityGroup } from '../coach/training-load';
import { addDays } from '../coach/training-load';
import { parseDay, validatePeriod } from '../coach/health-recovery';
import { DISTANCE_BANDS, DISTANCE_BAND_KEYS, PLATFORM_LABEL, dominantLabel, effectiveDevice, normalizeKey, type DistanceBandKey } from './equipment-core';
import { analyzeEquipment, modelOptionValue, MIN_GROUP_STUDENTS, type AnalysisData, type AnalysisFilters } from './equipment-analysis';
import { loadShoeUsageFacts } from './shoe-facts';

// Inteligencia de Equipamentos (23/10/2026) — painel do treinador. SOMENTE LEITURA e SO' AGREGADOS: nenhum nome, id ou e-mail de aluno sai daqui. Strava nunca fornece dado (politica de dados).
// A conta em si esta em equipment-analysis.ts (pura e testada); este servico so' le o banco e aplica os filtros combinaveis.

const HIDDEN_PROVIDERS = ['strava'];
const spToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

const list = (value: unknown): string[] => (typeof value === 'string' ? value.split(',').map((item) => item.trim()).filter(Boolean).slice(0, 50) : []);
const num = (value: unknown, label: string): number | null => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new BadRequestException('Valor invalido em ' + label + '.');
  return parsed;
};

export type EquipmentQuery = Record<string, string | undefined>;

export function parseEquipmentFilters(query: EquipmentQuery, today: string = spToday()): AnalysisFilters {
  const day = (value: string | undefined, label: string) => {
    if (value === undefined || value === '') return null;
    const parsed = parseDay(value);
    if (!parsed) throw new BadRequestException('Data inválida em ' + label + '. Use o formato AAAA-MM-DD.');
    return parsed;
  };
  const requestedTo = day(query.to, 'data final') ?? today;
  const to = requestedTo > today ? today : requestedTo;
  const from = day(query.from, 'data inicial') ?? addDays(to, -179);
  const problem = validatePeriod(from, to);
  if (problem) throw new BadRequestException(problem);
  const shoeStatus = query.shoeStatus === 'active' || query.shoeStatus === 'retired' ? query.shoeStatus : 'all';
  const bands = list(query.bands).filter((key): key is DistanceBandKey => (DISTANCE_BAND_KEYS as string[]).includes(key));
  const shoeKmMin = num(query.shoeKmMin, 'km do tênis (mínimo)');
  const shoeKmMax = num(query.shoeKmMax, 'km do tênis (máximo)');
  const runnerKmMin = num(query.runnerKmMin, 'volume do aluno (mínimo)');
  const runnerKmMax = num(query.runnerKmMax, 'volume do aluno (máximo)');
  if (shoeKmMin != null && shoeKmMax != null && shoeKmMin > shoeKmMax) throw new BadRequestException('O km mínimo do tênis não pode ser maior que o máximo.');
  if (runnerKmMin != null && runnerKmMax != null && runnerKmMin > runnerKmMax) throw new BadRequestException('O volume mínimo não pode ser maior que o máximo.');
  return {
    from, to,
    watchBrands: list(query.watchBrands), watchModels: list(query.watchModels), platforms: list(query.platforms),
    shoeBrands: list(query.shoeBrands), shoeModels: list(query.shoeModels), shoeStatus,
    shoeKmMin, shoeKmMax, runnerKmMin, runnerKmMax,
    studentStatuses: list(query.studentStatuses),
    bands,
  };
}

@Injectable()
export class EquipmentIntelligenceService {
  constructor(private readonly prisma: PrismaService) {}

  private async loadBase() {
    const [students, devices, shoes] = await Promise.all([
      this.prisma.user.findMany({ where: { role: 'student', accountStatus: 'active' }, select: { id: true, subscriptionStatus: true } }),
      this.prisma.userDevice.findMany({ select: { userId: true, sourceProvider: true, observedManufacturer: true, observedModel: true, manufacturerBasis: true, manualManufacturer: true, manualModel: true, deviceType: true, firstSeenAt: true, lastSeenAt: true, activityCount: true } }),
      this.prisma.shoe.findMany({ select: { id: true, userId: true, brand: true, model: true, status: true } }),
    ]);
    return {
      students,
      devices: devices.map((device) => {
        const effective = effectiveDevice(device);
        return { userId: device.userId, platform: device.sourceProvider, manufacturer: effective.manufacturer, model: effective.model, deviceType: device.deviceType, firstSeenAt: device.firstSeenAt, lastSeenAt: device.lastSeenAt, activityCount: device.activityCount };
      }),
      shoes,
    };
  }

  // Opcoes dos filtros, com quantos alunos tem cada uma (para o treinador saber o que existe antes de filtrar).
  async options() {
    const base = await this.loadBase();
    const activeIds = new Set(base.students.map((student) => student.id));
    const countStudents = <T>(items: T[], keyOf: (item: T) => string, userOf: (item: T) => string, labelOf: (item: T) => string) => {
      const map = new Map<string, { labels: string[]; users: Set<string> }>();
      for (const item of items) {
        if (!activeIds.has(userOf(item))) continue;
        const entry = map.get(keyOf(item)) ?? { labels: [], users: new Set<string>() };
        entry.labels.push(labelOf(item)); entry.users.add(userOf(item));
        map.set(keyOf(item), entry);
      }
      return [...map.entries()].map(([value, entry]) => ({ value, label: dominantLabel(entry.labels), students: entry.users.size })).filter((option) => option.students >= MIN_GROUP_STUDENTS).sort((a, b) => b.students - a.students || (a.label < b.label ? -1 : 1));
    };
    const statuses = new Map<string, number>();
    for (const student of base.students) statuses.set(student.subscriptionStatus, (statuses.get(student.subscriptionStatus) ?? 0) + 1);
    return {
      watchBrands: countStudents(base.devices, (d) => normalizeKey(d.manufacturer) || 'naoidentificado', (d) => d.userId, (d) => d.manufacturer ?? 'Não identificado'),
      watchModels: countStudents(base.devices.filter((d) => d.model), (d) => modelOptionValue(d.manufacturer ?? '', d.model ?? ''), (d) => d.userId, (d) => ((d.manufacturer ? d.manufacturer + ' ' : '') + (d.model ?? '')).trim()),
      platforms: countStudents(base.devices.filter((d) => d.platform !== 'manual'), (d) => d.platform, (d) => d.userId, (d) => PLATFORM_LABEL[d.platform] ?? d.platform),
      shoeBrands: countStudents(base.shoes, (s) => normalizeKey(s.brand), (s) => s.userId, (s) => s.brand),
      shoeModels: countStudents(base.shoes, (s) => modelOptionValue(s.brand, s.model), (s) => s.userId, (s) => (s.brand + ' ' + s.model).trim()),
      studentStatuses: [...statuses.entries()].map(([value, students]) => ({ value, label: value, students })).sort((a, b) => b.students - a.students),
      bands: DISTANCE_BANDS.map((band) => ({ value: band.key, label: band.label })),
    };
  }

  async run(query: EquipmentQuery) {
    const filters = parseEquipmentFilters(query);
    const base = await this.loadBase();
    const facts = await loadShoeUsageFacts(this.prisma, { where: {}, hideProviders: HIDDEN_PROVIDERS });

    const periodStart = new Date(filters.from + 'T00:00:00Z');
    const periodEnd = new Date(filters.to + 'T23:59:59.999Z');
    const presence = await this.prisma.activityLog.groupBy({ by: ['provider', 'userId'], where: { provider: { notIn: HIDDEN_PROVIDERS }, startedAt: { gte: periodStart, lte: periodEnd } } });
    const activeByProvider = new Map<string, Set<string>>();
    for (const row of presence) activeByProvider.set(row.provider, (activeByProvider.get(row.provider) ?? new Set<string>()).add(row.userId));

    let runnerKm: Map<string, number> | null = null;
    if (filters.runnerKmMin != null || filters.runnerKmMax != null) runnerKm = await this.runnerVolume(periodStart, periodEnd);

    const data: AnalysisData = { students: base.students, devices: base.devices, shoes: base.shoes, facts, activeByProvider, runnerKm };
    const analysis = analyzeEquipment(data, filters);
    const labels = analysis.devices.byPlatform.map((row) => ({ ...row, label: PLATFORM_LABEL[row.key] ?? row.key }));
    return { generatedAt: new Date().toISOString(), filters, ...analysis, devices: { ...analysis.devices, byPlatform: labels } };
  }

  // Volume de corrida por aluno no periodo: atividades importadas, uma observacao por evento fisico, so' corrida/esteira. Calculado so' quando um filtro de volume e' pedido.
  private async runnerVolume(from: Date, to: Date): Promise<Map<string, number>> {
    const select = { id: true, userId: true, provider: true, sport: true, distanceMeters: true, physicalIdentityStatus: true, physicalEventId: true, physicalCanonicalActivityLogId: true } as const;
    type Row = { id: string; userId: string; provider: string; sport: string | null; distanceMeters: number | null; physicalIdentityStatus: string | null; physicalEventId: string | null; physicalCanonicalActivityLogId: string | null };
    const rows = (await this.prisma.activityLog.findMany({ where: { provider: { notIn: HIDDEN_PROVIDERS }, startedAt: { gte: from, lte: to } }, select })) as Row[];
    const picks = await pickCanonicalPerEvent(rows, (ids) => this.prisma.activityLog.findMany({ where: { id: { in: ids } }, select }) as Promise<Row[]>);
    const volume = new Map<string, number>();
    for (const pick of picks) {
      // A observacao canonica pode ser de um provedor oculto (Strava) mesmo que a leitura os exclua: nesse caso o evento nao fornece volume.
      if (HIDDEN_PROVIDERS.includes(pick.row.provider)) continue;
      if (modalityGroup(pick.row.sport) !== 'corrida' || !pick.row.distanceMeters || pick.row.distanceMeters <= 0) continue;
      volume.set(pick.row.userId, (volume.get(pick.row.userId) ?? 0) + pick.row.distanceMeters / 1000);
    }
    for (const [id, km] of volume) volume.set(id, Math.round(km * 100) / 100);
    return volume;
  }
}
