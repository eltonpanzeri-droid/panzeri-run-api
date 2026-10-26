import { ConflictException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

// Estado da ROTINA do aluno (26/10/2026). A rotina vigente e' WeeklyAvailability (uma linha por dia). Aqui so' se decide o que ela SIGNIFICA:
//   - nunca cadastrada:     nenhuma linha e nenhum registro de estado  -> o app pede o formulario da rotina; nada e' inventado nem recuperado da entrevista;
//   - cadastrada, com dias: ha ao menos um dia com treino              -> uso normal;
//   - cadastrada, pausa:    linhas existem mas os sete dias sao descanso -> rotina VALIDA (indisponibilidade total), nunca "ausencia de cadastro".
// Alunos legados (linhas sem registro de estado) contam como cadastrados, revisao 0 — nada e' apagado nem alterado para isso.

export interface RoutineDayRow {
  weekday: number;
  noTraining: boolean;
  modalities: string[];
  availableMin: number | null;
  modalityDurations: unknown;
}

export interface RoutineState {
  configured: boolean;
  revision: number;
  days: RoutineDayRow[];
  activeDays: RoutineDayRow[];
  allRest: boolean;
}

type RoutineReader = Pick<PrismaClient, 'weeklyAvailability' | 'weeklyRoutineState'>;

export async function readRoutineState(prisma: RoutineReader, userId: string): Promise<RoutineState> {
  const [state, rows] = await Promise.all([
    prisma.weeklyRoutineState.findUnique({ where: { userId }, select: { revision: true } }),
    prisma.weeklyAvailability.findMany({ where: { userId }, orderBy: { weekday: 'asc' } }),
  ]);
  const days = rows as RoutineDayRow[];
  const configured = Boolean(state) || days.length > 0;
  const activeDays = days.filter((day) => !day.noTraining);
  return { configured, revision: state?.revision ?? 0, days, activeDays, allRest: configured && activeDays.length === 0 };
}

// Usado DENTRO da transacao que publica um programa gerado: serializa com as gravacoes de rotina (mesma trava) e recusa publicar se a rotina mudou desde que a geracao comecou.
export async function assertRoutineUnchanged(
  tx: RoutineReader & { $queryRaw: PrismaClient['$queryRaw'] },
  userId: string,
  atStart: Pick<RoutineState, 'revision' | 'configured'>,
): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`routine:${userId}`}))::text AS locked`;
  const now = await readRoutineState(tx, userId);
  if (now.revision !== atStart.revision || now.configured !== atStart.configured) {
    throw new ConflictException({ code: 'routine_changed_during_generation', message: 'A rotina foi alterada enquanto o programa era gerado. Gere novamente para usar a rotina atual.' });
  }
}

export const ROUTINE_REQUIRED_CODE = 'routine_required';
export const ROUTINE_ALL_REST_CODE = 'routine_all_rest';
