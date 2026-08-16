import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService, formatStudentCode } from '../billing/telegram.service';
import { PainReportsService } from '../pain-reports/pain-reports.service';
import { CreateTargetRaceDto } from './dto/create-target-race.dto';
import { UpdateTargetRaceDto } from './dto/update-target-race.dto';

const dayNames = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];

@Injectable()
export class TargetRacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
    private readonly painReports: PainReportsService,
  ) {}

  async list(userId: string) {
    const races = await this.prisma.targetRace.findMany({
      where: { userId },
      orderBy: [{ status: 'asc' }, { raceDate: 'asc' }],
    });
    return races.map(withComputedPace);
  }

  async create(userId: string, dto: CreateTargetRaceDto) {
    const race = await this.prisma.targetRace.create({
      data: {
        userId,
        name: dto.name.trim(),
        raceDate: new Date(dto.raceDate),
        distanceKm: dto.distanceKm,
        targetSeconds: dto.targetSeconds,
        priority: dto.priority ?? 'principal',
        notes: dto.notes,
        performanceIntent: dto.performanceIntent,
        socialIntent: dto.socialIntent,
        personalImportance: dto.personalImportance,
        perceivedDifficulty: dto.perceivedDifficulty,
        dedicationWillingness: dto.dedicationWillingness,
        achievementSatisfaction: dto.achievementSatisfaction,
        confidenceLevel: dto.confidenceLevel,
        injuryConcern: dto.injuryConcern,
        adjustmentOpenness: dto.adjustmentOpenness,
        anxietyLevel: dto.anxietyLevel,
        isFirstTimeAtDistance: dto.isFirstTimeAtDistance,
      },
    });
    await this.alertIfRisky(userId, race).catch(() => undefined);
    return withComputedPace(race);
  }

  async update(userId: string, raceId: string, dto: UpdateTargetRaceDto) {
    const existing = await this.prisma.targetRace.findUnique({ where: { id: raceId } });
    if (!existing || existing.userId !== userId) throw new NotFoundException('Meta nao encontrada.');

    const race = await this.prisma.targetRace.update({
      where: { id: raceId },
      data: {
        name: dto.name?.trim(),
        raceDate: dto.raceDate ? new Date(dto.raceDate) : undefined,
        distanceKm: dto.distanceKm,
        targetSeconds: dto.targetSeconds,
        priority: dto.priority,
        status: dto.status,
        notes: dto.notes,
        performanceIntent: dto.performanceIntent,
        socialIntent: dto.socialIntent,
        personalImportance: dto.personalImportance,
        perceivedDifficulty: dto.perceivedDifficulty,
        dedicationWillingness: dto.dedicationWillingness,
        achievementSatisfaction: dto.achievementSatisfaction,
        confidenceLevel: dto.confidenceLevel,
        injuryConcern: dto.injuryConcern,
        adjustmentOpenness: dto.adjustmentOpenness,
        anxietyLevel: dto.anxietyLevel,
        isFirstTimeAtDistance: dto.isFirstTimeAtDistance,
      },
    });
    // So reavalia o alerta quando algo que pode mudar o risco de fato mudou (data ou distancia) —
    // editar so as notas ou o questionario de contexto nao deveria gerar um novo aviso repetido.
    if (dto.raceDate !== undefined || dto.distanceKm !== undefined) {
      await this.alertIfRisky(userId, race).catch(() => undefined);
    }
    return withComputedPace(race);
  }

  async remove(userId: string, raceId: string) {
    const existing = await this.prisma.targetRace.findUnique({ where: { id: raceId } });
    if (!existing || existing.userId !== userId) throw new NotFoundException('Meta nao encontrada.');
    await this.prisma.targetRace.delete({ where: { id: raceId } });
    return { removed: true };
  }

  // Usado pelo agente de prescricao. Duas correcoes reais feitas em 16/08 (auditoria do fluxo de
  // prova alvo, achados no mesmo dia do questionario de contexto):
  // 1. Antes so retornava a prova "em_andamento" mais proxima — uma aluna com duas provas
  //    marcadas (ex: 10km em 3 semanas e uma meia em 3 meses) so tinha a mais proxima visivel
  //    pra IA, a segunda ficava invisivel ate a primeira mudar de status. Agora retorna TODAS as
  //    provas em andamento, a IA decide como equilibrar multiplas metas simultaneas.
  // 2. Antes uma prova cuja data ja passou, mas o aluno nunca voltou no app pra marcar
  //    "concluida", ficava "em_andamento" pra sempre — a IA continuava recebendo uma prova ja
  //    vencida como meta ativa indefinidamente. Agora, antes de buscar, arquiva automaticamente
  //    (status -> 'arquivada') qualquer prova em_andamento com raceDate mais de 2 dias no
  //    passado (folga de 2 dias pra dar tempo do aluno marcar como concluida manualmente antes
  //    do arquivamento automatico "roubar" essa marcacao).
  async activeGoals(userId: string) {
    const staleThreshold = addDays(new Date(), -2);
    await this.prisma.targetRace.updateMany({
      where: { userId, status: 'em_andamento', raceDate: { lt: staleThreshold } },
      data: { status: 'arquivada' },
    });
    const races = await this.prisma.targetRace.findMany({
      where: { userId, status: 'em_andamento' },
      orderBy: { raceDate: 'asc' },
    });
    return races.map(withComputedPace);
  }

  // Gatilho de alerta pro treinador (pedido 16/08, "pode fazer o gatilho para o Telegram" —
  // discutido em detalhe antes, sem trigger definido; esta e a primeira versao concreta).
  // Puramente INFORMATIVO — nunca bloqueia o cadastro da prova nem muda nada na prescricao, so
  // avisa o treinador que essa prova especifica merece um olhar. Reusa dados/calculos que ja
  // existem no sistema (nada de formula nova validando treino, so comparacao de fatos objetivos
  // pra decidir SE avisa, igual o padrao ja usado pelo alerta de dor/diretriz vencida).
  private async alertIfRisky(userId: string, race: { id: string; name: string; raceDate: Date; distanceKm: number }) {
    const reasons: string[] = [];

    const [user, availability, painSafety, longestRun] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, studentCode: true } }),
      this.prisma.weeklyAvailability.findMany({ where: { userId } }),
      this.painReports.computeSafetyTier(userId),
      this.prisma.trainingSession.findFirst({
        where: {
          userId,
          modality: { in: ['corrida', 'esteira'] },
          completion: { status: { in: ['done', 'adjusted'] }, distanceKm: { not: null } },
        },
        orderBy: { completion: { distanceKm: 'desc' } },
        select: { completion: { select: { distanceKm: true } } },
      }),
    ]);

    // 1) Dia da prova nao esta na rotina cadastrada do aluno — a aluna pode nao ter percebido que
    // vai precisar treinar/estar disponivel num dia que normalmente nao e dela.
    const raceWeekday = race.raceDate.getUTCDay();
    const routineDay = availability.find((day) => day.weekday === raceWeekday && !day.noTraining);
    if (!routineDay) {
      reasons.push(`A prova cai numa ${dayNames[raceWeekday]}, dia que nao esta na rotina de treino cadastrada dela.`);
    }

    // 2) Gap de distancia grande demais em relacao ao que ja foi demonstrado de verdade — mesma
    // logica de "recorde quente/frio" usada na prescricao, aqui so pra decidir SE avisa, nao pra
    // decidir treino nenhum.
    const recordKm = longestRun?.completion?.distanceKm ?? null;
    if (recordKm == null && race.distanceKm >= 10) {
      reasons.push(`Prova de ${race.distanceKm}km cadastrada sem nenhum treino concluido registrado no historico dela ate agora.`);
    } else if (recordKm != null && race.distanceKm > recordKm * 2) {
      reasons.push(`Prova de ${race.distanceKm}km e mais que o dobro do maior treino concluido dela (${recordKm}km).`);
    }

    // 3) Tier de seguranca elevado no momento do cadastro (dor recente moderada/grave).
    if (painSafety.tier !== 'normal') {
      reasons.push(`Ela esta com sinal de cautela ativo por dor recente (${painSafety.reason ?? 'sem detalhe'}) no momento em que cadastrou essa prova.`);
    }

    if (!reasons.length) return;

    await this.telegram.notifyCoach(
      `🏁 Prova alvo cadastrada merece um olhar.\nAluno: ${user.name} (Cod. ${formatStudentCode(user.studentCode)})\nProva: ${race.name} — ${race.distanceKm}km em ${race.raceDate.toISOString().slice(0, 10)}\n\n${reasons.map((reason) => `• ${reason}`).join('\n')}\n\nSo um aviso — nao bloqueia nada, a prescricao segue normal.`,
    );
  }
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function withComputedPace<T extends { distanceKm: number; targetSeconds: number | null }>(race: T) {
  if (!race.targetSeconds || !race.distanceKm) {
    return { ...race, paceSecondsPerKm: null, speedKmh: null };
  }
  const paceSecondsPerKm = Math.round(race.targetSeconds / race.distanceKm);
  const speedKmh = Number(((race.distanceKm / race.targetSeconds) * 3600).toFixed(2));
  return { ...race, paceSecondsPerKm, speedKmh };
}
