import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { CreateExternalAssessmentDto } from './dto/create-external-assessment.dto';
import { PhysiologyService } from './physiology.service';

// Aluno: registra e consulta as PRÓPRIAS avaliações (o userId vem sempre do token, nunca do corpo ou da URL).
@UseGuards(AuthGuard('jwt'))
@Controller('physiology')
export class PhysiologyController {
  constructor(private readonly physiology: PhysiologyService) {}

  @Post('assessments')
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateExternalAssessmentDto) {
    return this.physiology.recordExternal(user.sub, dto, { id: user.sub, role: user.role });
  }

  @Get('profile')
  profile(@CurrentUser() user: CurrentUserPayload) {
    return this.physiology.profile(user.sub);
  }

  @Get('history')
  history(@CurrentUser() user: CurrentUserPayload, @Query('method') method?: string, @Query('indicator') indicator?: string) {
    return this.physiology.history(user.sub, { method, indicator });
  }
}

// Treinador: registra ergoespirometria e outros testes aplicados por ele para um aluno, e consulta o perfil.
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('coach', 'admin')
@Controller('coach/physiology')
export class CoachPhysiologyController {
  constructor(private readonly physiology: PhysiologyService) {}

  @Post('students/:studentId/assessments')
  create(@CurrentUser() user: CurrentUserPayload, @Param('studentId') studentId: string, @Body() dto: CreateExternalAssessmentDto) {
    return this.physiology.recordExternal(studentId, dto, { id: user.sub, role: user.role });
  }

  @Get('students/:studentId/profile')
  profile(@Param('studentId') studentId: string) {
    return this.physiology.profile(studentId);
  }

  @Get('students/:studentId/history')
  history(@Param('studentId') studentId: string, @Query('method') method?: string, @Query('indicator') indicator?: string) {
    return this.physiology.history(studentId, { method, indicator });
  }

  // Recálculo dos testes de 3 km antigos com o modelo vigente. Só admin. dryRun=true (padrão) apenas mostra o que mudaria.
  @Roles('admin')
  @Post('recompute-legacy')
  recompute(@Query('apply') apply?: string) {
    return this.physiology.recomputeLegacy({ dryRun: apply !== 'true' });
  }
}
