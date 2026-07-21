import { Body, Controller, Get, Post, Query, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
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
  async callback(@Query('code') code: string, @Query('state') state: string, @Res() response: { type: (value: string) => { send: (value: string) => void } }) {
    let message: string;
    let isError = false;
    try {
      message = await this.stravaService.callback(code, state);
    } catch (error) {
      isError = true;
      message = error instanceof Error ? error.message : 'Nao consegui concluir a conexao com o Strava.';
    }
    response.type('html').send(`
      <html>
        <head>
          <title>${isError ? 'Nao foi possivel conectar' : 'Strava conectado'}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 32px; color: #0f172a; }
            main { max-width: 520px; margin: 64px auto; line-height: 1.5; }
            h2 { margin-bottom: 8px; }
            p { color: #475569; }
          </style>
        </head>
        <body>
          <main>
            <h2>${message}</h2>
            <p>${isError ? 'Volte ao aplicativo e tente conectar novamente.' : 'A sincronizacao agora e automatica. Pode voltar ao aplicativo.'}</p>
          </main>
          <script>
            if (window.opener) {
              setTimeout(function () { window.close(); }, ${isError ? 3500 : 1200});
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

  @SkipThrottle()
  @Get('webhook')
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.challenge') challenge: string,
    @Query('hub.verify_token') verifyToken: string,
  ) {
    return this.stravaService.verifyWebhook(mode, challenge, verifyToken);
  }

  @SkipThrottle()
  @Post('webhook')
  receiveWebhook(@Body() event: StravaWebhookEvent) {
    void this.stravaService.handleWebhook(event);
    return { received: true };
  }
}

interface StravaWebhookEvent {
  object_type: 'activity' | 'athlete';
  object_id: number;
  aspect_type: 'create' | 'update' | 'delete';
  owner_id: number;
  updates?: Record<string, string | boolean>;
}
