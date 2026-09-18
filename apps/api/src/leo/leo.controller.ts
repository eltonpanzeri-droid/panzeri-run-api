import { BadRequestException, Controller, Get, Query, Req, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LeoService } from './leo.service';

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
}
