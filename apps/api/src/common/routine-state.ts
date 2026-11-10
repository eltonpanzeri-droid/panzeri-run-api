import { ConflictException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { canonicalModality } from '../activity-execution/canonical-modality';

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

// 09/11/2026 (ordem de Elton): so' existe CORRIDA. Linha antiga com esteira (ou corrida+esteira no mesmo dia) e' lida como UMA corrida, em QUALQUER consumidor (geracao, painel, app).
// A migracao 20261109220000 corrige o banco; esta leitura garante o mesmo resultado mesmo para linha que escape.
export function runOnlyRoutineDay<T extends { modalities: string[]; modalityDurations: unknown }>(day: T): T {
  const asRun = (item: string) => (canonicalModality(item) === 'corrida' ? 'corrida' : item);
  const modalities = [...new Set((day.modalities ?? []).map(asRun))];
  const source = day.modalityDurations && typeof day.modalityDurations === 'object' && !Array.isArray(day.modalityDurations) ? (day.modalityDurations as Record<string, unknown>) : null;
  if (!source) return { ...day, modalities };
  const durations: Record<string, unknown> = {};
  for (const [key, minutes] of Object.entries(source)) {
    const target = asRun(key);
    if (target !== key && durations[target] !== undefined) continue; // corrida informada explicitamente ganha da duracao antiga de esteira
    durations[target] = minutes;
  }
  for (const [key, minutes] of Object.entries(source)) if (asRun(key) === key) durations[key] = minutes;
  return { ...day, modalities, modalityDurations: durations };
}

type RoutineReader = Pick<PrismaClient, 'weeklyAvailability' | 'weeklyRoutineState'>;

export async function readRoutineState(prisma: RoutineReader, userId: string): Promise<RoutineState> {
  const [state, rows] = await Promise.all([
    prisma.weeklyRoutineState.findUnique({ where: { userId }, select: { revision: true } }),
    prisma.weeklyAvailability.findMany({ where: { userId }, orderBy: { weekday: 'asc' } }),
  ]);
  const days = (rows as RoutineDayRow[]).map(runOnlyRoutineDay);
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
