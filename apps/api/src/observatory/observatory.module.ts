import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ObservatoryController } from './observatory.controller';
import { ObservatoryService } from './observatory.service';

// Modulo isolado do Observatorio: nao altera prescricao, cobranca, acompanhamento individual nem telas das alunas.
@Module({ imports: [PrismaModule], controllers: [ObservatoryController], providers: [ObservatoryService] })
export class ObservatoryModule {}
