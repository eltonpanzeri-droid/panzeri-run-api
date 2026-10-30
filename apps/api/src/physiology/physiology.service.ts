import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { withCurrentZones, type ReferencePayload } from './operational-reference';
import { ageOn, estimateFromPerformance, estimateThresholdsAndZones, formatPaceSeconds, kmhToPaceSeconds, MODEL_VERSION, normalizeSex, resolveHrMax, zonesFrom, type Indicator, type Origin } from './physiology-models';
import { ASSESSMENT_METHODS, INDICATOR_UNITS, METHOD_LABELS, normalizeExternalResults, parsePerformedAt, type CanonicalKey, type ExternalResultsInput } from './physiology-input';
import { composeIndicators, nextReassessmentDue, selectReference } from './reference-selection';

// Testes físicos, Lote 2 (30/10/2026). Três camadas separadas:
//  1) PhysiologicalAssessment.rawResults (e FitnessTest.totalSeconds/FC/notes): o que foi informado, nunca recalculado;
//  2) PhysiologicalIndicator: valores medidos, informados ou estimados, com origem, confiança e faixa;
//  3) OperationalReference: referência vigente que a IA lê; histórico append-only, com justificativa.
// Nenhuma chamada de rede ou de IA acontece dentro das transações.

type Tx = Prisma.TransactionClient;
export interface Actor { id: string; role: string }
export interface ThreeKmInput { totalSeconds: number; avgHeartRate?: number | null; maxHeartRate?: number | null; environment: string; notes?: string | null; performedAt?: string | null }
export interface ExternalInput { method: string; methodLabel?: string | null; performedAt: string; results: ExternalResultsInput; notes?: string | null }

const MEASURED_BY_PROFESSIONAL = new Set(['ergospirometry', 'lactate']);
const brtToday = (now: Date) => new Date(now.getTime() - 3 * 3_600_000);
const dateKey = (d: Date) => d.toISOString().slice(0, 10);
const brDate = (d: Date) => `${dateKey(d).slice(8, 10)}/${dateKey(d).slice(5, 7)}/${dateKey(d).slice(0, 4)}`;

@Injectable()
export class PhysiologyService {
  private readonly logger = new Logger(PhysiologyService.name);
  constructor(private readonly prisma: PrismaService) {}

  private async userFacts(db: Pick<PrismaService, 'user'> | Tx, userId: string) {
    const user = await db.user.findUnique({ where: { id: userId }, select: { birthDate: true, sex: true } });
    if (!user) throw new NotFoundException('Aluno não encontrado.');
    return { sex: normalizeSex(user.sex), birthDate: user.birthDate };
  }

  // ---- teste de 3 km (criação, edição e recálculo usam o mesmo caminho) ----
  async saveThreeKm(userId: string, input: ThreeKmInput, testId?: string) {
    const now = new Date();
    const performedAt = input.performedAt ? parsePerformedAt(input.performedAt, brtToday(now)) : new Date(`${dateKey(brtToday(now))}T00:00:00.000Z`);
    if (!performedAt) throw new BadRequestException('Data do teste inválida. Use uma data existente que não seja futura.');
    if (testId) {
      const existing = await this.prisma.fitnessTest.findFirst({ where: { id: testId, userId, testType: '3km' }, select: { id: true } });
      if (!existing) throw new NotFoundException('Teste não encontrado.');
    }
    const facts = await this.userFacts(this.prisma, userId);
    return this.prisma.$transaction(async (tx) => {
      const test = await this.applyThreeKm(tx, userId, facts, { ...input, performedAt }, testId);
      await this.refreshReference(tx, userId);
      return test;
    });
  }

