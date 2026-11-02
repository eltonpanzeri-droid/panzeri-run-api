import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../billing/telegram.service';
import { AI_CACHE_POLICY } from '../common/ai-models.config';
import { CONFIRMED_STATUSES, STUDENT_METRICS_POPULATION } from '../coach/subscription-groups.util';

// Aviso unico pedido por Elton (02/11/2026): quando o numero de alunas com pagamento confirmado chegar a 50, lembra de avaliar o cache do prompt do Treinador da semana.
// So' AVISA: nao liga, nao desliga e nao muda nenhuma politica de cache. "Pagante" = mesma conta do Financeiro (grupo confirmado, sem arquivadas, cortesia fora).
export const CACHE_REVIEW_MILESTONE_KEY = 'cache_review_50_paying_students';
export const CACHE_REVIEW_PAYING_THRESHOLD = 50;

export function buildCacheReviewMessage(payingCount: number, currentPolicy: string): string {
  const policyLabel = currentPolicy === 'off' ? 'desligado' : `ligado (cache de ${currentPolicy === '1h' ? '1 hora' : '5 minutos'})`;
  return [
    `💡 Lembrete que você pediu: o Panzeri Run chegou a ${payingCount} alunas com pagamento confirmado.`,
    '',
    'O que isso significa:',
    'A cada programa de treino semanal, a IA relê um texto fixo enorme (a metodologia e as regras, uns 48 mil tokens). O "cache" guarda esse texto por poucos minutos e faz a releitura custar 10 vezes menos, mas só ajuda quando várias gerações acontecem com poucos minutos de diferença. Com poucas alunas, quase nenhuma geração aproveitava (a leitura de cache ficava zerada). Com muitas alunas gerando no domingo, a tendência é aproveitar bastante.',
    '',
    `Situação hoje: o cache do Treinador da semana está ${policyLabel}. Nada foi alterado automaticamente.`,
    '',
    'O que fazer agora:',
    '1) Abra o painel em Financeiro > Custo por prescrição e olhe o gráfico "De onde vem o custo" e a legenda "Leitura de cache".',
    '2) Se a leitura de cache estiver acima de zero em dia de pico, ele está funcionando. Se continuar zerada mesmo com muitas gerações seguidas, vale reavaliar (por exemplo o cache de 1 hora).',
    '3) Para mudar, peça ao Claude para ajustar a política de cache do Treinador da semana (arquivo ai-models.config.ts).',
    '',
    'Este aviso não se repete.',
  ].join('\n');
}

@Injectable()
export class CacheMilestoneNotifierService {
  private readonly logger = new Logger(CacheMilestoneNotifierService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
  ) {}

  @Cron('0 10 * * *', { timeZone: 'America/Sao_Paulo' })
  async checkCacheReviewMilestone() {
    try {
      await this.run();
    } catch (error) {
      this.logger.warn(`Falha ao verificar o marco de pagantes para o cache de prompt: ${(error as Error).message}`);
    }
  }

  async run(): Promise<{ payingCount: number; notified: boolean }> {
    const alreadyNotified = await this.prisma.coachMilestone.findUnique({ where: { key: CACHE_REVIEW_MILESTONE_KEY } });
    if (alreadyNotified) return { payingCount: 0, notified: false };
    const payingCount = await this.prisma.user.count({
      where: { ...STUDENT_METRICS_POPULATION, subscriptionStatus: { in: [...CONFIRMED_STATUSES] } },
    });
    if (payingCount < CACHE_REVIEW_PAYING_THRESHOLD) return { payingCount, notified: false };
    // Grava o marco ANTES de avisar: a chave unica garante no maximo um aviso, mesmo com dois servidores rodando o mesmo horario.
    try {
      await this.prisma.coachMilestone.create({ data: { key: CACHE_REVIEW_MILESTONE_KEY, detail: { payingCount, threshold: CACHE_REVIEW_PAYING_THRESHOLD } } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return { payingCount, notified: false };
      throw error;
    }
    await this.telegram.notifyCoach(buildCacheReviewMessage(payingCount, AI_CACHE_POLICY.treinador_semana));
    this.logger.log(`Marco de ${CACHE_REVIEW_PAYING_THRESHOLD} pagantes atingido (${payingCount}): aviso sobre o cache de prompt enviado.`);
    return { payingCount, notified: true };
  }
}
