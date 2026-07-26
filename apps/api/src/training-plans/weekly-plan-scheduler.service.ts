import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { TrainingPlansService } from './training-plans.service';

@Injectable()
export class WeeklyPlanSchedulerService {
  private readonly logger = new Logger(WeeklyPlanSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly trainingPlans: TrainingPlansService,
  ) {}

  // 06:00 UTC = 03:00 no horario de Sao Paulo, antes de qualquer aluno acordar.
  // Roda todo dia (nao so segunda) para se autocorrigir caso a geracao de algum
  // aluno tenha falhado, ou o teste/disponibilidade dele tenha mudado.
  // Reaproveita exatamente a mesma logica de decisao usada quando o aluno ou o
  // treinador abrem o app (TrainingPlansService.current), entao nao ha regra
  // duplicada para manter sincronizada.
  @Cron('0 6 * * *')
  async ensureWeeklyPlans() {
    const students = await this.prisma.user.findMany({
      where: { role: 'student', accountStatus: { not: 'archived' } },
      select: { id: true },
    });

    let regenerated = 0;
    for (const student of students) {
      try {
        const before = await this.prisma.trainingPlan.count({ where: { userId: student.id } });
        await this.trainingPlans.current(student.id);
        const after = await this.prisma.trainingPlan.count({ where: { userId: student.id } });
        if (after > before) regenerated += 1;
      } catch (error) {
        this.logger.warn(`Falha ao garantir plano semanal para ${student.id}: ${(error as Error).message}`);
      }
    }

    if (regenerated) {
      this.logger.log(`Planos semanais gerados antecipadamente para ${regenerated} aluno(s).`);
    }
  }

  // 22:00 UTC de domingo = 19:00 em Sao Paulo (Brasil nao tem horario de verao desde 2019).
  // Deixa a semana seguinte pronta com antecedencia — muitas alunas se organizam no domingo a
  // noite para treinar ja segunda de manha, entao ver o treino antes ajuda no planejamento.
  @Cron('0 22 * * 0')
  async generateNextWeekPlans() {
    const students = await this.prisma.user.findMany({
      where: { role: 'student', accountStatus: { not: 'archived' } },
      select: { id: true },
    });

    for (const student of students) {
      try {
        await this.trainingPlans.generateNextWeekIfMissing(student.id);
      } catch (error) {
        this.logger.warn(`Falha ao pre-gerar a semana seguinte para ${student.id}: ${(error as Error).message}`);
      }
    }

    this.logger.log(`Pre-geracao da semana seguinte concluida para ${students.length} aluno(s).`);
  }
}
