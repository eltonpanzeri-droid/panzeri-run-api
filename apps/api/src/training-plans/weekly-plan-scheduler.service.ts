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

  // PAUSADO TEMPORARIAMENTE (02/08, incidente em andamento): com o disjuntor de falha recente
  // (AI_FAILURE_COOLDOWN_MS, ver training-plans.service.ts) e varios alunos rejeitando a resposta
  // da IA por motivos legitimos (estrutura incompleta, cobertura de dias errada — nao o piso de
  // pace, que ja foi removido), essa varredura de TODOS os alunos de uma vez estava tentando e
  // falhando repetidamente, gastando tokens sem gerar nada de util. Pausado pra estancar o gasto
  // enquanto o motivo das falhas em serie e investigado com calma. @Cron comentado (nao so um
  // early-return) pra garantir que nao dispare nem por engano. Reativar so depois de entender por
  // que tantos alunos estavam falhando na validacao.
  // @Cron('0 22 * * 0')
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
