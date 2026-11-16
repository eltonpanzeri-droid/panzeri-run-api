import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { readRoutineState } from '../common/routine-state';
import { Prisma } from '@prisma/client';
import {
  normalizeStrengthSplitAnswer, parseStrengthSplitRecord, STRENGTH_SPLIT_GROUPS, STRENGTH_SPLIT_LABEL, strengthSplitPending, type StrengthSplitAnswer,
} from '../common/strength-split';

// Preferencia de divisao da musculacao por dia (16/11/2026). Leitura e gravacao da resposta da aluna; ver common/strength-split.ts. Gravar NAO muda a rotina nem a revisao dela.
const strengthDaysOf = (days: Array<{ weekday: number; noTraining: boolean; modalities: string[] }>) => days.filter((day) => !day.noTraining && day.modalities.includes('forca')).map((day) => day.weekday).sort((a, b) => a - b);

@Injectable()
export class StrengthSplitService {
  constructor(private readonly prisma: PrismaService) {}

  async status(userId: string) {
    const [routine, state] = await Promise.all([readRoutineState(this.prisma, userId), this.prisma.weeklyRoutineState.findUnique({ where: { userId }, select: { strengthSplit: true } })]);
    const strengthDays = strengthDaysOf(routine.days);
    const record = parseStrengthSplitRecord(state?.strengthSplit);
    const current = record && record.answeredRevision === routine.revision ? { hasPreference: record.hasPreference, days: record.days } : null;
    return {
      revision: routine.revision,
      applies: strengthDays.length > 0,
      pending: strengthSplitPending(record, routine.revision, strengthDays),
      strengthDays,
      current,
      // Resposta anterior (de outra revisao da rotina) serve so' para pre-preencher a tela; nunca vale para a IA.
      previous: !current && record ? { hasPreference: record.hasPreference, days: record.days } : null,
      groups: STRENGTH_SPLIT_GROUPS.map((id) => ({ id, label: STRENGTH_SPLIT_LABEL[id] })),
    };
  }

  async save(userId: string, answer: StrengthSplitAnswer & { expectedRevision: number }) {
    const outcome = await this.prisma.$transaction(async (tx) => {
      // mesma trava da gravacao da rotina: a resposta e' conferida contra a rotina que existe AGORA
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`routine:${userId}`}))::text AS locked`;
      const routine = await readRoutineState(tx, userId);
      if (routine.revision !== answer.expectedRevision) return { conflict: true as const, revision: routine.revision };
      const strengthDays = strengthDaysOf(routine.days);
      const record = normalizeStrengthSplitAnswer(answer, strengthDays, routine.revision);
      if (strengthDays.length === 0) return { conflict: false as const, record, saved: false as const };
      await tx.weeklyRoutineState.upsert({
        where: { userId },
        create: { userId, revision: routine.revision, strengthSplit: record as unknown as Prisma.InputJsonValue },
        update: { strengthSplit: record as unknown as Prisma.InputJsonValue },
      });
      return { conflict: false as const, record, saved: true as const };
    });
    if (outcome.conflict) {
      throw new ConflictException({ code: 'routine_conflict', message: 'A rotina mudou. Recarregue a tela e responda de novo.', revision: outcome.revision });
    }
    return { saved: outcome.saved, hasPreference: outcome.record.hasPreference, days: outcome.record.days };
  }
}