  private async applyThreeKm(tx: Tx, userId: string, facts: { sex: ReturnType<typeof normalizeSex>; birthDate: Date | null }, input: Omit<ThreeKmInput, 'performedAt'> & { performedAt: Date; source?: string; assessmentCreatedAt?: Date }, testId?: string) {
    const estimate = estimateFromPerformance({ distanceMeters: 3000, totalSeconds: input.totalSeconds, observedMaxHeartRate: input.maxHeartRate ?? null, sex: facts.sex, age: ageOn(facts.birthDate, input.performedAt) });
    const vo2 = estimate.indicators.find((i) => i.key === 'vo2max')!.value;
    const vvo2 = estimate.indicators.find((i) => i.key === 'vvo2max_kmh')!.value;
    // Colunas legadas (lidas por agentes, medalhas e painel): recebem o valor do modelo vigente. O resultado original não muda.
    const derived = { vo2maxEstimated: vo2, vvo2Kmh: vvo2, paceSecondsPerKm: Math.round(input.totalSeconds / 3), performedAt: input.performedAt, modelVersion: MODEL_VERSION };
    const raw = { totalSeconds: input.totalSeconds, avgHeartRate: input.avgHeartRate ?? null, maxHeartRate: input.maxHeartRate ?? null, environment: input.environment, notes: input.notes ?? null };
    const test = testId
      ? await tx.fitnessTest.update({ where: { id: testId }, data: { totalSeconds: input.totalSeconds, avgHeartRate: input.avgHeartRate, maxHeartRate: input.maxHeartRate, environment: input.environment, notes: input.notes, ...derived }, select: { id: true, testType: true, totalSeconds: true, paceSecondsPerKm: true, vo2maxEstimated: true, vvo2Kmh: true, environment: true, createdAt: true } })
      : await tx.fitnessTest.create({ data: { userId, testType: '3km', totalSeconds: input.totalSeconds, avgHeartRate: input.avgHeartRate, maxHeartRate: input.maxHeartRate, environment: input.environment, notes: input.notes, ...derived }, select: { id: true, testType: true, totalSeconds: true, paceSecondsPerKm: true, vo2maxEstimated: true, vvo2Kmh: true, environment: true, createdAt: true } });
    await this.persistAssessment(tx, {
      userId, method: 'three_km', methodLabel: null, performedAt: input.performedAt, source: input.source ?? 'student', enteredByUserId: userId,
      rawResults: raw, limitations: estimate.limitations, notes: input.notes ?? null, fitnessTestId: test.id, indicators: estimate.indicators, createdAt: input.assessmentCreatedAt,
    });
    return test;
  }

  // ---- avaliação externa (ergoespirometria, Cooper, 5 km, lactato, outro) ----
  async recordExternal(userId: string, input: ExternalInput, actor: Actor) {
    if (!ASSESSMENT_METHODS.includes(input.method as (typeof ASSESSMENT_METHODS)[number])) throw new BadRequestException('Método de avaliação desconhecido.');
    const now = new Date();
    const performedAt = parsePerformedAt(input.performedAt, brtToday(now));
    if (!performedAt) throw new BadRequestException('Data da avaliação inválida. Use uma data existente que não seja futura.');
    const normalized = normalizeExternalResults(input.method, input.results ?? {});
    if (normalized.errors.length > 0) throw new BadRequestException(normalized.errors);
    const facts = await this.userFacts(this.prisma, userId);
    const professional = actor.role === 'coach' || actor.role === 'admin';
    const origin: Origin = professional && MEASURED_BY_PROFESSIONAL.has(input.method) ? 'measured' : 'reported';
    const confidence = origin === 'measured' ? 'alta' : 'moderada';

    const indicators: Indicator[] = (Object.entries(normalized.indicators) as Array<[CanonicalKey, number]>).map(([key, value]) => ({
      key, value, unit: INDICATOR_UNITS[key], origin, confidence, basis: { informadoPor: professional ? 'treinador' : 'aluno' },
    }));
    const limitations: string[] = [];
    const providedKeys = new Set(indicators.map((i) => i.key));
    const provided = normalized.indicators;

    if (normalized.performance) {
      const estimate = estimateFromPerformance({
        distanceMeters: normalized.performance.distanceMeters, totalSeconds: normalized.performance.totalSeconds, sex: facts.sex, age: ageOn(facts.birthDate, performedAt),
        provided: { vo2max: provided.vo2max, vvo2max_kmh: provided.vvo2max_kmh, hrmax_bpm: provided.hrmax_bpm },
      });
      for (const item of estimate.indicators) if (!providedKeys.has(item.key as CanonicalKey)) indicators.push(item);
      limitations.push(...estimate.limitations);
    } else if (provided.vvo2max_kmh !== undefined && (provided.l1_speed_kmh === undefined || provided.l2_speed_kmh === undefined)) {
      // Resultado fisiológico sem L1/L2: estima os limiares a partir da velocidade informada, sem inventar VO₂.
      const hr = resolveHrMax({ provided: provided.hrmax_bpm ?? null, observed: null, sex: facts.sex, age: ageOn(facts.birthDate, performedAt) });
      if (hr.indicator && !providedKeys.has('hrmax_bpm')) indicators.push(hr.indicator);
      limitations.push(...hr.limitations);
      const thresholds = estimateThresholdsAndZones({ vvo2: provided.vvo2max_kmh, vo2: provided.vo2max ?? null, hrMax: hr.hrMax, hrIsReal: provided.hrmax_bpm !== undefined, sex: facts.sex, lowBase: false });
      for (const item of thresholds.indicators) if (!providedKeys.has(item.key as CanonicalKey)) indicators.push(item);
    }
    if (origin === 'reported') limitations.push('Resultados informados por quem não aplicou o teste: o Panzeri Run não confere o método nem os valores.');
    const label = input.methodLabel?.trim().slice(0, 80) || null;
    return this.prisma.$transaction(async (tx) => {
      const assessment = await this.persistAssessment(tx, {
        userId, method: input.method, methodLabel: input.method === 'other' ? label : null, performedAt, source: professional ? 'coach' : 'student', enteredByUserId: actor.id,
        rawResults: input.results as unknown as Prisma.InputJsonValue, limitations, notes: input.notes?.trim() || null, fitnessTestId: null, indicators,
      });
      await this.refreshReference(tx, userId);
      return { id: assessment.id };
    });
  }

