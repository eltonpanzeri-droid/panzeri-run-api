// Consumo objetivo CANONICO (3C.1): consumidores que leem ActivityLog para volume/pace/cadencia usam UMA observacao por PhysicalEvent — a
// canonica escolhida na 3A (physicalCanonicalActivityLogId). Nao decide nada novo: so' reaproveita a selecao ja' gravada.
//  - atividade sem evento, 'unique' ou com identidade nao resolvida segue contando normalmente (e' o proprio evento);
//  - evento 'matched': conta so' a canonica; os dados das outras observacoes NUNCA entram nem completam a canonica;
//  - se a linha lida e' nao-canonica (ex.: classificacao legada ainda nao reconciliada), a canonica e' buscada e passa a representar o
//    evento (a classificacao continua sendo a da linha lida, em `representedBy`); se a canonica nao existir, mantem a linha lida (sem perda).

export interface EventObservationRow {
  id: string;
  physicalIdentityStatus?: string | null;
  physicalEventId?: string | null;
  physicalCanonicalActivityLogId?: string | null;
}

export interface CanonicalPick<T> {
  // Observacao cujos DADOS objetivos valem para o evento.
  row: T;
  // Linha originalmente lida (carrega a classificacao de execucao); igual a `row` no caso normal.
  representedBy: T;
  // TODAS as linhas lidas que pertencem a este evento (inclui nao-canonicas) — para quem precisa saber se alguma delas tem vinculo,
  // classificacao ou sessao sintetica.
  members: T[];
}

function eventKey(row: EventObservationRow): string {
  return row.physicalIdentityStatus === 'matched' && row.physicalEventId ? `event:${row.physicalEventId}` : `activity:${row.id}`;
}

export async function pickCanonicalPerEvent<T extends EventObservationRow>(
  rows: T[],
  loadByIds: (ids: string[]) => Promise<T[]>,
): Promise<Array<CanonicalPick<T>>> {
  // Eventos matched cuja canonica esta' fora da leitura (linha lida e' nao-canonica) — busca de uma vez.
  const readIds = new Set(rows.map((row) => row.id));
  const missingCanonicalIds = [
    ...new Set(
      rows
        .filter((row) => eventKey(row).startsWith('event:') && row.physicalCanonicalActivityLogId && row.physicalCanonicalActivityLogId !== row.id && !readIds.has(row.physicalCanonicalActivityLogId))
        .map((row) => row.physicalCanonicalActivityLogId as string),
    ),
  ];
  const loaded = missingCanonicalIds.length > 0 ? (await loadByIds(missingCanonicalIds)).filter((row) => missingCanonicalIds.includes(row.id)) : [];
  const canonicalById = new Map<string, T>([...rows, ...loaded].map((row) => [row.id, row]));

  const picks = new Map<string, CanonicalPick<T>>();
  for (const row of rows) {
    const key = eventKey(row);
    const canonicalId = key.startsWith('event:') ? row.physicalCanonicalActivityLogId ?? null : null;
    const canonical = canonicalId ? canonicalById.get(canonicalId) : undefined;
    const existing = picks.get(key);
    const members = [...(existing?.members ?? []), row];
    const pick: CanonicalPick<T> = { row: canonical ?? row, representedBy: row, members };
    // Mais de uma linha lida do mesmo evento: prefere a que e' a propria canonica (carrega a classificacao correta).
    if (!existing) picks.set(key, pick);
    else picks.set(key, row.id === canonicalId && existing.representedBy.id !== canonicalId ? pick : { ...existing, members });
  }
  return [...picks.values()];
}
