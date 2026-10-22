import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { LegacyConsentService } from './legacy-consent.service';

// A aluna decide sobre o Atlas para a Polar/Wahoo que ja' tinha conectado. Sempre do PROPRIO usuario logado (o id vem do token); o treinador nao concede nem altera aqui.
@UseGuards(AuthGuard('jwt'))
@Controller('legacy-consent')
export class LegacyConsentController {
  constructor(private readonly consent: LegacyConsentService) {}

  @Get(':provider')
  async get(@CurrentUser() user: CurrentUserPayload, @Param('provider') provider: string) {
    return { document: this.consent.document(provider), permissions: await this.consent.permissions(provider, user.sub) };
  }

  @HttpCode(200)
  @Post(':provider/atlas')
  setAtlas(@CurrentUser() user: CurrentUserPayload, @Param('provider') provider: string, @Body() body: { grant?: unknown; acknowledged?: unknown; consentVersion?: unknown; consentTextHash?: unknown }) {
    return this.consent.setAtlas(provider, user.sub, { grant: body?.grant, acknowledged: body?.acknowledged, version: body?.consentVersion, textHash: body?.consentTextHash });
  }
}
