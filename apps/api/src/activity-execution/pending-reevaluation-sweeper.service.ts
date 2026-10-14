import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { processDueReevaluations } from './pending-reevaluation';

// Varredor das reavaliacoes pendentes (15/10/2026): garante que uma correcao NUNCA fique permanentemente sem atualizacao, mesmo se o servidor reiniciar no meio
// do processamento (a pendencia e' uma linha no banco, nao uma fila em memoria). Retoma linhas sem lease ativo, com espera crescente apos falhas. Nao gera
// treino nem aciona agentes de prescricao: so' recalculo deterministico e reavaliacao de medalhas.
const SWEEP_INTERVAL_MS = 2 * 60_000;

@Injectable()
export class PendingReevaluationSweeperService {
  private readonly logger = new Logger(PendingReevaluationSweeperService.name);
  // Mesma trava do BillingSyncSchedulerService: uma varredura lenta nao sobrepoe a seguinte.
  private isRunning = false;

  constructor(private readonly prisma: PrismaService) {}

  @Interval(SWEEP_INTERVAL_MS)
  async sweep(now: Date = new Date()): Promise<{ examined: number; processed: number } | null> {
    if (this.isRunning) return null;
    this.isRunning = true;
    try {
      const result = await processDueReevaluations(this.prisma, { now });
      if (result.processed > 0) this.logger.log(`Varredura de reavaliacoes pendentes: ${result.processed} aluno(s) processado(s) de ${result.examined} examinado(s).`);
      return result;
    } finally {
      this.isRunning = false;
    }
  }
}
