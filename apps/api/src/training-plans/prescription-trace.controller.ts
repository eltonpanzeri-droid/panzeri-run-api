import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { PrescriptionTraceService } from './prescription-trace.service';

// So' leitura, so' treinador/admin. Reconstroi uma prescricao: evidencias consideradas, decisoes e resultados observados.
// agentInput (entrada completa enviada a IA, dado pessoal e de saude) so' sai com includeAgentInput=true.
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('coach', 'admin')
@Controller('coach')
export class PrescriptionTraceController {
  constructor(private readonly trace: PrescriptionTraceService) {}

  @Get('students/:studentId/prescription-trace')
  get(
    @Param('studentId') studentId: string,
    @Query('planId') planId?: string,
    @Query('sessionId') sessionId?: string,
    @Query('includeAgentInput') includeAgentInput?: string,
  ) {
    return this.trace.getTrace(studentId, { planId, sessionId, includeAgentInput: includeAgentInput === 'true' });
  }
}
