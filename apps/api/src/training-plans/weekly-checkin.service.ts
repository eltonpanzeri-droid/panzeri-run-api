import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StravaService } from '../strava/strava.service';
import { SubmitWeeklyCheckInDto } from './dto/submit-weekly-checkin.dto';

// 31/08: dia de calendario em America/Sao_Paulo, nao no fuso do servidor (achado por auto-revisao
// — o servidor roda em UTC; entre 21h e 23h59 no horario de Brasilia, `new Date()` puro ja mostra
// "amanha", contando um treino que ainda nem aconteceu como "sem registro"). Mesma logica de
// todayInSaoPaulo() em training-plans.service.ts, duplicada aqui (nao importada de la) pra nao
// criar dependencia circular entre os dois arquivos (training-plans.service.ts ja injeta
// WeeklyCheckInService).
function todayInSaoPaulo(): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return new Date(Date.UTC(value('year'), value('month') - 1, value('day')));
}

function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

export interface WeeklyCheckInSummary {
  asPrescribedSessions: number;
  changedModalitySessions: number;
  differentSessions: number;
  missedSessions: number;
}

// 31/08: check-in obrigatorio antes do aluno gerar a proxima semana (pedido explicito do
// treinador) — nunca bloqueia por conta propria, so' quando o aluno de fato toca em "Gerar treino
// da semana" (ver TrainingPlansService.doGenerateCurrentWeekOnDemand, que consulta hasCheckedIn
// antes de consumir uma tentativa). Guarda numero, nao texto livre, de proposito: o objetivo
// declarado e' permitir analise de padrao de adesao/engajamento/risco de abandono no medio prazo,
// o que exige dado consultavel.
@Injectable()
export class WeeklyCheckInService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly strava: StravaService,
  ) {}

  async getStatus(userId: string) {
    const plan = await this.currentActivePlan(userId);
    if (!plan) return { needsCheckIn: false, summary: null, showExplanation: false };

    const existing = await this.prisma.weeklyCheckIn.findFirst({ where: { userId, planId: plan.id } });
    if (existing) return { needsCheckIn: false, summary: null, showExplanation: false };

    const [summary, totalCheckIns] = await Promise.all([
      this.computeSummary(userId, plan.id, { skipCache: true }),
      this.prisma.weeklyCheckIn.count({ where: { userId } }),
    ]);
    // Explicacao do "pra que serve" some depois das duas primeiras vezes (pedido do treinador —
    // ele espera que o aluno aprenda o padrao e nao precise mais de contexto repetido toda semana).
    return { needsCheckIn: true, summary, showExplanation: totalCheckIns < 2 };
  }

  async submit(userId: string, dto: SubmitWeeklyCheckInDto) {
    const plan = await this.currentActivePlan(userId);
    if (!plan) throw new BadRequestException('Nenhum plano ativo encontrado para registrar o check-in.');

    const existing = await this.prisma.weeklyCheckIn.findFirst({ where: { userId, planId: plan.id } });
    if (existing) return existing; // idempotente — reenvio nao duplica nem sobrescreve

    // 31/08: usa os numeros que vieram no proprio envio (o que o aluno viu e confirmou na tela de
    // GET .../status), em vez de recalcular aqui — achado por auto-revisao: recalcular podia
    // divergir do que foi realmente confirmado se algo mudasse (webhook do Strava, edicao em outro
    // aparelho) no meio do tempo entre abrir a tela e responder as perguntas. Mesma logica de
    // "dado limpo pra analise" pedida pelo treinador exige que o numero registrado seja o mesmo que
    // o aluno de fato confirmou, nao um recalculo silencioso.
    try {
      return await this.prisma.weeklyCheckIn.create({
        data: {
          userId,
          planId: plan.id,
          weekStartDate: plan.startDate,
          asPrescribedSessions: dto.asPrescribedSessions,
          changedModalitySessions: dto.changedModalitySessions,
          differentSessions: dto.differentSessions,
          missedSessions: dto.missedSessions,
          elaborationSatisfaction: dto.elaborationSatisfaction,
          adherenceSatisfaction: dto.adherenceSatisfaction,
          nextWeekMotivation: dto.nextWeekMotivation,
        },
      });
    } catch (error) {
      // 31/08: cobre a corrida entre o findFirst acima e este create (duplo toque, dois
      // aparelhos) — a restricao @@unique([userId, planId]) no banco e' quem garante de verdade a
      // unicidade agora; aqui so' trata a violacao dela devolvendo a linha que ja existe, em vez
      // de estourar erro pro aluno por causa de algo que, do lado dele, e' idempotente.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existingAfterRace = await this.prisma.weeklyCheckIn.findFirst({ where: { userId, planId: plan.id } });
        if (existingAfterRace) return existingAfterRace;
      }
      throw error;
    }
  }

  // Usado por TrainingPlansService antes de permitir gerar a proxima semana — leitura pura, sem
  // efeito colateral, nunca cria nada sozinha.
  async hasCheckedInForCurrentPlan(userId: string): Promise<boolean> {
    const plan = await this.currentActivePlan(userId);
    if (!plan) return true; // sem plano ativo, o proprio fluxo de geracao ja bloqueia por outro motivo
    const existing = await this.prisma.weeklyCheckIn.findFirst({ where: { userId, planId: plan.id }, select: { id: true } });
    return Boolean(existing);
  }

  private currentActivePlan(userId: string) {
    return this.prisma.trainingPlan.findFirst({
      where: { userId, status: 'active' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, startDate: true },
    });
  }

  // Prefere os numeros que o StravaService.report() ja calcula (comparacao real prescrito x
  // executado, incluindo "modalidade diferente" via atividade do Strava) quando o aluno tem Strava
  // conectado — reaproveita a logica existente em vez de duplicar. Sem Strava, cai pra uma conta
  // mais simples (so' pelo registro manual: feito ou sem registro), sem inventar um numero de
  // "diferente" que nao temos como saber sem o Strava.
  private async computeSummary(userId: string, planId: string, options?: { skipCache?: boolean }): Promise<WeeklyCheckInSummary> {
    const report = await this.strava.report(userId, { skipCache: options?.skipCache }).catch(() => ({ summary: null }));
    if (report.summary) {
      return {
        asPrescribedSessions: report.summary.asPrescribedSessions,
        changedModalitySessions: report.summary.sameModalityChangedSessions,
        differentSessions: report.summary.differentSessions,
        missedSessions: report.summary.missedSessions,
      };
    }

    const sessions = await this.prisma.trainingSession.findMany({
      where: { planId },
      select: { scheduledDate: true, completion: { select: { status: true } } },
    });
    const today = todayInSaoPaulo();
    let asPrescribedSessions = 0;
    let missedSessions = 0;
    for (const session of sessions) {
      const isPastOrToday = startOfDay(session.scheduledDate).getTime() <= today.getTime();
      if (!isPastOrToday) continue;
      const done = session.completion?.status === 'done' || session.completion?.status === 'adjusted';
      if (done) asPrescribedSessions += 1;
      else missedSessions += 1;
    }
    return { asPrescribedSessions, changedModalitySessions: 0, differentSessions: 0, missedSessions };
  }
}
