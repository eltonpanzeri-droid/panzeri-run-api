import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DeviceRegistryService } from './device-registry.service';

// Registro automatico de dispositivos (23/10/2026): modulo proprio e minimo (so' o banco) para as integracoes poderem acionar o registro sem criar ciclo de modulos.
@Module({ imports: [PrismaModule], providers: [DeviceRegistryService], exports: [DeviceRegistryService] })
export class DeviceRegistryModule {}
