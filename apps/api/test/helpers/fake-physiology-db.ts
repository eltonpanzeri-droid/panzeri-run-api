// Banco em memória para os testes de Testes físicos (Lotes 2 a 4). Só o que os serviços de fisiologia usam.
let seq = 0;
const nextId = () => `f${++seq}`;

export type FakeUsers = Record<string, { birthDate: Date | null; sex: string | null }>;

export function fakeDb(users: FakeUsers) {
  const t = { fitness: [] as any[], assess: [] as any[], ind: [] as any[], ref: [] as any[], touched: [] as string[] };
  const match = (row: any, where: any = {}): boolean => Object.entries(where).every(([k, v]) => {
    if (k === 'OR') return (v as any[]).some((w) => match(row, w));
    if (v && typeof v === 'object' && 'not' in (v as any)) return row[k] !== (v as any).not;
    return row[k] === v;
  });
  const order = (rows: any[], orderBy: any) => {
    const list = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
    return [...rows].sort((a, b) => {
      for (const o of list) {
        const [field, dir] = Object.entries(o)[0] as [string, string];
        const av = a[field] instanceof Date ? a[field].getTime() : a[field];
        const bv = b[field] instanceof Date ? b[field].getTime() : b[field];
        if (av !== bv) return (av < bv ? -1 : 1) * (dir === 'desc' ? -1 : 1);
      }
      return 0;
    });
  };
  const ref: { current: any } = { current: null };
  const db: any = {
    user: { findUnique: async ({ where }: any) => users[where.id] ?? null },
    fitnessTest: {
      findFirst: async ({ where, orderBy }: any) => order(t.fitness.filter((r) => match(r, where)), orderBy)[0] ?? null,
      findMany: async ({ where, orderBy }: any) => order(t.fitness.filter((r) => match(r, where)), orderBy),
      create: async ({ data }: any) => { const row = { id: nextId(), createdAt: new Date('2026-10-30T12:00:00Z'), ...data }; t.fitness.push(row); return row; },
      update: async ({ where, data }: any) => { const row = t.fitness.find((r) => r.id === where.id); Object.assign(row, data); return row; },
    },
    physiologicalAssessment: {
      findMany: async ({ where, include, orderBy }: any) => order(t.assess.filter((r) => match(r, where)), orderBy).map((r) => ({ ...r, indicators: t.ind.filter((i) => i.assessmentId === r.id && match(i, include?.indicators?.where)) })),
      findUnique: async ({ where }: any) => t.assess.find((r) => r.fitnessTestId === where.fitnessTestId) ?? null,
      create: async ({ data }: any) => { const row = { id: nextId(), domain: 'aerobic', createdAt: new Date('2026-10-30T12:00:00Z'), ...data }; t.assess.push(row); return row; },
      update: async ({ where, data }: any) => { const row = t.assess.find((r) => r.id === where.id); Object.assign(row, data); return row; },
    },
    physiologicalIndicator: {
      deleteMany: async ({ where }: any) => { t.ind = t.ind.filter((i) => i.assessmentId !== where.assessmentId); },
      createMany: async ({ data }: any) => { t.ind.push(...data.map((d: any) => ({ id: nextId(), ...d }))); },
    },
    operationalReference: {
      findFirst: async ({ where, orderBy }: any) => order(t.ref.filter((r) => match(r, where)), orderBy)[0] ?? null,
      findMany: async ({ where, orderBy, take }: any) => order(t.ref.filter((r) => match(r, where)), orderBy).slice(0, take ?? 1000),
      create: async ({ data }: any) => {
        if (t.ref.some((r) => r.userId === data.userId && r.version === data.version)) { const { Prisma } = require('@prisma/client'); throw new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }); }
        const row = { id: nextId(), createdAt: data.createdAt ?? new Date(), ...data }; t.ref.push(row); return row;
      },
    },
    $transaction: async (fn: any) => fn(ref.current),
  };
  // Qualquer acesso a tabelas de programa/tentativas explode: salvar um teste nunca pode gerar programa nem gastar tentativa.
  const guarded = new Proxy(db, {
    get(target, prop: string) {
      if (['trainingPlan', 'trainingPlanGenerationLock', 'trainingSession'].includes(prop)) { t.touched.push(prop); throw new Error(`acesso proibido a ${prop}`); }
      return target[prop];
    },
  });
  ref.current = guarded;
  return { db: guarded as any, t };
}
