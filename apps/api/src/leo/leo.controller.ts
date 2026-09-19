import { BadRequestException, Controller, Get, Query, Req, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LEO_JOURNEY_EVENTS, LeoService } from './leo.service';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

@Controller('leo')
export class LeoController {
  constructor(
    private readonly leoService: LeoService,
    private readonly config: ConfigService,
  ) {}

  private assertAuthorized(req: any) {
    const token = this.config.get<string>('PANZERI_RUN_INTERNAL_TOKEN');
    const authHeader = req.headers['authorization'];
    if (!token || authHeader !== `Bearer ${token}`) {
      throw new UnauthorizedException();
    }
  }

  @Get('daily-summary')
  async getDailySummary(@Req() req: any, @Query('date') date: string) {
    this.assertAuthorized(req);

    if (!date || !DATE_RE.test(date)) {
      throw new BadRequestException('Parâmetro date inválido. Use YYYY-MM-DD.');
    }

    return this.leoService.getDailySummary(date);
  }

  // 18/09 (CI-002): from/to opcionais — sem nenhum dos dois, retorna o agregado de todo o
  // histórico de cadastros. Validação de formato só quando o parâmetro é de fato enviado.
  @Get('attribution')
  async getAttribution(@Req() req: any, @Query('from') from?: string, @Query('to') to?: string) {
    this.assertAuthorized(req);

    if (from && !DATE_RE.test(from)) {
      throw new BadRequestException('Parâmetro from inválido. Use YYYY-MM-DD.');
    }
    if (to && !DATE_RE.test(to)) {
      throw new BadRequestException('Parâmetro to inválido. Use YYYY-MM-DD.');
    }

    return this.leoService.getAttribution(from, to);
  }

  // ---- Fundacao longitudinal (19/09) — interface pequena e reutilizavel, so' fatos ----------------

  private assertRange(from?: string, to?: string) {
    if (from && !DATE_RE.test(from)) throw new BadRequestException('Parâmetro from inválido. Use YYYY-MM-DD.');
    if (to && !DATE_RE.test(to)) throw new BadRequestException('Parâmetro to inválido. Use YYYY-MM-DD.');
    if (from && to && from > to) throw new BadRequestException('from não pode ser posterior a to.');
  }

  private parseLimit(limit?: string): number | undefined {
    if (limit === undefined || limit === '') return undefined;
    const n = Number(limit);
    if (!Number.isInteger(n) || n < 1) throw new BadRequestException('Parâmetro limit inválido (inteiro >= 1, máximo 2000).');
    return n;
  }

  private parseCursor(after?: string): string | undefined {
    if (!after) return undefined;
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(after)) throw new BadRequestException('Parâmetro after inválido.');
    return after;
  }

  // Eventos de jornada em ordem cronologica: landing_view, landing_cta_click, app_opened, cadastro,
  // vinculo journeyId<->userId, payment_started... Paginacao por cursor (after = nextCursor anterior).
  @Get('journey-events')
  async getJourneyEvents(
    @Req() req: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('event') event?: string,
    @Query('limit') limit?: string,
    @Query('after') after?: string,
  ) {
    this.assertAuthorized(req);
    this.assertRange(from, to);
    if (event && !(LEO_JOURNEY_EVENTS as readonly string[]).includes(event)) {
      throw new BadRequestException(`Parâmetro event inválido. Permitidos: ${LEO_JOURNEY_EVENTS.join(', ')}.`);
    }
    return this.leoService.getJourneyEvents({ from, to, event, limit: this.parseLimit(limit), after: this.parseCursor(after) });
  }

  // Fatos comerciais: transicoes de status, pagamentos confirmados (valor real Asaas), primeiras compras
  // (Asaas + RevenueCat) e o estado comercial DEPOIS de cada evento. includeBaseline=true inclui a foto-ancora.
  @Get('commercial-events')
  async getCommercialEvents(
    @Req() req: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('after') after?: string,
    @Query('includeBaseline') includeBaseline?: string,
  ) {
    this.assertAuthorized(req);
    this.assertRange(from, to);
    return this.leoService.getCommercialEvents({
      from, to, limit: this.parseLimit(limit), after: this.parseCursor(after), includeBaseline: includeBaseline === 'true',
    });
  }

  // Landing: visitas por origem + coorte de jornadas novas acompanhada ate hoje.
  @Get('landing-summary')
  async getLandingSummary(@Req() req: any, @Query('from') from?: string, @Query('to') to?: string) {
    this.assertAuthorized(req);
    this.assertRange(from, to);
    return this.leoService.getLandingSummary(from, to);
  }
}
