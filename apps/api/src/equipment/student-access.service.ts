import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { REVIEW_EMAIL_PREFIXES } from '../app-review/review-accounts';
import { paymentGroupOf, type PaymentGroup } from '../coach/subscription-groups.util';

// "Como cada aluna acessa" (05/11/2026, pedido do Elton). SOMENTE LEITURA. Mostra, por aluna, so' o que o servidor sabe de fato:
//  - push: ha token de notificacao (so' o Panzeri Run instalado pela loja registra; o navegador/PWA nao);
//  - conexoes ativas (Health Connect => Android; Apple Saude => iPhone; Polar, Zepp etc.);
//  - atividades recebidas por conexao, e a data da ultima.
// O servidor NAO guarda a plataforma do aparelho: "provavelmente so' navegador" e' ESTIMATIVA (sem push e sem nenhuma conexao nativa). Quem instalou o Panzeri Run e negou
// notificacoes, e nao conectou nada, aparece como navegador. Diferente da Inteligencia de Equipamentos (so' agregados), esta lista traz nome/codigo: e' ferramenta operacional do
// treinador/administrador (mesmo acesso dos demais paineis por aluna). Contas de revisao das lojas ficam de fora.
export type StudentAccessKind = 'android' | 'ios' | 'native_unknown' | 'browser_probable';

export interface StudentAccessRow {
  id: string;
  studentCode: number | null;
  name: string | null;
  subscriptionStatus: string;
  // Mesmo agrupamento do resto do painel (fonte unica): confirmed/courtesy/overdue = aluna atual; pending = prospecto; canceled = ex-aluna.
  paymentGroup: PaymentGroup;
  accountStatus: string;
  push: boolean;
  access: StudentAccessKind;
  connections: Array<{ provider: string; lastSyncAt: string | null }>;
  activities: Array<{ provider: string; count: number; lastAt: string | null }>;
}

export interface StudentAccessResult {
  generatedAt: string;
  total: number;
  counts: Record<StudentAccessKind, number>;
  rows: StudentAccessRow[];
  notes: string[];
}

export function classifyAccess(input: { push: boolean; providers: string[] }): StudentAccessKind {
  if (input.providers.includes('health_connect')) return 'android';
  if (input.providers.includes('apple_health')) return 'ios';
  return input.push ? 'native_unknown' : 'browser_probable';
}

@Injectable()
export class StudentAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async run(): Promise<StudentAccessResult> {
    const students = await this.prisma.user.findMany({
      where: {
        role: 'student',
        isTestAccount: false,
        accountStatus: { not: 'archived' },
        NOT: { OR: REVIEW_EMAIL_PREFIXES.map((prefix) => ({ email: { startsWith: prefix } })) },
      },
      select: { id: true, name: true, studentCode: true, subscriptionStatus: true, accountStatus: true, expoPushToken: true },
      orderBy: [{ name: 'asc' }],
    });
    const ids = students.map((s) => s.id);
    const [connections, activityGroups] = ids.length === 0 ? [[], []] : await Promise.all([
      this.prisma.providerConnection.findMany({ where: { userId: { in: ids }, disconnectedAt: null }, select: { userId: true, provider: true, lastSyncCompletedAt: true } }),
      this.prisma.activityLog.groupBy({ by: ['userId', 'provider'], where: { userId: { in: ids } }, _count: { _all: true }, _max: { startedAt: true } }),
    ]);

    const connectionsOf = new Map<string, StudentAccessRow['connections']>();
    for (const c of connections) connectionsOf.set(c.userId, [...(connectionsOf.get(c.userId) ?? []), { provider: c.provider, lastSyncAt: c.lastSyncCompletedAt?.toISOString() ?? null }]);
    const activitiesOf = new Map<string, StudentAccessRow['activities']>();
    for (const g of activityGroups) activitiesOf.set(g.userId, [...(activitiesOf.get(g.userId) ?? []), { provider: g.provider, count: g._count._all, lastAt: g._max.startedAt?.toISOString() ?? null }]);

    const counts: Record<StudentAccessKind, number> = { android: 0, ios: 0, native_unknown: 0, browser_probable: 0 };
    const rows: StudentAccessRow[] = students.map((s) => {
      const conns = (connectionsOf.get(s.id) ?? []).sort((a, b) => (a.provider < b.provider ? -1 : 1));
      const push = Boolean(s.expoPushToken);
      const access = classifyAccess({ push, providers: conns.map((c) => c.provider) });
      counts[access] += 1;
      return {
        id: s.id, studentCode: s.studentCode, name: s.name, subscriptionStatus: s.subscriptionStatus, paymentGroup: paymentGroupOf(s.subscriptionStatus), accountStatus: s.accountStatus, push, access,
        connections: conns, activities: (activitiesOf.get(s.id) ?? []).sort((a, b) => (a.provider < b.provider ? -1 : 1)),
      };
    });
    return {
      generatedAt: new Date().toISOString(),
      total: rows.length,
      counts,
      rows,
      notes: [
        'O servidor não guarda a plataforma do aparelho. "Provavelmente só navegador" = sem notificação registrada e sem Health Connect nem Apple Saúde conectados; é uma estimativa.',
        'Health Connect indica Android; Apple Saúde indica iPhone. Quem tem o Panzeri Run instalado e negou notificações, sem conectar nada, aparece como navegador.',
      ],
    };
  }
}
