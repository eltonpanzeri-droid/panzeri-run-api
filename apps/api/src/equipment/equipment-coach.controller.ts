import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { DeviceRegistryService } from './device-registry.service';
import { EquipmentIntelligenceService, type EquipmentQuery } from './equipment-intelligence.service';
import { StudentAccessService } from './student-access.service';

// Inteligencia de Equipamentos (23/10/2026) — painel do treinador. Somente leitura e somente AGREGADOS (sem nome/e-mail/id de aluno). Reconstruir a base de dispositivos e' exclusivo de admin.
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('coach', 'admin')
@Controller('coach/equipment')
export class EquipmentCoachController {
  constructor(private readonly intelligence: EquipmentIntelligenceService, private readonly registry: DeviceRegistryService, private readonly studentAccessService: StudentAccessService) {}

  @Get('options')
  options() {
    return this.intelligence.options();
  }

  @Get('intelligence')
  run(@Query() query: EquipmentQuery) {
    return this.intelligence.run(query);
  }

  // Como cada aluna acessa (05/11/2026): lista nominal e SOMENTE LEITURA, separada dos agregados acima.
  @Get('student-access')
  studentAccess() {
    return this.studentAccessService.run();
  }

  @Roles('admin')
  @Post('refresh-devices')
  refresh() {
    return this.registry.refreshAll();
  }
}
