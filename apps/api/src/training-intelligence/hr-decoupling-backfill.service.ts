import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { HR_DECOUPLING_ALGORITHM_VERSION } from './hr-decoupling';
import { ensureHrDecouplings } from './hr-decoupling-store';

// Preenchimento em segundo plano do desacoplamento da FC (03/11/2026): calcula as corridas que ainda nao tem resultado para a primeira leitura (Evolucao da aluna, painel, IA) nao pagar
// o calculo de todo o historico de uma vez. A cada 10 minutos, um lote pequeno (mais recentes primeiro); corrida nova entra sozinha no proximo ciclo. Idempotente: roda por cima do mesmo
// armazenamento da leitura (ensureHrDecouplings), entao leitura e preenchimento simultaneos so' repetem trabalho, nunca divergem. Falha de um lote nao derruba o servidor.
export const HR_DECOUPLING_BACKFILL_BATCH = 25;
const RUNNING_SPORTS = ['corrida', 'running', 'run'];

@Injectable()
export class HrDecouplingBackfillService {
  private readonly logger = new Logger(HrDecouplingBackfillService.name);
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async fillPending(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      // So' atividades com serie segundo a segundo e ainda sem resultado desta versao do algoritmo; a leitura trata as que mudaram de serie depois.
      // ai-scope: nao-ia (so' enfileira ids para calcular o resultado derivado; nada vai a IA daqui — a IA le o resultado pelo leitor de observacoes, que aplica o escopo por fonte)
      const pending = await this.prisma.activityLog.findMany({
        where: {
          timeSeriesPoints: { some: {} },
          hrDecouplings: { none: { algorithmVersion: HR_DECOUPLING_ALGORITHM_VERSION } },
          OR: RUNNING_SPORTS.map((sport) => ({ sport: { equals: sport, mode: 'insensitive' as const } })),
        },
        orderBy: { startedAt: 'desc' },
        take: HR_DECOUPLING_BACKFILL_BATCH,
        select: { id: true },
      });
      if (pending.length === 0) return 0;
      await ensureHrDecouplings(this.prisma, pending.map((log) => log.id));
      this.logger.log(`Desacoplamento da FC: ${pending.length} corrida(s) calculada(s) em segundo plano.`);
      return pending.length;
    } catch (error) {
      this.logger.warn(`Falha no preenchimento do desacoplamento da FC: ${error instanceof Error ? error.message : String(error)}`);
      return 0;
    } finally {
      this.running = false;
    }
  }
}
