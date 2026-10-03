import { BadGatewayException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PolarService } from './polar.service';
import { PolarActivityIngestionService } from './polar-activity-ingestion.service';

const ACCESSLINK_BASE = 'https://www.polaraccesslink.com';
const WEBHOOK_RETRY_DELAY_MS = 60_000;

// Webhook de notificacao Polar (03/10/2026). Contrato oficial usado: header
// `Polar-Webhook-Signature` = HMAC-SHA256 em hex do CORPO BRUTO, chave = signature_secret_key
// (devolvida uma vez na criacao do webhook). Evento de interesse: `event: "EXERCISE"` com `user_id`.
// Ping de criacao e eventos nao tratados sao aceitos (200) sem processamento.
@Injectable()
export class PolarWebhookService {
  private readonly logger = new Logger(PolarWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly polar: PolarService,
    private readonly ingestion: PolarActivityIngestionService,
  ) {}

  // Fail-closed: sem assinatura cadastrada, sem cabecalho, ou assinatura divergente -> 401.
  async verifySignature(rawBody: Buffer | undefined, signatureHeader: string | undefined): Promise<void> {
    if (!rawBody || !signatureHeader) throw new UnauthorizedException('Assinatura de webhook ausente.');
    const subscription = await this.prisma.polarWebhookSubscription.findFirst({ orderBy: { createdAt: 'desc' } });
    if (!subscription) throw new UnauthorizedException('Webhook Polar nao registrado.');
    const secret = this.polar.decryptSecret(subscription.signatureSecretEncrypted);
    const expected = Buffer.from(createHmac('sha256', secret).update(rawBody).digest('hex'));
    const received = Buffer.from(signatureHeader.trim().toLowerCase());
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      throw new UnauthorizedException('Assinatura de webhook invalida.');
    }
  }

  // Nunca chamado de dentro do request HTTP: o controller responde 200 e dispara isto em background.
  // Usa o mesmo sync() de sempre — webhook, polling e botao manual sao gatilhos do mesmo mecanismo.
  async handleEvent(body: { event?: unknown; user_id?: unknown } | null | undefined): Promise<void> {
    if (!body || body.event !== 'EXERCISE' || body.user_id == null) return;
    const connection = await this.prisma.polarConnection.findUnique({ where: { polarUserId: String(body.user_id) } });
    if (!connection) return;
    const result = await this.ingestion.sync(connection.userId);
    // Sync manual/polling em andamento devolve in_progress e o evento seria perdido ate o fallback.
    // Uma unica nova tentativa atrasada cobre a janela sem criar fila nem loop.
    if (result.status === 'in_progress') {
      setTimeout(() => {
        this.ingestion.sync(connection.userId).catch((error: unknown) =>
          this.logger.warn(`Retentativa de webhook Polar falhou: ${error instanceof Error ? error.message : String(error)}`));
      }, WEBHOOK_RETRY_DELAY_MS);
    }
  }

  // Registro na API oficial (POST /v3/webhooks). FRONTEIRA DE ATIVACAO: o token que deve autenticar
  // esta chamada (Bearer) e o tipo de credencial ainda nao foram confirmados no contrato — por isso
  // este metodo nao e' chamado em lugar nenhum. Quem chamar precisa fornecer o token.
  async register(url: string, accessToken: string): Promise<void> {
    let response: Response;
    try {
      response = await fetch(`${ACCESSLINK_BASE}/v3/webhooks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ url, events: ['EXERCISE'] }),
      });
    } catch {
      throw new BadGatewayException('Nao foi possivel contatar a Polar para registrar o webhook.');
    }
    if (!response.ok) throw new BadGatewayException(`A Polar recusou o registro do webhook (status ${response.status}).`);
    const body = (await response.json()) as { signature_secret_key?: unknown; id?: unknown };
    if (typeof body.signature_secret_key !== 'string' || !body.signature_secret_key) {
      throw new BadGatewayException('Resposta da Polar sem signature_secret_key.');
    }
    const polarWebhookId = typeof body.id === 'string' || typeof body.id === 'number' ? String(body.id) : null;
    await this.prisma.polarWebhookSubscription.create({
      data: {
        url,
        polarWebhookId,
        signatureSecretEncrypted: this.polar.encryptSecret(body.signature_secret_key),
      },
    });
    this.logger.log('Webhook Polar registrado.');
  }
}
