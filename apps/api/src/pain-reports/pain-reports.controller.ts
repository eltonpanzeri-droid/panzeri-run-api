import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { CreatePainReportDto } from './dto/create-pain-report.dto';
import { PainReportsService } from './pain-reports.service';

@UseGuards(AuthGuard('jwt'))
@Controller('me/pain-reports')
export class PainReportsController {
  constructor(private readonly painReports: PainReportsService) {}

  @Get()
  list(@CurrentUser() user: CurrentUserPayload) {
    return this.painReports.list(user.sub);
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
