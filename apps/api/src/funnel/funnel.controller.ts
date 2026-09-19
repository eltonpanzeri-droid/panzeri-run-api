import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsNotEmpty, IsObject, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { FunnelService } from './funnel.service';

// Vinculo deterministico journeyId <-> userId. O userId NUNCA vem do corpo: vem do JWT (o cliente
// so' consegue vincular a jornada ao proprio usuario autenticado).
export class LinkJourneyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9_-]+$/)
  journeyId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  sessionId?: string;

  @IsOptional()
  @IsIn(['signup', 'login'])
  via?: 'signup' | 'login';
}

export class RecordEventDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  sessionId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(/^[a-z_]+$/)
  event!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  userId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  questionId?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  journeyId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  dedupeKey?: string;
}

@Controller('analytics')
export class FunnelController {
  constructor(private readonly funnel: FunnelService) {}

  // Endpoint publico — sem autenticacao, acessivel pelo app antes de qualquer login.
  // Throttle conservador (30/min por IP) pra dificultar flood sem afetar uso legitimo.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('event')
  async recordEvent(@Body() body: RecordEventDto) {
    await this.funnel.record({
      sessionId: body.sessionId,
      event: body.event,
      userId: body.userId,
      questionId: body.questionId,
      metadata: body.metadata,
      journeyId: body.journeyId,
      dedupeKey: body.dedupeKey,
    });
    return { ok: true };
  }

  // Registra que ESTA pessoa autenticada usa/usou ESTA jornada anonima. Idempotente por par
  // (userId, journeyId): a primeira associacao fica com o timestamp real e nunca e' reescrita.
  // Falha aqui nunca afeta login/cadastro (o app chama depois, fire-and-forget).
  @UseGuards(AuthGuard('jwt'))
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('link-journey')
  async linkJourney(
    @Req() req: { user: { sub: string; role: string } },
    @Body() body: LinkJourneyDto,
  ) {
    if (req.user.role !== 'student') return { ok: true, linked: false };
    await this.funnel.linkJourney(req.user.sub, body.journeyId, body.sessionId, body.via ?? 'login');
    return { ok: true, linked: true };
  }

  // Endpoint privado — so o treinador (role coach) pode ver.
  @UseGuards(AuthGuard('jwt'))
  @Get('funnel')
  async getFunnel(
    @Req() req: { user: { sub: string; role: string } },
    @Query('days') days?: string,
  ) {
    if (req.user.role !== 'coach') return { error: 'Acesso restrito ao treinador.' };
    return this.funnel.getReport(days ? Number(days) : 30);
  }
}
