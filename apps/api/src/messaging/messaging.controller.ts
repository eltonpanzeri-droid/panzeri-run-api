import { BadRequestException, Controller, Headers, Post, Req, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { createHmac, timingSafeEqual } from 'crypto';
import { MessagingService } from './messaging.service';

// Evita depender do pacote 'express' so' pra esse tipo (nao esta nas dependencias diretas do
// projeto) — so' precisamos do rawBody (habilitado globalmente em main.ts) e do body ja parseado.
type RawBodyReq = { rawBody?: Buffer; body: unknown };

// 27/08: webhook de entrega de e-mail da Resend — pedido do treinador apos descobrir que
// "e-mail enviado com sucesso" no nosso lado so' significa que a Resend ACEITOU processar,
// nao que chegou de verdade na caixa de entrada (achado real: um endereco com erro de
// digitacao — gmail.CON — "enviou" sem erro nenhum e nunca ia chegar em lugar nenhum).
// Formato do payload e assinatura documentados em resend.com/docs/webhooks — usa Svix por
// baixo (mesmo mecanismo do Clerk/outras plataformas): HMAC-SHA256 sobre
// "<svix-id>.<svix-timestamp>.<corpo bruto>", segredo "whsec_..." vem em base64 depois do
// prefixo, e o header svix-signature pode trazer varias assinaturas "v1,<base64>" separadas
// por espaco (qualquer uma batendo e' valida).
function verifySvixSignature(secret: string, svixId: string, svixTimestamp: string, rawBody: Buffer, svixSignature: string): boolean {
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody.toString('utf8')}`;
  const expected = createHmac('sha256', secretBytes).update(signedContent).digest('base64');
  const expectedBuffer = Buffer.from(expected, 'base64');

  return svixSignature.split(' ').some((entry) => {
    const [, signature] = entry.split(',');
    if (!signature) return false;
    const provided = Buffer.from(signature, 'base64');
    return provided.length === expectedBuffer.length && timingSafeEqual(provided, expectedBuffer);
  });
}

type ResendWebhookPayload = {
  type?: string;
  data?: { email_id?: string };
};

@Controller('messaging')
export class MessagingController {
  constructor(
    private readonly messaging: MessagingService,
    private readonly config: ConfigService,
  ) {}

  @SkipThrottle()
  @Post('resend/webhook')
  async resendWebhook(
    @Req() req: RawBodyReq,
    @Headers('svix-id') svixId: string | undefined,
    @Headers('svix-timestamp') svixTimestamp: string | undefined,
    @Headers('svix-signature') svixSignature: string | undefined,
  ) {
    const secret = this.config.get<string>('RESEND_WEBHOOK_SECRET');
    if (!secret) throw new UnauthorizedException('Webhook nao configurado.');
    if (!svixId || !svixTimestamp || !svixSignature || !req.rawBody) {
      throw new BadRequestException('Headers de assinatura ausentes.');
    }
    // Rejeita entregas com mais de 5 minutos (recomendacao oficial da Resend/Svix) — protege
    // contra reenvio de uma requisicao capturada/repetida bem depois do evento real.
    const timestampAgeSeconds = Math.abs(Date.now() / 1000 - Number(svixTimestamp));
    if (!Number.isFinite(timestampAgeSeconds) || timestampAgeSeconds > 300) {
      throw new UnauthorizedException('Timestamp do webhook expirado.');
    }
    if (!verifySvixSignature(secret, svixId, svixTimestamp, req.rawBody, svixSignature)) {
      throw new UnauthorizedException('Assinatura do webhook invalida.');
    }

    const payload = req.body as ResendWebhookPayload;
    const emailId = payload.data?.email_id;
    // type vem como "email.delivered", "email.bounced", etc. — guarda so' a parte depois do
    // ponto ("delivered", "bounced") pra ficar consistente com o resto do sistema.
    const deliveryStatus = payload.type?.split('.')[1];
    if (emailId && deliveryStatus) {
      await this.messaging.recordDeliveryEvent(emailId, deliveryStatus);
    }

    return { received: true };
  }
}
