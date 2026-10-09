import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { WahooActivityIngestionService } from './wahoo-activity-ingestion.service';
import { asId } from './wahoo-activity-normalizer';

const WEBHOOK_RETRY_DELAY_MS = 60_000;

// Webhook da Wahoo (Etapa 5). Contrato oficial: POST JSON com "event_type" = "workout_summary", "user": { "id" } e
// "webhook_token" NO CORPO (a Wahoo nao assina o corpo). Como o corpo nao e' assinado, o token e' a unica autenticacao
// e o conteudo do evento NUNCA vira dado: ele so' dispara o sync normal, que busca tudo na API autenticada do aluno.
// DESLIGADO POR PADRAO (09/10/2026): so' funciona com WAHOO_WEBHOOK_ENABLED=true. Fail-closed: desligado, sem
// WAHOO_WEBHOOK_TOKEN configurado, ou token ausente/divergente, o evento e' recusado (401) e nada e' processado.
@Injectable()
export class WahooWebhookService {
  private readonly logger = new Logger(WahooWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly ingestion: WahooActivityIngestionService,
  ) {}

  verifyToken(body: unknown): void {
    if (this.config.get<string>('WAHOO_WEBHOOK_ENABLED')?.trim().toLowerCase() !== 'true') throw new UnauthorizedException('Webhook Wahoo nao autorizado.');
    const expected = this.config.get<string>('WAHOO_WEBHOOK_TOKEN')?.trim();
    const received = (body as { webhook_token?: unknown } | null | undefined)?.webhook_token;
    if (!expected || expected.length < 16 || typeof received !== 'string' || !received) throw new UnauthorizedException('Webhook Wahoo nao autorizado.');
    // Compara digests de tamanho fixo: sem vazar o tamanho nem o conteudo por tempo de resposta.
    const a = createHash('sha256').update(expected).digest();
    const b = createHash('sha256').update(received).digest();
    if (!timingSafeEqual(a, b)) throw new UnauthorizedException('Webhook Wahoo nao autorizado.');
  }

  // Nunca chamado dentro do request HTTP: o controller responde 200 e dispara isto em segundo plano.
  async handleEvent(body: unknown): Promise<void> {
    const event = body as { event_type?: unknown; user?: { id?: unknown } } | null | undefined;
    if (!event || event.event_type !== 'workout_summary') return;
    const wahooUserId = asId(event.user?.id);
    if (!wahooUserId) return;
    const connection = await this.prisma.wahooConnection.findUnique({ where: { wahooUserId }, select: { userId: true, disconnectedAt: true } });
    // Evento atrasado de conexao revogada: respondido 200, mas NADA e' coletado (consentimento revogado).
    if (!connection || connection.disconnectedAt) return;
    const result = await this.ingestion.sync(connection.userId);
    // Sync manual/rotina em andamento devolve in_progress e o evento se perderia; uma unica nova tentativa cobre a janela.
    if (result.status === 'in_progress') {
      setTimeout(() => {
        this.ingestion.sync(connection.userId).catch((error: unknown) =>
          this.logger.warn(`Retentativa de webhook Wahoo falhou: ${error instanceof Error ? error.message : String(error)}`));
      }, WEBHOOK_RETRY_DELAY_MS);
    }
  }
}
