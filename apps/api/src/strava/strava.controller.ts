import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
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
    const message = await this.stravaService.callback(code, state);
    response.type('html').send(`
      <html>
        <head>
          <title>Strava conectado</title>
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
            <p>Volte ao app e toque em Sincronizar e comparar.</p>
          </main>
          <script>
            if (window.opener) {
              setTimeout(function () { window.close(); }, 1200);
            }
          </script>
        </body>
      </html>
    `);
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
}
