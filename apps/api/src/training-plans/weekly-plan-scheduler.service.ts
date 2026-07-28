import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { TrainingPlansService } from './training-plans.service';

@Injectable()
export class WeeklyPlanSchedulerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(WeeklyPlanSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly trainingPlans: TrainingPlansService,
  ) {}

  // Um deploy no EasyPanel reinicia o processo — se isso acontecer depois das 19h de domingo
  // (horario em que o cron abaixo deveria ter rodado), o job daquela semana e simplesmente
  // perdido para sempre: o @Cron do @nestjs/schedule nao "recupera" execucoes perdidas, so
  // agenda a partir de agora em diante. Ja aconteceu na pratica (deploy as 23h de domingo,
  // ninguem via a semana seguinte nem no app nem no painel, e so na semana seguinte o job
  // rodaria de novo). Esta checagem na inicializacao cobre exatamente essa lacuna: se o
  // processo subir depois das 19h de um domingo, roda a pre-geracao na hora, sem esperar
  // o proximo domingo.
  async onApplicationBootstrap() {
    const { weekday, hour } = saoPauloWeekdayAndHour(new Date());
    if (weekday === 0 && hour >= 19) {
      this.logger.log('Inicializacao depois das 19h de domingo — rodando pre-geracao da semana seguinte como recuperacao, caso o cron agendado tenha sido perdido num deploy.');
      await this.generateNextWeekPlans();
    }
  }

  // Roda a cada 2h (nao so 1x/dia) para se autocorrigir caso a geracao de algum aluno tenha
  // falhado, ou o teste/disponibilidade/nivel de dor dele tenha mudado. Esta e a UNICA fonte
  // de auto-correcao automatica do sistema (ver TrainingPlansService.ensureCurrentPlan) — abrir
  // o app ou o painel NUNCA mais dispara geracao de IA sozinho (regra adotada em 2026-07-28,
  // depois de um incidente de gasto de token repetido so por reabertura de tela). Rodar a cada
  // 2h em vez de 1x/dia mantem a reacao a um relato de dor razoavelmente rapida (poucas horas,
  // no lugar de instantanea) sem reintroduzir geracao "ao vivo" durante a abertura de uma tela.
  @Cron('0 */2 * * *')
  async ensureWeeklyPlans() {
    const students = await this.prisma.user.findMany({
      where: { role: 'student', accountStatus: { not: 'archived' } },
      select: { id: true },
    });

    let regenerated = 0;
    for (const student of students) {
      try {
        const before = await this.prisma.trainingPlan.count({ where: { userId: student.id } });
        await this.trainingPlans.ensureCurrentPlan(student.id);
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

function saoPauloWeekdayAndHour(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', weekday: 'short', hour: '2-digit', hour12: false,
  }).formatToParts(date);
  const weekdayShort = parts.find((part) => part.type === 'weekday')?.value ?? '';
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0') % 24;
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { weekday: weekdayMap[weekdayShort] ?? -1, hour };
}
