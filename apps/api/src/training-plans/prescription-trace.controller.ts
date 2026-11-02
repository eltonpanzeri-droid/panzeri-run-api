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
    @Query('packageId') packageId?: string,
  ) {
    return this.trace.getTrace(studentId, { planId, sessionId, packageId, includeAgentInput: includeAgentInput === 'true' });
  }

  // Lista leve dos pacotes (sem prompt) e prontuario da aluna: base da tela "O que a IA recebeu" (02/11/2026). So' leitura.
  @Get('students/:studentId/prescription-packages')
  list(@Param('studentId') studentId: string, @Query('limit') limit?: string) {
    return this.trace.listPackages(studentId, limit ? parseInt(limit, 10) : undefined);
  }

  @Get('students/:studentId/prontuario')
  prontuario(@Param('studentId') studentId: string) {
    return this.trace.getProntuario(studentId);
  }
}
