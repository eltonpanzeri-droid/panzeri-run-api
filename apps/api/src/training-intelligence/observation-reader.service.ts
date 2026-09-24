// ObservationReaderService — le as tabelas ja existentes (WorkoutCompletion, WeeklyCheckIn) e as
// apresenta como uma representacao UNIFORME de observacao, sem criar tabela nova nem copiar dado
// bruto pra outro lugar (ver auditoria aprovada, itens "NAO FAZER AGORA").
//
// Regras que este arquivo tem que respeitar (ver CAMADA_MATEMATICA_LONGITUDINAL.md e a auditoria):
// - Missing nunca vira zero: um campo null simplesmente nao gera Observation.
// - Sessao-fantasma (sessao de plano arquivado sem completion) e' excluida com a MESMA regra ja
//   usada em evolution/evolution-metric.service.ts — nao inventa uma segunda interpretacao.
// - Sessao extra (criada pelo proprio aluno) so' e' excluida quando VariableDefinition.excludeExtraSessions
//   diz que deve ser (ver variable-registry.ts) — nao exclui por padrao.
// - Nunca mistura silenciosamente duas versoes de instrumento semanticamente diferentes: toda
//   observacao carrega instrumentVersion, e o consumidor (endpoint) decide o que fazer com isso.
// - Sempre e' possivel voltar ao registro original (sessionId/checkinId ficam no context).

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SATISFACTION_SCORE } from '../workout-completions/workout-completions.service';
import { getVariableDefinition, InstrumentVersionSpec, VariableDefinition } from './variable-registry';

export interface Observation {
  athleteId: string;
  variableId: string;
  value: number;
  timestamp: Date;
  source: 'student_feedback_per_workout' | 'student_weekly_checkin';
  instrumentVersion: number;
  context: {
    sessionId?: string;
    workoutCompletionId?: string;
    checkinId?: string;
    modality?: string;
    scheduledDate?: string;
    isExtra?: boolean;
  };
}

type StructureShape = { source?: unknown; type?: unknown };

function isExtraSession(structure: unknown): boolean {
  const obj = typeof structure === 'object' && structure !== null ? (structure as StructureShape) : {};
  return obj.source === 'student' && obj.type === 'extra';
}

/** Extrai o valor bruto de uma observacao a partir da spec de uma versao de instrumento. */
function extractRawValue(
  spec: InstrumentVersionSpec,
  completionRow: Record<string, unknown>,
  detailsJson: Record<string, unknown>,
): unknown {
  if (spec.storageLocation === 'details_json' && spec.detailsKey) {
    return detailsJson[spec.detailsKey];
  }
  if (spec.field) {
    return completionRow[spec.field];
  }
  return undefined;
}

/** Converte o valor bruto (numero ou categoria conhecida) num numero, ou undefined se nao aplicavel. */
function toNumericValue(variableId: string, raw: unknown): number | undefined {
  if (raw == null) return undefined; // ausencia — nunca vira zero
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') {
    if (variableId === 'workout.satisfactionElaboracao' && raw in SATISFACTION_SCORE) {
      return SATISFACTION_SCORE[raw];
    }
    const asNumber = Number(raw);
    return Number.isFinite(asNumber) ? asNumber : undefined;
  }
  return undefined;
}

@Injectable()
export class ObservationReaderService {
  constructor(private readonly prisma: PrismaService) {}

  async getObservations(athleteId: string, variableId: string): Promise<Observation[]> {
    const definition = getVariableDefinition(variableId);
    if (!definition) {
      throw new NotFoundException(`Variavel desconhecida no VariableRegistry: ${variableId}`);
    }

    if (definition.source === 'student_feedback_per_workout') {
      return this.readWorkoutVariable(athleteId, definition);
    }
    return this.readCheckinVariable(athleteId, definition);
  }

  // -----------------------------------------------------------------------------------------
  // Feedback por treino (WorkoutCompletion)
  // -----------------------------------------------------------------------------------------

  private async readWorkoutVariable(athleteId: string, definition: VariableDefinition): Promise<Observation[]> {
    const sessions = await this.prisma.trainingSession.findMany({
      where: { userId: athleteId },
      include: { completion: true, plan: { select: { status: true } } },
      orderBy: { scheduledDate: 'asc' },
    });

    // Mesma regra de sessao-fantasma de evolution-metric.service.ts: so conta sessao de plano
    // ativo, OU qualquer sessao (mesmo de plano ja arquivado) que tenha completion de verdade.
    const relevant = sessions.filter((s) => s.plan?.status === 'active' || s.completion !== null);

    const observations: Observation[] = [];

    for (const session of relevant) {
      const completion = session.completion;
      if (!completion) continue; // sem feedback registrado — ausencia, nao observacao

      const extra = isExtraSession(session.structure);
      if (definition.excludeExtraSessions && extra) continue;

      const version = completion.feedbackVersion;
      const spec = definition.versions.find((v) => v.version === version);
      if (!spec) continue; // esta variavel nao e' coletada nesta versao de instrumento

      const detailsJson =
        typeof completion.details === 'object' && completion.details !== null
          ? (completion.details as Record<string, unknown>)
          : {};

      const raw = extractRawValue(spec, completion as unknown as Record<string, unknown>, detailsJson);
      const value = toNumericValue(definition.variableId, raw);
      if (value === undefined) continue; // ausencia — nunca vira zero

      observations.push({
        athleteId,
        variableId: definition.variableId,
        value,
        timestamp: completion.completedAt,
        source: 'student_feedback_per_workout',
        instrumentVersion: version,
        context: {
          sessionId: session.id,
          workoutCompletionId: completion.id,
          modality: session.modality,
          scheduledDate: session.scheduledDate.toISOString().slice(0, 10),
          isExtra: extra,
        },
      });
    }

    return observations;
  }

  // -----------------------------------------------------------------------------------------
  // Check-in semanal (WeeklyCheckIn)
  // -----------------------------------------------------------------------------------------

  private async readCheckinVariable(athleteId: string, definition: VariableDefinition): Promise<Observation[]> {
    const checkins = await this.prisma.weeklyCheckIn.findMany({
      where: { userId: athleteId, checkinSkipped: false },
      orderBy: { weekStartDate: 'asc' },
    });

    const observations: Observation[] = [];

    for (const checkin of checkins) {
      const version = checkin.checkinVersion;
      const spec = definition.versions.find((v) => v.version === version);
      if (!spec) continue;

      const raw = extractRawValue(spec, checkin as unknown as Record<string, unknown>, {});
      const value = toNumericValue(definition.variableId, raw);
      if (value === undefined) continue;

      observations.push({
        athleteId,
        variableId: definition.variableId,
        value,
        timestamp: checkin.weekStartDate,
        source: 'student_weekly_checkin',
        instrumentVersion: version,
        context: { checkinId: checkin.id },
      });
    }

    return observations;
  }
}
