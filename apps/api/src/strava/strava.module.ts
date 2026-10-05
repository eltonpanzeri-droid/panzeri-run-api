import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StravaController } from './strava.controller';
import { StravaService } from './strava.service';

@Module({
  imports: [PrismaModule],
  controllers: [StravaController],
  providers: [StravaService],
  // Sem exports: nenhum outro modulo consome o servico Strava (dados Strava ficam isolados no proprio aluno).
})
export class StravaModule {}
