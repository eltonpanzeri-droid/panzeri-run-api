import { Prisma } from '@prisma/client';
import { PrimaryOrigin } from './physical-canonical';

// Ecossistema de execucao PRIMARIO do atleta NUM INSTANTE (Apple Etapa 3A). Preferencia por periodo, nao um atributo "atual" do usuario:
//  1) linha explicita de AthletePrimarySource vigente em `at` (a de maior effectiveFrom <= at) — trocar de relogio cria uma linha nova e
//     NAO muda a resolucao de datas anteriores a ela;
//  2) senao, o ecossistema que recebeu a prescricao: WorkoutDelivery mais recente (enviada/entregue) ate `at` — estrutura ja' existente,
//     com timestamp, entao tambem e' historicamente estavel;
//  3) senao, null (sem primario: a canonica sai por fallback deterministico).
// Nunca deriva do conjunto atual de conexoes nem de hierarquia de provider.
export async function resolvePrimarySource(
  tx: Pick<Prisma.TransactionClient, 'athletePrimarySource' | 'workoutDelivery'>,
  userId: string,
  at: Date,
): Promise<{ key: string; origin: PrimaryOrigin } | null> {
  const explicit = await tx.athletePrimarySource.findFirst({
    where: { userId, effectiveFrom: { lte: at } },
    orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    select: { provider: true },
  });
  if (explicit) return { key: explicit.provider, origin: 'explicit' };

  const delivery = await tx.workoutDelivery.findFirst({
    where: { trainingSession: { userId }, status: { in: ['sent', 'delivered_to_device'] }, requestedAt: { lte: at } },
    orderBy: { requestedAt: 'desc' },
    select: { provider: true },
  });
  return delivery ? { key: delivery.provider, origin: 'delivery_history' } : null;
}
