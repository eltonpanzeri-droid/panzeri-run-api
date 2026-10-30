import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ageOn, estimateFromPerformance, formatPaceSeconds, kmhToPaceSeconds, MODEL_VERSION, normalizeSex } from './physiology-models';
import { buildAgentView, validateAdjustment, type AdjustmentProposal, type AgentReferenceView, type ReferencePayload, type ReferenceRow } from './operational-reference';

// Camada 3 (referência operacional) vista pelos agentes de IA (Testes físicos, Lote 4, 30/10/2026).
// Fonte única: IA de prescrição, Gerente Técnico, Agente de Evolução e resumo do atleta leem daqui, para não haver divergência entre eles.
// A coluna antiga de VO₂ do FitnessTest NÃO é fonte quando existe referência; para quem ainda não tem avaliações na estrutura nova, o 3 km
// mais recente é recalculado NA LEITURA a partir do tempo original (nada é gravado).

const dateKey = (d: Date) => d.toISOString().slice(0, 10);
const brtDay = (d: Date) => new Date(d.getTime() - 3 * 3_600_000);

@Injectable()
export class OperationalReferenceService {
  private readonly logger = new Logger(OperationalReferenceService.name);
  constructor(private readonly prisma: PrismaService) {}

  private async rows(userId: string): Promise<ReferenceRow[]> {
    const rows = await this.prisma.operationalReference.findMany({ where: { userId }, orderBy: { version: 'desc' }, take: 50 });
    return rows.map((r) => ({ version: r.version, source: r.source, createdAt: r.createdAt, justification: r.justification, payload: r.payload as unknown as ReferencePayload }));
  }

  // Versão vigente (qualquer origem) e versão mais recente vinda de AVALIAÇÕES; o programa guarda a segunda para avisar o treinador quando houver avaliação nova.
  async versions(userId: string): Promise<{ latest: number | null; fromTests: number | null; source: string | null }> {
    const rows = await this.rows(userId);
    return { latest: rows[0]?.version ?? null, fromTests: rows.find((r) => r.source === 'tests')?.version ?? null, source: rows[0]?.source ?? null };
  }

  async getAgentView(userId: string, now: Date = new Date()): Promise<AgentReferenceView | null> {
    const rows = await this.rows(userId);
    if (rows.length > 0) {
      const testsVersion = rows.find((r) => r.source === 'tests')?.version ?? 0;
      const adjustments = rows.filter((r) => r.source !== 'tests' && r.version > testsVersion).slice(0, 5).reverse();
      return buildAgentView(rows[0], adjustments, now);
    }
    // Compatibilidade: aluno com 3 km antigo e ainda sem a estrutura nova.
    const test = await this.prisma.fitnessTest.findFirst({ where: { userId, testType: '3km' }, orderBy: { createdAt: 'desc' } });
    if (!test) return null;
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { birthDate: true, sex: true } });
    const performedAt = test.performedAt ?? new Date(`${dateKey(brtDay(test.createdAt))}T00:00:00.000Z`);
    const estimate = estimateFromPerformance({ distanceMeters: 3000, totalSeconds: test.totalSeconds, observedMaxHeartRate: test.maxHeartRate, sex: normalizeSex(user?.sex), age: ageOn(user?.birthDate ?? null, performedAt) });
    const payload: ReferencePayload = {
      reference: { assessmentId: test.id, method: 'three_km', performedAt: dateKey(performedAt), reason: 'unica' },
      indicators: estimate.indicators.map((i) => ({
        key: i.key, value: i.value, unit: i.unit, origin: i.origin, confidence: i.confidence, rangeLow: i.rangeLow ?? null, rangeHigh: i.rangeHigh ?? null,
        ...(i.unit === 'km/h' ? { pace: `${formatPaceSeconds(kmhToPaceSeconds(i.value))}/km` } : {}),
      })),
      zones: estimate.zones, limitations: estimate.limitations, modelVersion: MODEL_VERSION,
    };
    const view = buildAgentView({ version: 0, source: 'tests', createdAt: test.createdAt, justification: '', payload }, [], now);
    return { ...view, fonte: 'teste_de_3km_recalculado_na_leitura', versao: null, origemDaVersao: 'legado' };
  }

  // Trajetoria fisica completa para o Agente de Evolucao: avaliacoes (resultado ORIGINAL e indicadores de cada uma), referencia atual e historico da referencia
  // operacional (versoes, origem e justificativa). null = aluno sem avaliacao na estrutura nova (o chamador usa o historico legado de 3 km).
  async evolutionInput(userId: string, now: Date = new Date()) {
    const assessments = await this.prisma.physiologicalAssessment.findMany({ where: { userId }, orderBy: [{ performedAt: 'asc' }, { createdAt: 'asc' }], include: { indicators: true } });
    if (assessments.length === 0) return null;
    const rows = await this.rows(userId);
    return {
      avaliacoes: assessments.map((a) => ({
        data: dateKey(a.performedAt), metodo: a.methodLabel ?? a.method, resultadoOriginal: a.rawResults,
        indicadores: a.indicators.map((i) => ({ indicador: i.key, valor: i.value, unidade: i.unit, origem: i.origin, confianca: i.confidence })),
      })),
      referenciaAtual: await this.getAgentView(userId, now),
      historicoDaReferenciaOperacional: [...rows].reverse().map((r) => ({ versao: r.version, data: dateKey(r.createdAt), origem: r.source, justificativa: r.justification })),
    };
  }

  // Ajuste proposto pela IA (a partir dos treinos) ou pelo treinador. Valida estrutura e evidência; nunca altera as camadas 1 e 2.
  async proposeAdjustment(userId: string, proposal: AdjustmentProposal, now: Date = new Date()): Promise<{ accepted: boolean; reasons: string[]; version?: number }> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const rows = await this.rows(userId);
      const latest = rows[0];
      if (!latest) return { accepted: false, reasons: ['aluno sem referencia operacional (nenhuma avaliacao registrada)'] };
      const testsVersion = rows.find((r) => r.source === 'tests')?.version ?? 0;
      const lastAi = rows.find((r) => r.source === 'ai_adjustment' && r.version > testsVersion);
      const outcome = validateAdjustment(latest.payload, proposal, lastAi?.createdAt ?? null, now);
      if (!outcome.ok) return { accepted: false, reasons: outcome.reasons };
      const payload: ReferencePayload = {
        ...latest.payload, indicators: outcome.merged!, zones: outcome.zones ?? latest.payload.zones,
        adjustment: { proposedBy: proposal.proposedBy, evidencias: proposal.evidencias ?? [], justificativa: proposal.justificativa.trim(), changes: outcome.changes!, basedOnVersion: latest.version },
      };
      try {
        const created = await this.prisma.operationalReference.create({
          data: {
            userId, version: latest.version + 1, source: proposal.coachInitiated ? 'coach_adjustment' : 'ai_adjustment',
            referenceAssessmentId: latest.payload.reference?.assessmentId ?? null, payload: payload as unknown as Prisma.InputJsonValue, justification: proposal.justificativa.trim().slice(0, 600),
          },
        });
        this.logger.log(`Referencia operacional ajustada (${proposal.proposedBy}) aluno=${userId} versao=${created.version} mudancas=${outcome.changes!.map((c) => `${c.key}:${c.from}->${c.to}`).join(',')}`);
        return { accepted: true, reasons: [], version: created.version };
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
      }
    }
    return { accepted: false, reasons: ['concorrencia: tente novamente'] };
  }
}
