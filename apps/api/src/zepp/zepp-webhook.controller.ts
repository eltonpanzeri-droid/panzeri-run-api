import { BadRequestException, Controller, HttpCode, NotFoundException, Param, Post, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { createHash, timingSafeEqual } from 'node:crypto';
import { ProviderInboundEventService } from '../provider-hub/provider-inbound-event.service';
import { ProviderConsentService } from '../provider-hub/provider-consent.service';
import { ZEPP_PROVIDER_ID } from './zepp.connector';
import { parseZeppWebhook, toInboundDrafts, ZEPP_WEBHOOK_MAX_BYTES, ZeppWebhookParseError } from './zepp-webhook';

// Receptor do webhook da Zepp (Lote 3): publico por necessidade (a Zepp nao assina nem usa JWT). Autenticacao = SEGREDO LONGO no caminho da URL
// (`/integrations/zepp/webhook/<segredo>`, cadastrado no console da Zepp), comparado em tempo constante; segredo ausente/curto/errado => 404 (nao revela que a rota
// existe). Aceita dois segredos separados por virgula (rotacao sem janela de perda). Responde 204 logo apos validar e gravar na fila (a Zepp exige 2xx em 30 s e
// pede que o download NAO seja feito aqui); o processamento e' assincrono (fila + rotina). Eventos de conta desconhecida/desconectada sao ignorados em silencio.
const MIN_SECRET_LENGTH = 32;

export function readBodyText(request: { body?: unknown } & AsyncIterable<Buffer | string>, maxBytes: number): Promise<string> {
  const body = request.body;
  if (typeof body === 'string') return Promise.resolve(body);
  return (async () => {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of request) {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
      total += buffer.length;
      if (total > maxBytes) throw new BadRequestException('Corpo grande demais.');
      chunks.push(buffer);
    }
    return Buffer.concat(chunks).toString('utf8');
  })();
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

@Controller('integrations/zepp')
export class ZeppWebhookController {
  constructor(
    private readonly config: ConfigService,
    private readonly events: ProviderInboundEventService,
    private readonly consent: ProviderConsentService,
  ) {}

  private secretMatches(candidate: string): boolean {
    const configured = (this.config.get<string>('ZEPP_WEBHOOK_SECRET') ?? '').split(',').map((item) => item.trim()).filter((item) => item.length >= MIN_SECRET_LENGTH);
    if (configured.length === 0 || !candidate) return false;
    const given = digest(candidate);
    let ok = false;
    for (const secret of configured) if (timingSafeEqual(given, digest(secret))) ok = true; // percorre todos: tempo nao depende de qual bateu
    return ok;
  }

  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Post('webhook/:secret')
  @HttpCode(204)
  async receive(@Param('secret') secret: string, @Req() request: { body?: unknown } & AsyncIterable<Buffer | string>): Promise<void> {
    if (!this.secretMatches(secret)) throw new NotFoundException();
    const raw = await readBodyText(request, ZEPP_WEBHOOK_MAX_BYTES);
    // Teste de cadastro do portal da Zepp (pode chamar a URL sem corpo): com o segredo certo, corpo vazio e' apenas confirmado (2xx), sem nenhum trabalho e sem gravar nada.
    if (raw.trim() === '') return;
    let content;
    try { content = parseZeppWebhook(raw); }
    catch (error) {
      if (error instanceof ZeppWebhookParseError) throw new BadRequestException('Corpo invalido.');
      throw error;
    }
    for (const draft of toInboundDrafts(content)) {
      // So' contas com conexao ativa viram trabalho (nao deixa um segredo vazado encher a fila). Idempotente por chave.
      const userId = draft.externalAccountId ? await this.consent.resolveActiveUserId(ZEPP_PROVIDER_ID, draft.externalAccountId) : null;
      if (!userId) continue;
      await this.events.record(ZEPP_PROVIDER_ID, draft, userId);
    }
  }
}
