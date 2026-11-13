import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { ProblemReportsService } from './problem-reports.service';

// Aluna: SOMENTE os proprios relatos (id sempre do token).
@UseGuards(AuthGuard('jwt'))
@Controller('me/problem-reports')
export class ProblemReportsStudentController {
  constructor(private readonly reports: ProblemReportsService) {}

  @Post()
  create(@CurrentUser() user: CurrentUserPayload, @Body() body: Record<string, unknown>) {
    return this.reports.create(user.sub, body);
  }

  @Post(':id/images')
  addImage(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string, @Body() body: { imageBase64?: unknown }) {
    return this.reports.addImage(user.sub, id, body?.imageBase64);
  }

  @Get()
  listMine(@CurrentUser() user: CurrentUserPayload) {
    return this.reports.listMine(user.sub);
  }
}

@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('coach', 'admin')
@Controller('coach/problem-reports')
export class ProblemReportsCoachController {
  constructor(private readonly reports: ProblemReportsService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.reports.listForCoach(status);
  }

  @Get(':id/images/:imageId')
  image(@Param('id') id: string, @Param('imageId') imageId: string) {
    return this.reports.imageForCoach(id, imageId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: { status?: unknown; coachNote?: unknown }) {
    return this.reports.updateForCoach(id, body);
  }
}
