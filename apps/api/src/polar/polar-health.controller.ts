import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { PolarHealthConsentService } from './polar-health-consent.service';
import { PolarHealthIngestionService } from './polar-health-ingestion.service';

// A aluna decide, no app, quais dados de SAUDE da Polar compartilhar (sem reconectar a Polar). Sempre do PROPRIO usuario logado (o id vem do token); o treinador nao concede nem altera aqui.
@UseGuards(AuthGuard('jwt'))
@Controller('polar/health-consent')
export class PolarHealthController {
  constructor(private readonly consent: PolarHealthConsentService, private readonly ingestion: PolarHealthIngestionService) {}

  @Get()
  async get(@CurrentUser() user: CurrentUserPayload) {
    return { document: this.consent.document(), permissions: await this.consent.permissions(user.sub) };
  }

  @HttpCode(200)
  @Post()
  async set(@CurrentUser() user: CurrentUserPayload, @Body() body: { categories?: unknown; acknowledged?: unknown; consentVersion?: unknown; consentTextHash?: unknown }) {
    const permissions = await this.consent.set(user.sub, { categories: body?.categories, acknowledged: body?.acknowledged, version: body?.consentVersion, textHash: body?.consentTextHash });
    // Primeira importacao logo apos autorizar (em segundo plano; nunca dentro do request). Com POLAR_HEALTH_ENABLED desligado nao faz nada.
    if (permissions.granted.length > 0 && this.ingestion.enabled()) void this.ingestion.sync(user.sub).catch(() => undefined);
    return { permissions };
  }
}