  private async persistAssessment(tx: Tx, a: { userId: string; method: string; methodLabel: string | null; performedAt: Date; source: string; enteredByUserId: string | null; rawResults: unknown; limitations: string[]; notes: string | null; fitnessTestId: string | null; indicators: Indicator[]; createdAt?: Date }) {
    const data = {
      method: a.method, methodLabel: a.methodLabel, performedAt: a.performedAt, source: a.source, enteredByUserId: a.enteredByUserId,
      rawResults: a.rawResults as Prisma.InputJsonValue, limitations: a.limitations as unknown as Prisma.InputJsonValue, notes: a.notes,
    };
    const existing = a.fitnessTestId ? await tx.physiologicalAssessment.findUnique({ where: { fitnessTestId: a.fitnessTestId }, select: { id: true, createdAt: true } }) : null;
    // A edição de um teste de 3 km do próprio aluno substitui o resultado informado; a data de cadastro original permanece.
    const assessment = existing
      ? await tx.physiologicalAssessment.update({ where: { id: existing.id }, data })
      : await tx.physiologicalAssessment.create({ data: { ...data, userId: a.userId, fitnessTestId: a.fitnessTestId, ...(a.createdAt ? { createdAt: a.createdAt } : {}) } });
    await tx.physiologicalIndicator.deleteMany({ where: { assessmentId: assessment.id } });
    if (a.indicators.length > 0) {
      await tx.physiologicalIndicator.createMany({
        data: a.indicators.map((i) => ({
          assessmentId: assessment.id, userId: a.userId, key: i.key, value: i.value, unit: i.unit, origin: i.origin, confidence: i.confidence,
          rangeLow: i.rangeLow ?? null, rangeHigh: i.rangeHigh ?? null, modelVersion: i.origin === 'estimated' ? MODEL_VERSION : null, basis: i.basis as Prisma.InputJsonValue,
        })),
      });
    }
    return assessment;
  }

