import { Module } from '@nestjs/common';
import { EvolutionModule } from '../evolution/evolution.module';
import { MedalCatalogSyncService } from './medal-catalog-sync.service';
import { MedalEvaluationService } from './medal-evaluation.service';
import { MedalsService } from './medals.service';
import { MedalsController } from './medals.controller';

// Sistema de Medalhas (30/09/2026) — módulo isolado, só depende de EvolutionModule (volume/
// aderência já calculados) + PrismaService (global). Nenhuma dependência de
// TrainingPlansModule/ReassessmentModule/WorkoutCompletionsModule — são ELES que importam este
// módulo pra disparar avaliação nos pontos certos, nunca o contrário (evita ciclo).
// Controller (GET /me/medals) fica aqui mesmo — não fizemos UI ainda, mas a API já pode servir
// qualquer cliente que precisar consultar conquistas antes da reformulação da Home do aluno.
@Module({
  imports: [EvolutionModule],
  controllers: [MedalsController],
  providers: [MedalCatalogSyncService, MedalEvaluationService, MedalsService],
  exports: [MedalEvaluationService, MedalsService],
})
export class MedalsModule {}
