import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StudentIntegrationsService } from '../coach/student-integrations.service';
import { DeviceRegistryModule } from './device-registry.module';
import { DevicesService } from './devices.service';
import { EquipmentController } from './equipment.controller';
import { EquipmentCoachController } from './equipment-coach.controller';
import { EquipmentIntelligenceService } from './equipment-intelligence.service';

// Equipamentos (23/10/2026): dispositivos do aluno + inteligencia agregada do painel. Os tenis seguem em ShoesModule. StudentIntegrationsService e' sem estado (so' leitura): reutilizado aqui
// para mostrar o estado de cada plataforma, em vez de criar um segundo levantamento de integracoes.
@Module({
  imports: [PrismaModule, DeviceRegistryModule],
  controllers: [EquipmentController, EquipmentCoachController],
  providers: [DevicesService, EquipmentIntelligenceService, StudentIntegrationsService],
})
export class EquipmentModule {}
