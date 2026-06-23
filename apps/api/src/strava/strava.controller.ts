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
    response.type('html').send(`<html><body><h2>${message}</h2></body></html>`);
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
