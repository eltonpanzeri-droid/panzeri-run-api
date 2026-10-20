import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SessionExecutionLinkService } from '../activity-execution/session-execution-link.service';
import { ZEPP_WORKOUT_PROVIDER } from './zepp-workout-publisher.service';

// Vinculo EXATO entre a atividade executada e o treino que o Panzeri Run publicou na Zepp (Lote 4). So' acontece quando a Zepp devolve o `workoutId` publicado no
// registro da atividade (campo confirmado em ZEPP_EXECUTED_WORKOUT_ID_FIELD — hoje NAO confirmado, entao este servico nem e' acionado). Regras:
//  - nunca sobrescreve decisao existente: atividade ja' classificada, treino que ja' tem outra atividade vinculada ou evento fisico com varias observacoes
//    (matched/ambiguous) ficam com o mecanismo normal de reconciliacao (que sabe lidar com a observacao canonica);
//  - vinculo exato e' 'automatic' com matchMethod 'zepp_workout_id'; o aluno/treinador continuam podendo corrigir;
//  - sem entrega correspondente (id desconhecido) nada e' feito: segue a associacao existente, sem apresentar inferencia como certeza.
export type ExactLinkOutcome = 'linked' | 'no_delivery' | 'already_decided' | 'session_taken' | 'identity_pending' | 'not_found';

@Injectable()
export class ZeppExactLinkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly links: SessionExecutionLinkService,
  ) {}

  async tryLink(userId: string, activityLogId: string, publishedWorkoutId: string): Promise<ExactLinkOutcome> {
    const activity = await this.prisma.activityLog.findUnique({ where: { id: activityLogId } });
    if (!activity || activity.userId !== userId) return 'not_found';
    if (activity.executionClassification) return 'already_decided';
    if (activity.physicalIdentityStatus === 'matched' || activity.physicalIdentityStatus === 'ambiguous') return 'identity_pending';

    // 'sent' (aceita pela Zepp) ou 'canceled' (versao anterior do MESMO treino: o workoutId e' reaproveitado entre versoes). 'failed'/'pending' nunca chegaram ao relogio.
    const delivery = await this.prisma.workoutDelivery.findFirst({
      where: { provider: ZEPP_WORKOUT_PROVIDER, externalWorkoutId: publishedWorkoutId, status: { in: ['sent', 'canceled'] }, trainingSession: { userId } },
      orderBy: { requestedAt: 'desc' },
      select: { trainingSessionId: true },
    });
    if (!delivery) return 'no_delivery';

    const session = await this.prisma.trainingSession.findFirst({ where: { id: delivery.trainingSessionId, userId }, include: { executionLinks: { where: { status: 'active' }, select: { id: true }, take: 1 } } });
    if (!session) return 'no_delivery';
    if (session.executionLinks.length > 0) return 'session_taken';

    await this.links.linkManually({
      trainingSessionId: session.id,
      activityLogId,
      origin: 'automatic',
      confidence: 'exact',
      matchMethod: 'zepp_workout_id',
      evidence: [{ criterion: 'same_athlete', matched: true }],
      note: 'Identificador do treino publicado na Zepp.',
    });
    return 'linked';
  }
}
