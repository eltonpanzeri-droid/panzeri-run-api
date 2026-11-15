import { Body, Controller, Get, NotFoundException, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { CreatePainReportDto } from './dto/create-pain-report.dto';
import { PainReportsService } from './pain-reports.service';
import { MathLayerService } from '../training-intelligence/math-layer.service';
import { buildPainReading } from './pain-reading';

@UseGuards(AuthGuard('jwt'))
@Controller('me/pain-reports')
export class PainReportsController {
  constructor(private readonly painReports: PainReportsService, private readonly math: MathLayerService) {}

  @Get()
  list(@CurrentUser() user: CurrentUserPayload) {
    return this.painReports.list(user.sub);
  }

  // Area "Dor" da Evolucao (02/11/2026): dor por treino registrado + relatos avulsos, so' do proprio aluno.
  @Get('history')
  history(@CurrentUser() user: CurrentUserPayload) {
    return this.painReports.history(user.sub);
  }

  // Leitura por regra da dor (os cinco botões sob os gráficos da área Dor, 15/11/2026): todo treino registrado sem relato de dor vale zero.
  @Get('reading')
  async reading(@CurrentUser() user: CurrentUserPayload, @Query('variableId') variableId?: string) {
    const history = await this.painReports.history(user.sub);
    const result = variableId ? buildPainReading(variableId, history, this.math) : null;
    if (!result) throw new NotFoundException('Indicador sem leitura.');
    return result;
  }

  @Get('previous-regions')
  previousRegions(@CurrentUser() user: CurrentUserPayload) {
    return this.painReports.previousRegions(user.sub);
  }

  @Post()
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreatePainReportDto) {
    return this.painReports.create(user.sub, dto);
  }
}
