import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { paymentGroupOf } from './subscription-groups.util';

// Cadastros de teste (05/11/2026, ordem do Elton): contas criadas para a Apple e o Google testarem o Panzeri Run e outros cadastros de teste. Ficam FORA de todas as contas, contagens e
// listas de alunas (isTestAccount) e aparecem so' aqui, onde o treinador marca/desmarca. Elas continuam podendo entrar no Panzeri Run (as lojas precisam). Marcar/desmarcar so' muda esta marca.
export interface TestAccountRow {
  id: string; studentCode: number | null; name: string | null; email: string; subscriptionStatus: string; paymentGroup: string; accountStatus: string; createdAt: string; kind: 'review_apple' | 'review_google' | 'other';
}

@Injectable()
export class TestAccountsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<{ total: number; rows: TestAccountRow[] }> {
    const users = await this.prisma.user.findMany({
      where: { role: 'student', isTestAccount: true },
      select: { id: true, studentCode: true, name: true, email: true, subscriptionStatus: true, accountStatus: true, createdAt: true },
      orderBy: [{ createdAt: 'asc' }],
    });
    const rows = users.map((u) => ({
      id: u.id, studentCode: u.studentCode, name: u.name, email: u.email, subscriptionStatus: u.subscriptionStatus, paymentGroup: paymentGroupOf(u.subscriptionStatus), accountStatus: u.accountStatus, createdAt: u.createdAt.toISOString(),
      kind: u.email.startsWith('revisao-apple-') ? ('review_apple' as const) : u.email.startsWith('revisao-google-') ? ('review_google' as const) : ('other' as const),
    }));
    return { total: rows.length, rows };
  }

  async set(studentId: string, isTestAccount: unknown): Promise<{ id: string; isTestAccount: boolean }> {
    if (typeof isTestAccount !== 'boolean') throw new BadRequestException('Informe isTestAccount (verdadeiro ou falso).');
    const user = await this.prisma.user.findFirst({ where: { id: studentId, role: 'student' }, select: { id: true } });
    if (!user) throw new NotFoundException('Cadastro nao encontrado.');
    await this.prisma.user.update({ where: { id: studentId }, data: { isTestAccount } });
    return { id: studentId, isTestAccount };
  }
}
