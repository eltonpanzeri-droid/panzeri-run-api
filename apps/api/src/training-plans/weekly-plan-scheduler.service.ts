import { BadRequestException, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TrainingPlansService } from './training-plans.service';

@Injectable()
export class WeeklyPlanSchedulerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(WeeklyPlanSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly trainingPlans: TrainingPlansService,
  ) {}

  // DESATIVADO (02/08, incidente real): esta recuperacao rodava generateNextWeekPlans() (todos
  // os alunos, um por um, cada um podendo levar minutos com retentativas da IA) toda vez que o
  // processo subisse depois das 19h de domingo. Isso vira um circulo vicioso em qualquer domingo
  // a noite em que for preciso fazer mais de um deploy: cada deploy reinicia o processo, cada
  // reinicio dispara essa varredura completa de novo do zero, interrompendo a anterior no meio —
  // e nunca da tempo de terminar antes do proximo deploy. Foi exatamente o que aconteceu e
  // manteve a API fora do ar por horas em 02/08. Motivo original (deploy destrua o cron das 19h
  // perdendo a pre-geracao daquela semana) continua real, mas o remedio piorou o problema. Se
  // sobrar algum aluno sem a semana seguinte pre-gerada por causa de um deploy nesse horario, o
  // treinador pode rodar manualmente pelo painel, ou simplesmente esperar o cron do proximo
  // domingo (ver generateNextWeekPlans abaixo).
  async onApplicationBootstrap() {}

  // REMOVIDO DE PROPOSITO (2026-07-28): existia aqui uma rotina automatica rodando de tempos em
  // tempos so pra "conferir e talvez regenerar" o plano de cada aluno. O treinador pediu
  // explicitamente para nao ter nenhuma rotina automatica assim, mesmo rodando pouco — prefere
  // que o sistema APENAS AVISE quando algo estiver desatualizado (ver
  // TrainingPlansService.checkPlanFreshness, mostrado no painel do treinador) e que a geracao so
  // aconteca por uma acao explicita: o botao "Refazer nova semana" do treinador, ou os gatilhos
  // explicitos ja existentes (concluir entrevista, mudar rotina, sincronizar disponibilidade).

  // DESATIVADO DE PROPOSITO (06/08): este metodo gerava a semana seguinte de TODOS os alunos de
  // uma vez, automaticamente, todo domingo 19h — mas isso criava dois problemas reais: uma fila
  // grande de chamadas de IA disparando ao mesmo tempo, e gasto de token a toa com alunas que
  // nao abrem o app por semanas (o treino era gerado mesmo sem ninguem ir ver). A geracao agora e
  // sob demanda: cada aluna gera a propria semana tocando o botao "Gerar treino da semana" no
  // app dela (ver TrainingPlansService.generateCurrentWeekOnDemand), a partir da hora que ela
  // tocar — nunca retroativo, nunca em massa. O metodo abaixo continua existindo (sem @Cron) so
  // porque o botao manual do painel "Gerar semana seguinte para todos" (generateNextWeekForAllStudents
  // em coach.service.ts) ainda o reaproveita como disparo explicito do treinador, quando ele
  // quiser mesmo assim gerar pra todo mundo de uma vez.
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

  // Gatilho manual do botao "Gerar semana seguinte para todos" no painel. Restrito a domingo
  // (ordem explicita do treinador, 02/08): fora desse dia, a resposta "existing" ja bloqueia a
  // maioria dos alunos (a semana seguinte deles ainda nem faz sentido existir), mas o treinador
  // quis a trava explicita mesmo assim — pra nao arriscar apertar o botao errado num dia qualquer
  // e gerar chamadas de IA pra um monte de aluno sem necessidade real. So domingo (qualquer
  // horario) libera; o cron automatico das 19h continua sendo o caminho normal.
  assertManualTriggerAllowed() {
    const { weekday } = saoPauloWeekdayAndHour(new Date());
    if (weekday !== 0) {
      throw new BadRequestException('Esse botao so funciona aos domingos, pra evitar gerar a semana seguinte de todos os alunos por engano em outro dia.');
    }
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
