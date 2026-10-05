import { Body, Controller, Get, HttpCode, Post, Query, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { StravaService } from './strava.service';

@Controller('strava')
export class StravaController {
  constructor(private readonly stravaService: StravaService) {}

  @UseGuards(AuthGuard('jwt'))
  @Get('connect-url')
  connectUrl(@CurrentUser() user: CurrentUserPayload) {
    return this.stravaService.connectUrl(user.sub);
  }

  @Get('callback')
  async callback(@Query() query: { code?: string; state?: string; error?: string; scope?: string }, @Res() response: { type: (value: string) => { send: (value: string) => void } }) {
    let message: string;
    let isError = false;
    try {
      message = await this.stravaService.callback(query);
    } catch (error) {
      isError = true;
      message = error instanceof Error ? error.message : 'Nao consegui concluir a conexao com o Strava.';
    }
    const appUrl = this.stravaService.studentAppUrl();
    const delayMs = isError ? 3500 : 1200;
    response.type('html').send(`
      <html>
        <head>
          <title>${isError ? 'Nao foi possivel conectar' : 'Strava conectado'}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 32px; color: #0f172a; }
            main { max-width: 520px; margin: 64px auto; line-height: 1.5; }
            h2 { margin-bottom: 8px; }
            p { color: #475569; }
            a { color: #0f766e; font-weight: 700; }
          </style>
        </head>
        <body>
          <main>
            <h2>${message}</h2>
            <p>${isError ? 'Volte ao aplicativo e tente conectar novamente.' : 'A sincronizacao agora e automatica.'}</p>
            ${appUrl ? `<p><a href="${appUrl}">Voltar ao aplicativo</a></p>` : ''}
          </main>
          <script>
            // Se essa pagina foi aberta como popup (window.opener existe), so fecha e volta pra
            // aba original do app sozinha. Se foi aberta na mesma aba (navegacao normal, o caso
            // mais comum em PWA no celular, onde popup e bloqueada), nao ha pra onde "fechar" —
            // entao redireciona de volta pro endereco do app.
            if (window.opener) {
              setTimeout(function () { window.close(); }, ${delayMs});
            } else {
              var appUrl = ${JSON.stringify(appUrl)};
              if (appUrl) setTimeout(function () { window.location.href = appUrl; }, ${delayMs});
            }
          </script>
        </body>
      </html>
    `);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('status')
  status(@CurrentUser() user: CurrentUserPayload) {
    return this.stravaService.status(user.sub);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('sync')
  sync(@CurrentUser() user: CurrentUserPayload) {
    return this.stravaService.sync(user.sub);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('report')
  report(@CurrentUser() user: CurrentUserPayload) {
    return this.stravaService.report(user.sub);
  }

  // Webhook do Strava (05/10/2026): sem SkipThrottle — limite alto o bastante para os reenvios do Strava, baixo o bastante
  // para nao virar vetor de flood. O Strava nao assina os eventos (ver StravaService.handleWebhook).
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Get('webhook')
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.challenge') challenge: string,
    @Query('hub.verify_token') verifyToken: string,
  ) {
    return this.stravaService.verifyWebhook(mode, challenge, verifyToken);
  }

  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @HttpCode(200)
  @Post('webhook')
  receiveWebhook(@Body() event: Record<string, unknown>) {
    // Responde 200 de imediato (o Strava exige resposta em 2 s); o processamento e' assincrono e validado la.
    void this.stravaService.handleWebhook(event);
    return { received: true };
  }

  // Desconectar o Strava (05/10/2026): so' a conexao do proprio aluno (JWT). Para a coleta na hora e apaga os dados Strava.
  @UseGuards(AuthGuard('jwt'))
  @Post('disconnect')
  @HttpCode(200)
  disconnect(@CurrentUser() user: CurrentUserPayload) {
    return this.stravaService.disconnect(user.sub);
  }
}
