import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TestAccountsService } from '../src/coach/test-accounts.service';
import { STUDENT_METRICS_POPULATION } from '../src/coach/subscription-groups.util';

// 05/11/2026 — Cadastros de teste (ordem do Elton): contas de revisao da Apple/Google e cadastros de teste ficam FORA de todas as contas e listas; aparecem so' em "Cadastros de teste".
const src = (file: string) => readFileSync(join(__dirname, '..', 'src', file), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));

describe('populacao das metricas', () => {
  it('a constante unica que define "aluna" para as contagens exclui cadastros de teste', () => {
    expect(STUDENT_METRICS_POPULATION).toMatchObject({ role: 'student', isTestAccount: false, accountStatus: { not: 'archived' } });
  });

  it('os pontos que contam ou listam alunas filtram isTestAccount (nao ficou consulta de lista sem o filtro)', () => {
    const coach = src('coach/coach.service.ts');
    expect(coach).toContain("baseStudentWhere: Prisma.UserWhereInput = {\n      role: 'student',\n      isTestAccount: false,");
    expect(coach).toContain("allStudentsWhere: Prisma.UserWhereInput = {\n      role: 'student',\n      isTestAccount: false,");
    // treinos propostos/feitos e aderencia da semana (Visao geral) nao somam sessoes das contas de teste
    expect(coach).toContain("plan: { status: 'active', user: { isTestAccount: false } }");
    expect(src('coach/business-intelligence.service.ts')).toContain("plan: { user: { isTestAccount: false } }");
    for (const file of ['observatory/observatory.service.ts', 'equipment/equipment-intelligence.service.ts', 'equipment/student-access.service.ts', 'leo/leo.service.ts', 'messaging/prospect-nurture.service.ts']) {
      expect(src(file)).toContain('isTestAccount: false');
    }
  });

  it('as contas de revisao criadas pelo seed nascem marcadas como teste', () => {
    expect(src('app-review/review-accounts.ts')).toContain("role: 'student', isTestAccount: true");
  });
});

describe('migracao 20261105160000_test_accounts', () => {
  const dir = join(__dirname, '..', 'prisma', 'migrations', '20261105160000_test_accounts');
  const sql = readFileSync(join(dir, 'migration.sql'), 'utf8');
  it('acrescenta a coluna com padrao falso e marca so os codigos informados e as contas de revisao', () => {
    expect(sql).toContain('ADD COLUMN "isTestAccount" BOOLEAN NOT NULL DEFAULT false');
    expect(sql).toContain('"studentCode" IN (45, 61, 72, 74)');
    expect(sql).toContain("LIKE 'revisao-apple-%'");
    expect(sql).toContain("LIKE 'revisao-google-%'");
    const commands = sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n'); // comentarios podem citar UPDATE/DROP COLUMN; so' o SQL executavel conta
    expect(commands.match(/UPDATE/g)).toHaveLength(1);
    expect(commands).not.toMatch(/DELETE|DROP|TRUNCATE/i);
  });
  it('e a mais recente das migracoes e o schema tem o campo', () => {
    const names = readdirSync(join(__dirname, '..', 'prisma', 'migrations')).filter((n) => /^\d/.test(n)).sort();
    expect(names[names.length - 1]).toBe('20261105160000_test_accounts');
    expect(readFileSync(join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8')).toMatch(/isTestAccount\s+Boolean\s+@default\(false\)/);
  });
});

describe('TestAccountsService', () => {
  const build = () => {
    const prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'a', studentCode: 45, name: 'Teste Diagnostico', email: 'td@x.com', subscriptionStatus: 'manual_active', accountStatus: 'active', createdAt: new Date('2026-09-01T00:00:00Z') },
          { id: 'b', studentCode: 61, name: 'Revisor', email: 'revisao-apple-1@x.com', subscriptionStatus: 'manual_active', accountStatus: 'active', createdAt: new Date('2026-10-24T00:00:00Z') },
          { id: 'c', studentCode: 72, name: 'Revisor G', email: 'revisao-google-1@x.com', subscriptionStatus: 'manual_active', accountStatus: 'active', createdAt: new Date('2026-11-03T00:00:00Z') },
        ]),
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    return { service: new TestAccountsService(prisma as never), prisma };
  };

  it('lista so contas marcadas como teste e identifica a conta de revisao', async () => {
    const { service, prisma } = build();
    const result = await service.list();
    expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({ role: 'student', isTestAccount: true });
    expect(result.total).toBe(3);
    expect(result.rows.map((r) => r.kind)).toEqual(['other', 'review_apple', 'review_google']);
    expect(result.rows[0].paymentGroup).toBe('courtesy');
  });

  it('marcar e desmarcar so muda a marca isTestAccount; valor invalido e cadastro inexistente sao recusados', async () => {
    const { service, prisma } = build();
    prisma.user.findFirst.mockResolvedValueOnce({ id: 'x' });
    await expect(service.set('x', true)).resolves.toEqual({ id: 'x', isTestAccount: true });
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'x' }, data: { isTestAccount: true } });
    await expect(service.set('x', 'sim')).rejects.toBeInstanceOf(BadRequestException);
    prisma.user.findFirst.mockResolvedValueOnce(null);
    await expect(service.set('nada', false)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
  });
});
