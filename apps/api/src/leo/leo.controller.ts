import { BadRequestException, Controller, Get, Query, Req, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LeoService } from './leo.service';

@Controller('leo')
export class LeoController {
  constructor(
    private readonly leoService: LeoService,
    private readonly config: ConfigService,
  ) {}

  @Get('daily-summary')
  async getDailySummary(@Req() req: any, @Query('date') date: string) {
    const token = this.config.get<string>('PANZERI_RUN_INTERNAL_TOKEN');
    const authHeader = req.headers['authorization'];
    if (!token || authHeader !== `Bearer ${token}`) {
      throw new UnauthorizedException();
    }

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('Parâmetro date inválido. Use YYYY-MM-DD.');
    }

    return this.leoService.getDailySummary(date);
  }
}
