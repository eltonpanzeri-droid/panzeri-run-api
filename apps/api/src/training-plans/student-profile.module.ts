import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AiQueueModule } from '../common/ai-queue.module';
import { StudentProfileService } from './student-profile.service';

// Modulo isolado (sem depender de TrainingPlansModule) para evitar dependencia circular: varios
// modulos que disparam eventos do prontuario (pain-reports, observations, reassessment,
// workout-completions, technical-manager) sao, eles mesmos, importados por TrainingPlansModule.
@Module({
  imports: [PrismaModule, AiQueueModule],
  providers: [StudentProfileService],
  exports: [StudentProfileService],
})
export class StudentProfileModule {}
