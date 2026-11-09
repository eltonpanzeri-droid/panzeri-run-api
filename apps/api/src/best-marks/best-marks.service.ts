import { Controller, Get, Injectable, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { pickCanonicalPerEvent } from '../activity-execution/canonical-observation';
import { isRunModality } from '../activity-execution/canonical-modality';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { activityLocalDate } from '../common/local-date';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { PrismaService } from '../prisma/prisma.service';
import { computeBestMarks, DistanceMarks, MarkActivity, selfReportedRuns, SelfReportedRun } from './best-marks';

// Melhores marcas (09/11/2026): leitura somente-leitura. Fonte: atividades do relogio (ActivityLog, ja' sem excluidas/ignoradas pelo filtro central do Prisma), registros manuais e teste de 3 km.
// Nada e' guardado: a marca e' recalculada a cada leitura (excluir/ignorar uma atividade corrige a marca sozinho). Lote 1 = API; telas e bloco do prontuario vem nos proximos lotes.
export interface BestMarksResult {
  marks: DistanceMarks[];
  selfReported: SelfReportedRun[];
  notes: string[];
}

@Injectable()
export class BestMarksService {
  constructor(private readonly prisma: PrismaService) {}

  async forUser(userId: string): Promise<BestMarksResult> {
    const activities: MarkActivity[] = [];

    // 1) Atividades do relogio: so' corrida (esteira = corrida), UMA observacao por evento fisico.
    const logs = await this.prisma.activityLog.findMany({ where: { userId, distanceMeters: { gte: 1000 } } });
    const runs = logs.filter((row) => isRunModality(row.sport));
    const picks = await pickCanonicalPerEvent(runs, (ids) => this.prisma.activityLog.findMany({ where: { userId, id: { in: ids } } }));
    for (const { row } of picks) {
      const points = await this.loadSeries(row.id);
      activities.push({ id: row.id, source: 'device', provider: row.provider, startedAt: row.startedAt, localDate: activityLocalDate(row.startedAt, row.utcOffsetMinutes), distanceMeters: row.distanceMeters, durationSec: row.durationSec, series: points });
    }

    // 2) Registro manual: conclusao de sessao de corrida SEM atividade do relogio vinculada nem copia do aparelho.
    const completions = await this.prisma.workoutCompletion.findMany({
      where: { userId, status: { not: 'missed' }, distanceKm: { gte: 1 }, durationMin: { gt: 0 }, session: { modality: { in: ['corrida', 'esteira'] }, origin: { not: 'device_extra' }, executionLinks: { none: { status: 'active' } } } },
      select: { id: true, completedAt: true, distanceKm: true, durationMin: true, session: { select: { scheduledDate: true } } },
    });
    for (const completion of completions) {
      activities.push({ id: `manual:${completion.id}`, source: 'manual', provider: null, startedAt: completion.session?.scheduledDate ?? completion.completedAt, localDate: completion.session?.scheduledDate ? completion.session.scheduledDate.toISOString().slice(0, 10) : activityLocalDate(completion.completedAt), distanceMeters: (completion.distanceKm as number) * 1000, durationSec: Math.round((completion.durationMin as number) * 60), series: [] });
    }

    // 3) Teste de 3 km (tempo total do teste).
    const tests = await this.prisma.fitnessTest.findMany({ where: { userId, testType: '3km' }, select: { id: true, totalSeconds: true, performedAt: true, createdAt: true } });
    for (const test of tests) {
      activities.push({ id: `test:${test.id}`, source: 'test', provider: null, startedAt: test.performedAt ?? test.createdAt, localDate: test.performedAt ? test.performedAt.toISOString().slice(0, 10) : activityLocalDate(test.createdAt), distanceMeters: 3000, durationSec: test.totalSeconds, series: [] });
    }

    const interview = await this.prisma.onboardingInterview.findUnique({ where: { userId }, select: { answers: true } });
    const answers = interview?.answers && typeof interview.answers === 'object' && !Array.isArray(interview.answers) ? (interview.answers as Record<string, unknown>) : {};

    return {
      marks: computeBestMarks(activities),
      selfReported: selfReportedRuns(answers),
      notes: [
        'As marcas usam o tempo total da atividade, incluindo paradas.',
        'Dentro de uma corrida mais longa, um trecho so conta se o relogio nao foi pausado nele; andar durante o trecho conta como tempo.',
        'Marcas informadas por voce aparecem como manuais. O relato da entrevista fica a parte e nao entra nas marcas registradas.',
      ],
    };
  }

  // Serie canonica da atividade (versao de normalizacao mais recente); uma atividade por vez para limitar memoria.
  private async loadSeries(activityLogId: string) {
    const latest = await this.prisma.activityTimeSeriesPoint.findFirst({ where: { activityLogId }, orderBy: { normalizationVersion: 'desc' }, select: { normalizationVersion: true } });
    if (!latest) return [];
    const rows = await this.prisma.activityTimeSeriesPoint.findMany({ where: { activityLogId, normalizationVersion: latest.normalizationVersion }, orderBy: { offsetSec: 'asc' }, select: { offsetSec: true, distanceMeters: true } });
    return rows;
  }
}

// Aluna: so' as PROPRIAS marcas (o id vem do JWT).
@Controller('me/best-marks')
export class BestMarksController {
  constructor(private readonly marks: BestMarksService) {}

  @UseGuards(AuthGuard('jwt'))
  @Get()
  mine(@CurrentUser() user: CurrentUserPayload) {
    return this.marks.forUser(user.sub);
  }
}

// Treinador/admin: a ficha da aluna no painel.
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('coach', 'admin')
@Controller('coach/students')
export class BestMarksCoachController {
  constructor(private readonly marks: BestMarksService) {}

  @Get(':studentId/best-marks')
  forStudent(@Param('studentId') studentId: string) {
    return this.marks.forUser(studentId);
  }
}
