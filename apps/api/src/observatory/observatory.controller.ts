import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { ObservatoryService } from './observatory.service';

// Observatorio Panzeri Run (24/10/2026) — EXCLUSIVO de administrador (nao basta ser treinador). Somente leitura e somente agregados.
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('admin')
@Controller('observatory')
export class ObservatoryController {
  constructor(private readonly observatory: ObservatoryService) {}

  @Get('status')
  status() {
    return this.observatory.status();
  }

  @Get('analysis')
  analysis(@Query() query: Record<string, string | undefined>) {
    return this.observatory.analysis(query);
  }
}
