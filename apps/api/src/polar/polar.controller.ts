import { Controller, Get, Headers, HttpCode, HttpException, Logger, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { PolarService } from './polar.service';
import { PolarActivityIngestionService } from './polar-activity-ingestion.service';
import { PolarWebhookService } from './polar-webhook.service';

type RawBodyReq = { rawBody?: Buffer; body: unknown };

interface HtmlResponse {
  status: (code: number) => HtmlResponse;
  type: (contentType: string) => HtmlResponse;
  setHeader: (name: string, value: string) => void;
  send: (html: string) => void;
}

@Controller('polar')
export class PolarController {
  private readonly logger = new Logger(PolarController.name);

  constructor(
    private readonly polarService: PolarService,
    private readonly ingestionService: PolarActivityIngestionService,
    private readonly webhookService: PolarWebhookService,
  ) {}

  // Webhook oficial da Polar (03/10/2026). Sem JWT: autenticacao e' a assinatura HMAC do corpo bruto.
  // Responde 200 logo apos validar — o processamento (sync) roda em background, nunca no request.
  @Post('webhook')
  @HttpCode(200)
  async webhook(@Req() req: RawBodyReq, @Headers('polar-webhook-signature') signature?: string) {
    await this.webhookService.verifySignature(req.rawBody, signature);
    this.webhookService.handleEvent(req.body as { event?: unknown; user_id?: unknown })
      .catch((error: unknown) => this.logger.warn(`Falha ao processar evento de webhook Polar: ${error instanceof Error ? error.message : String(error)}`));
    return { ok: true };
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('connect-url')
  connectUrl(@CurrentUser() user: CurrentUserPayload) {
    return this.polarService.connectUrl(user.sub);
  }

  // So leitura — usado pela tela de Perfil pra exibir "Polar conectado" apos o retorno do
  // /polar/callback (que e uma pagina publica fora do app, sem como avisar o app diretamente).
  @UseGuards(AuthGuard('jwt'))
  @Get('status')
  status(@CurrentUser() user: CurrentUserPayload) {
    return this.polarService.status(user.sub);
  }

  // Sincronizacao controlada, disparada manualmente pelo proprio usuario autenticado. Sem cron
  // nem webhook nesta etapa (ver limitacoes reportadas) — so prova que uma atividade chega
  // integra e sem duplicar quando chamado mais de uma vez.
  @UseGuards(AuthGuard('jwt'))
  @Post('sync')
  sync(@CurrentUser() user: CurrentUserPayload) {
    return this.ingestionService.sync(user.sub);
  }

  // A Polar redireciona o navegador diretamente para esta rota HTTPS publica.
  @Get('callback')
  async callback(@Query() query: { state?: unknown; code?: unknown; error?: unknown }, @Res() response: HtmlResponse) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    let status = 200;
    let title = 'Polar conectada';
    let message = 'A conta Polar foi vinculada. Pode voltar ao Panzeri Run.';
    try {
      const result = await this.polarService.callback(query);
      if (result === 'cancelled') {
        title = 'Conexao cancelada';
        message = 'Nenhuma conta Polar foi vinculada. Pode voltar ao aplicativo.';
      }
    } catch (error) {
      status = error instanceof HttpException ? error.getStatus() : 502;
      title = 'Nao foi possivel conectar';
      message = status === 400
        ? 'A autorizacao e invalida, expirou ou ja foi utilizada. Inicie outra conexao no aplicativo.'
        : 'A conexao nao foi concluida. Inicie outra tentativa no aplicativo.';
    }
    // Nenhum state, code, token ou detalhe da resposta Polar aparece no HTML.
    response.status(status).type('html').send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font:16px system-ui,sans-serif;margin:12vh auto;max-width:34rem;padding:1.5rem;color:#102341}h1{font-size:1.6rem}p{line-height:1.5}</style></head><body><h1>${title}</h1><p>${message}</p></body></html>`);
  }
}