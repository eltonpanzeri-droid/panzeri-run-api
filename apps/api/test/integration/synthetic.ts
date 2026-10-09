import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';

// Dados 100% SINTETICOS para os testes de integracao (nada de producao, nenhum dado pessoal real).

export interface SyntheticStudent {
  userId: string;
  planId: string;
  sessionIds: string[];
  reportEntryIds: string[];
}

export async function seedStudent(prisma: PrismaClient, label: string, options: { startDate?: Date } = {}): Promise<SyntheticStudent> {
  const tag = randomUUID().slice(0, 8);
  const user = await prisma.user.create({
    data: { email: `${label}-${tag}@sintetico.invalid`, passwordHash: 'hash-sintetico', name: `Aluno Sintetico ${label}`, accountStatus: 'active', subscriptionStatus: 'active' },
  });
  const startDate = options.startDate ?? new Date('2026-09-28T00:00:00.000Z');
  const plan = await prisma.trainingPlan.create({
    data: { userId: user.id, name: `Programa ${label}`, goal: 'Correr 10km', startDate, endDate: new Date(startDate.getTime() + 6 * 86_400_000), generatedBy: 'teste-sintetico', inputSnapshot: { origem: 'sintetico' } },
  });
  const sessionIds: string[] = [];
  for (const [index, weekday] of [2, 4].entries()) {
    const session = await prisma.trainingSession.create({
      data: {
        planId: plan.id, userId: user.id, scheduledDate: new Date(startDate.getTime() + (weekday - 1) * 86_400_000), weekday, modality: 'corrida', title: 'Corrida',
        sessionType: index === 0 ? 'continuo' : 'intervalado', durationMin: 40, distanceKm: 5, paceMinSec: '8:00', structure: { type: 'run', origem: 'sintetico' }, origin: 'agent',
      },
    });
    sessionIds.push(session.id);
  }
  await prisma.workoutCompletion.create({
    data: { userId: user.id, sessionId: sessionIds[0], status: 'done', durationMin: 41, distanceKm: 5.1, avgPaceSecondsKm: 482, perceivedEffort: 6, painFlag: 'none' },
  });
  const entry = await prisma.studentReportEntry.create({
    data: {
      userId: user.id, sourceType: 'student_observation', originalText: `Minha esteira vai so ate 12 km/h (${label})`, occurredAt: new Date('2026-03-02T12:00:00Z'), analyzedAt: new Date('2026-03-02T12:01:00Z'),
      facts: 'A esteira do aluno vai so ate 12 km/h', themes: ['equipamento'], temporality: 'PERSISTENTE_ATE_CONTRARIO', relevance: 'ACOMPANHAR', hypotheses: [],
    },
  });
  return { userId: user.id, planId: plan.id, sessionIds, reportEntryIds: [entry.id] };
}

export async function cleanupStudents(prisma: PrismaClient, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const where = { userId: { in: userIds } };
  await prisma.prescriptionDecision?.deleteMany({ where }).catch(() => undefined);
  await prisma.prescriptionEvidencePackage?.deleteMany({ where }).catch(() => undefined);
  await prisma.providerConnectionEvent.deleteMany({ where });
  await prisma.studentReportEntry.deleteMany({ where });
  await prisma.studentProfileEvent.deleteMany({ where });
  await prisma.studentProfile.deleteMany({ where });
  await prisma.polarConnection.deleteMany({ where });
  await prisma.stravaConnection.deleteMany({ where });
  await prisma.wahooConnection.deleteMany({ where });
  await prisma.workoutCompletion.deleteMany({ where });
  await prisma.studentObservation.deleteMany({ where });
  await prisma.studentDirective.deleteMany({ where });
  await prisma.weeklyAvailability.deleteMany({ where });
  await prisma.onboardingInterview.deleteMany({ where });
  await prisma.userPreferences.deleteMany({ where });
  await prisma.userNotification.deleteMany({ where });
  await prisma.trainingPlanGenerationLock.deleteMany({ where });
  await prisma.weeklyExecutionReport.deleteMany({ where });
  await prisma.sessionExecutionAnalysis.deleteMany({ where });
  await prisma.sessionExecutionLink.deleteMany({ where });
  await prisma.activityTimeSeriesPoint.deleteMany({ where: { activityLog: { userId: { in: userIds } } } });
  await prisma.activityLog.deleteMany({ where });
  await prisma.rawExternalActivity.deleteMany({ where });
  await prisma.trainingSession.deleteMany({ where });
  await prisma.trainingPlan.deleteMany({ where });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