  // ---- referência operacional (camada 3), recalculada a partir das avaliações ----
  async refreshReference(tx: Tx, userId: string) {
    const built = await this.buildProfile(tx, userId);
    if (!built) return null;
    const latestTests = await tx.operationalReference.findFirst({ where: { userId, source: 'tests' }, orderBy: { version: 'desc' }, select: { payload: true } });
    if ((latestTests?.payload as { signature?: string } | null)?.signature === built.signature) return null; // nada mudou: idempotente
    const justification = `Referência recalculada a partir das avaliações: ${built.referenceLabel}. Motivo da escolha: ${built.reasonText}`;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const last = await tx.operationalReference.findFirst({ where: { userId }, orderBy: { version: 'desc' }, select: { version: true } });
      try {
        return await tx.operationalReference.create({ data: { userId, version: (last?.version ?? 0) + 1, source: 'tests', referenceAssessmentId: built.profile.reference!.assessmentId, payload: { ...built.profile, signature: built.signature } as unknown as Prisma.InputJsonValue, justification } });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
      }
    }
    throw new Error('Não foi possível gravar a referência operacional (concorrência).');
  }

  private async buildProfile(db: Pick<PrismaService, 'physiologicalAssessment' | 'user'> | Tx, userId: string) {
    const rows = await db.physiologicalAssessment.findMany({ where: { userId, domain: 'aerobic' }, include: { indicators: true } });
    const choice = selectReference(rows);
    if (!choice) return null;
    const byAssessment = new Map(rows.map((r) => [r.id, r.indicators.map((i) => ({ key: i.key, value: i.value, origin: i.origin }))]));
    const merged = composeIndicators(choice, rows, byAssessment);
    const detail = (assessmentId: string, key: string) => rows.find((r) => r.id === assessmentId)?.indicators.find((i) => i.key === key);
    const indicators = merged.map((m) => {
      const d = detail(m.assessmentId, m.key)!;
      const isSpeed = m.key.endsWith('speed_kmh') || m.key === 'vvo2max_kmh';
      return {
        key: m.key, value: m.value, unit: d.unit, origin: m.origin, confidence: d.confidence, rangeLow: d.rangeLow, rangeHigh: d.rangeHigh,
        ...(isSpeed ? { paceSecondsPerKm: Math.round(kmhToPaceSeconds(m.value)), pace: `${formatPaceSeconds(kmhToPaceSeconds(m.value))}/km` } : {}),
        from: { assessmentId: m.assessmentId, method: m.method, performedAt: dateKey(m.performedAt), fromReference: m.fromReference },
      };
    });
    const val = (key: string) => indicators.find((i) => i.key === key)?.value ?? null;
    const l1 = val('l1_speed_kmh'), l2 = val('l2_speed_kmh'), top = val('vvo2max_kmh');
    const zones = l1 != null && l2 != null && top != null ? zonesFrom({ l1, l2, vvo2: top, l1Hr: val('l1_hr_bpm'), l2Hr: val('l2_hr_bpm'), hrMax: val('hrmax_bpm') }) : null;
    const ref = choice.reference;
    const referenceLabel = `${ref.methodLabel ?? METHOD_LABELS[ref.method] ?? ref.method} | ${brDate(ref.performedAt)}`;
    const reasonText = {
      unica: 'única avaliação registrada.', mais_recente: 'avaliação mais recente.',
      ergoespirometria_ate_60_dias: 'ergoespirometria feita até 60 dias antes da avaliação mais recente.',
      mais_recente_ergoespirometria_antiga: 'avaliação mais recente (a ergoespirometria tem mais de 60 dias de diferença).',
    }[choice.reason];
    const limitations = [...new Set([...(Array.isArray(ref.limitations) ? (ref.limitations as string[]) : []), ...(merged.some((m) => !m.fromReference) ? ['Alguns indicadores vêm de outra avaliação, com método e data indicados em cada um.'] : [])])];
    const due = nextReassessmentDue(rows);
    const profile = {
      reference: { assessmentId: ref.id, method: ref.method, methodLabel: ref.methodLabel ?? METHOD_LABELS[ref.method] ?? ref.method, performedAt: dateKey(ref.performedAt), reason: choice.reason, gapDays: choice.gapDays, label: `Avaliação de referência atual: ${referenceLabel}` },
      indicators, zones, limitations, modelVersion: MODEL_VERSION,
      nextReassessmentDueAt: due ? dateKey(due) : null,
    };
    // A assinatura inclui o motivo da escolha e todas as avaliacoes existentes: uma avaliacao nova gera nova versao mesmo quando a referencia continua a mesma (a IA precisa do motivo atual).
    const signature = JSON.stringify([ref.id, choice.reason, choice.gapDays, rows.map((r) => r.id).sort(), indicators.map((i) => [i.key, i.value, i.from.assessmentId]), MODEL_VERSION]);
    return { profile, signature, referenceLabel, reasonText };
  }

  async profile(userId: string) {
    const built = await this.buildProfile(this.prisma, userId);
    const assessments = await this.prisma.physiologicalAssessment.findMany({ where: { userId }, orderBy: [{ performedAt: 'desc' }, { createdAt: 'desc' }], select: { id: true, method: true, methodLabel: true, performedAt: true, source: true, rawResults: true, createdAt: true } });
    const operational = await this.prisma.operationalReference.findFirst({ where: { userId }, orderBy: { version: 'desc' }, select: { version: true, source: true, justification: true, createdAt: true, payload: true } });
    return {
      ...(built?.profile ?? { reference: null, indicators: [], zones: null, limitations: [], modelVersion: MODEL_VERSION, nextReassessmentDueAt: null }),
      assessments: assessments.map((a) => ({ id: a.id, method: a.method, methodLabel: a.methodLabel ?? METHOD_LABELS[a.method] ?? a.method, performedAt: dateKey(a.performedAt), source: a.source, rawResults: a.rawResults, createdAt: a.createdAt })),
      operationalReference: operational ? { ...operational, payload: withCurrentZones(operational.payload as unknown as ReferencePayload) } : operational,
    };
  }

  // Histórico para gráfico e tabela: só pontos que existem (nada de ponto artificial quando o indicador falta).
  async history(userId: string, filter: { method?: string; indicator?: string }) {
    const rows = await this.prisma.physiologicalAssessment.findMany({
      where: { userId, domain: 'aerobic', ...(filter.method && filter.method !== 'all' ? { method: filter.method } : {}) },
      include: { indicators: (filter.indicator ? { where: { key: filter.indicator } } : true) as true }, orderBy: [{ performedAt: 'asc' }, { createdAt: 'asc' }],
    });
    const built = await this.buildProfile(this.prisma, userId);
    const referenceId = built?.profile.reference.assessmentId ?? null;
    return rows.map((r) => ({
      assessmentId: r.id, performedAt: dateKey(r.performedAt), method: r.method, methodLabel: r.methodLabel ?? METHOD_LABELS[r.method] ?? r.method, rawResults: r.rawResults,
      isReference: r.id === referenceId,
      indicators: r.indicators.map((i) => ({ key: i.key, value: i.value, unit: i.unit, origin: i.origin, confidence: i.confidence })),
    }));
  }

  // ---- recálculo dos 3 km antigos com o modelo vigente (idempotente; o resultado original não é tocado) ----
  async recomputeLegacy(opts: { dryRun: boolean }) {
    const tests = await this.prisma.fitnessTest.findMany({
      where: { testType: '3km', OR: [{ modelVersion: null }, { modelVersion: { not: MODEL_VERSION } }] },
      orderBy: { createdAt: 'asc' },
    });
    const users = new Set<string>();
    const sample: Array<{ id: string; totalSeconds: number; vo2Before: number; vo2After: number | null }> = [];
    let updated = 0;
    for (const test of tests) {
      const performedAt = test.performedAt ?? new Date(`${dateKey(brtToday(test.createdAt))}T00:00:00.000Z`);
      const facts = await this.userFacts(this.prisma, test.userId);
      if (opts.dryRun) {
        const e = estimateFromPerformance({ distanceMeters: 3000, totalSeconds: test.totalSeconds, observedMaxHeartRate: test.maxHeartRate, sex: facts.sex, age: ageOn(facts.birthDate, performedAt) });
        if (sample.length < 20) sample.push({ id: test.id, totalSeconds: test.totalSeconds, vo2Before: test.vo2maxEstimated, vo2After: e.indicators.find((i) => i.key === 'vo2max')?.value ?? null });
        continue;
      }
      await this.prisma.$transaction(async (tx) => {
        await this.applyThreeKm(tx, test.userId, facts, { totalSeconds: test.totalSeconds, avgHeartRate: test.avgHeartRate, maxHeartRate: test.maxHeartRate, environment: test.environment, notes: test.notes, performedAt, assessmentCreatedAt: test.createdAt }, test.id);
      });
      users.add(test.userId);
      updated += 1;
    }
    if (!opts.dryRun) for (const userId of users) await this.prisma.$transaction((tx) => this.refreshReference(tx, userId));
    this.logger.log(`recomputeLegacy dryRun=${opts.dryRun} candidatos=${tests.length} atualizados=${updated}`);
    return { dryRun: opts.dryRun, candidates: tests.length, updated, users: users.size, sample };
  }
}
