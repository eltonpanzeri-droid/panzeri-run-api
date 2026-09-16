import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { FunnelService } from './funnel.service';

class RecordEventDto {
  sessionId!: string;
  event!: string;
  userId?: string;
  questionId?: string;
  metadata?: Record<string, unknown>;
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
    });
    return { ok: true };
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
