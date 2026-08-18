import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePainReportDto } from './dto/create-pain-report.dto';
import { StudentProfileService, ProfileEventCode } from '../training-plans/student-profile.service';

const SEVERE_WINDOW_DAYS = 14;
const REPORT_LOOKBACK_DAYS = 21;

export interface PainSafetyTier {
  tier: 'normal' | 'reduced' | 'remove_running';
  reason: string | null;
  lastReportAt: Date | null;
}

@Injectable()
export class PainReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly studentProfile: StudentProfileService,
  ) {}

  list(userId: string) {
    return this.prisma.painReport.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  }

  async previousRegions(userId: string) {
    const reports = await this.prisma.painReport.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { regions: true },
    });
    return [...new Set(reports.flatMap((report) => report.regions))];
  }

  async create(userId: string, dto: CreatePainReportDto) {
    const report = await this.prisma.painReport.create({
      data: {
        userId,
        regions: dto.regions,
        regionDetails: (dto.regionDetails ?? undefined) as Prisma.InputJsonValue,
        otherLocation: dto.otherLocation,
        intensity: dto.intensity,
        onsetPattern: dto.onsetPattern,
        persistencePattern: dto.persistencePattern,
        worseningTrend: dto.worseningTrend,
        dailyLifeImpact: dto.dailyLifeImpact,
        previousPainStatus: dto.previousPainStatus,
        resolvedRegions: dto.resolvedRegions ?? [],
        comment: dto.comment,
      },
    });

    const profileText = [
      `Relato de dor: regioes ${dto.regions.join(', ')}${dto.otherLocation ? ` (${dto.otherLocation})` : ''}, intensidade ${dto.intensity}/10.`,
      dto.onsetPattern ? `Inicio: ${dto.onsetPattern}.` : '',
      dto.persistencePattern ? `Padrao: ${dto.persistencePattern}.` : '',
      dto.worseningTrend ? `Tendencia: ${dto.worseningTrend}.` : '',
      dto.dailyLifeImpact ? `Atrapalha o dia a dia: ${dto.dailyLifeImpact}.` : '',
      dto.comment?.trim() ? `Comentario do aluno: ${dto.comment.trim()}` : '',
    ].filter(Boolean).join(' ');
    void this.studentProfile.recordEvent(userId, ProfileEventCode.PAIN_REPORT, profileText).catch(() => undefined);

    return report;
  }

  // Calcula o "tier" de seguranca com base em relatos RECENTES, nao na entrevista de
  // onboarding (que e uma resposta unica e nunca expira sozinha). Um relato isolado leve
  // nao restringe nada; um relato grave restringe por um periodo limitado, e se o aluno nao
  // relatar de novo apos esse periodo a restricao mais forte cai sozinha para o nivel
  // reduzido (nunca fica "eterna" so por falta de retorno do aluno).
  async computeSafetyTier(userId: string): Promise<PainSafetyTier> {
    const since = new Date(Date.now() - REPORT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const recentReports = await this.prisma.painReport.findMany({
      where: { userId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
    });

    let tier: PainSafetyTier['tier'] = 'normal';
    let reason: string | null = null;
    let lastReportAt: Date | null = null;

    if (recentReports.length) {
      const latest = recentReports[0];
      lastReportAt = latest.createdAt;
      const ageDays = (Date.now() - latest.createdAt.getTime()) / (24 * 60 * 60 * 1000);

      if (latest.intensity >= 8) {
        if (ageDays <= SEVERE_WINDOW_DAYS) {
          tier = 'remove_running';
          reason = `Relato de dor intensa (${latest.intensity}/10) nos ultimos ${SEVERE_WINDOW_DAYS} dias.`;
        } else {
          tier = 'reduced';
          reason = `Relato de dor intensa ha ${Math.round(ageDays)} dias, sem atualizacao recente — reduzindo cautela gradualmente.`;
        }
      } else if (latest.intensity >= 5) {
        tier = 'reduced';
        reason = `Relato de dor moderada (${latest.intensity}/10).`;
      }

      // "Tendencia" e "atrapalha o dia a dia" nao mudam o tier por regra fixa (nenhum numero
      // nem calculo aqui) — sao so mais duas frases de contexto real anexadas ao motivo, pro
      // agente de IA pesar isso do jeito que um treinador real pesaria (ver panzeri_methodology
      // na memoria do projeto: dor que atrapalha o dia a dia ou que vem piorando pesa mais do
      // que uma dor estavel/isolada, mesmo com intensidade parecida).
      if (reason && (latest.worseningTrend || latest.dailyLifeImpact)) {
        const extra: string[] = [];
        if (latest.worseningTrend === 'worsening') extra.push('o aluno relata que esta piorando ao longo dos treinos');
        else if (latest.worseningTrend === 'improving') extra.push('o aluno relata que esta melhorando');
        if (latest.dailyLifeImpact === 'yes') extra.push('atrapalha o dia a dia fora do treino');
        else if (latest.dailyLifeImpact === 'a_little') extra.push('atrapalha um pouco o dia a dia fora do treino');
        if (extra.length) reason = `${reason} ${extra.join('; ')}.`;
      }
    }

    if (tier === 'normal') {
      const recentCompletions = await this.prisma.workoutCompletion.findMany({
        where: { userId, painFlag: { not: null } },
        orderBy: { completedAt: 'desc' },
        take: 3,
        select: { painFlag: true },
      });
      const painfulCount = recentCompletions.filter((completion) => completion.painFlag && completion.painFlag !== 'none').length;
      if (painfulCount >= 2) {
        tier = 'reduced';
        reason = 'Dor leve recorrente nos ultimos treinos concluidos.';
      }
    }

    return { tier, reason, lastReportAt };
  }
}
