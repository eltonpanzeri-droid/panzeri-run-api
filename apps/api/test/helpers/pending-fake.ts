// Modelo CorrectionReevaluation em memoria para os testes (mesmas operacoes que pending-reevaluation.ts usa): create/update/updateMany/findUnique/findMany/deleteMany,
// com increment e o CAS de lease. Nao e' o banco: validar migracao/transacao de verdade exige PostgreSQL de teste (ver relatorio).
type Row = Record<string, any>;

const clone = (row: Row | undefined | null) => (row ? { ...row } : null);

function applyData(row: Row, data: Row) {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date) && 'increment' in value) row[key] = (row[key] ?? 0) + value.increment;
    else if (value !== undefined) row[key] = value;
  }
  row.updatedAt = new Date();
}

const leaseFree = (row: Row, where: Row) => {
  if (!where.OR) return true;
  return where.OR.some((clause: Row) => ('leaseUntil' in clause && clause.leaseUntil === null ? row.leaseUntil == null : clause.leaseUntil?.lt ? row.leaseUntil != null && row.leaseUntil < clause.leaseUntil.lt : false) || (clause.leaseUntil === null && row.leaseUntil == null));
};

export function pendingModel(initial: Row[] = []) {
  const rows = new Map<string, Row>(initial.map((r) => [r.userId, { version: 1, dirtySince: new Date('2026-10-14T12:00:00Z'), analysisSessionIds: [], forceSessionIds: [], medalsPending: false, medalScope: null, leaseUntil: null, attempts: 0, lastAttemptAt: null, lastError: null, ...r }]));
  const model = {
    findUnique: jest.fn(async ({ where }: any) => clone(rows.get(where.userId))),
    findMany: jest.fn(async ({ where }: any) => [...rows.values()].filter((row) => leaseFree(row, where ?? {})).sort((a, b) => a.dirtySince - b.dirtySince).map((r) => ({ ...r }))),
    create: jest.fn(async ({ data }: any) => {
      const row = { version: 1, dirtySince: new Date(), analysisSessionIds: [], forceSessionIds: [], medalsPending: false, medalScope: null, leaseUntil: null, attempts: 0, lastAttemptAt: null, lastError: null, ...data };
      rows.set(data.userId, row);
      return { ...row };
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = rows.get(where.userId);
      if (!row) throw new Error('linha inexistente');
      applyData(row, data);
      return { ...row };
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const row = rows.get(where.userId);
      if (!row || !leaseFree(row, where)) return { count: 0 };
      applyData(row, data);
      return { count: 1 };
    }),
    deleteMany: jest.fn(async ({ where }: any) => {
      const row = rows.get(where.userId);
      if (!row || (where.version !== undefined && row.version !== where.version)) return { count: 0 };
      rows.delete(where.userId);
      return { count: 1 };
    }),
  };
  return { rows, model };
}
