import { Prisma } from '@prisma/client';

// Override EXCEPCIONAL de ecossistema (Apple Etapa 3A, revisada em 06/10/2026). NAO e' seletor da observacao canonica: a escolha e'
// automatica, por evento, pelo papel de cada observacao (ver physical-canonical.ts). AthletePrimarySource so' existe como:
//  - override explicito de suporte, que apenas DESEMPATA entre gravadores nativos equivalentes do mesmo evento (ex.: dois relogios);
//  - registro historico por periodo (effectiveFrom) de uma preferencia declarada.
// Sem linha explicita (o caso normal) esta funcao devolve null e nada muda. WorkoutDelivery NAO entra aqui: prova destino da prescricao,
// nao que o evento corresponde a ela (isso so' sera evidencia forte depois da reconciliacao TrainingSession <-> evento, na 3B).
export async function resolveExplicitOverride(
  tx: Pick<Prisma.TransactionClient, 'athletePrimarySource'>,
  userId: string,
  at: Date,
): Promise<string | null> {
  const explicit = await tx.athletePrimarySource.findFirst({
    where: { userId, effectiveFrom: { lte: at } },
    orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    select: { provider: true },
  });
  return explicit ? explicit.provider : null;
}
