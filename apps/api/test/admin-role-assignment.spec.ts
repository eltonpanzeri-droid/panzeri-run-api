import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as bcrypt from 'bcryptjs';
import { AuthService } from '../src/auth/auth.service';
import { CoachController } from '../src/coach/coach.controller';
import { FunnelController } from '../src/funnel/funnel.controller';
import { RolesGuard } from '../src/common/roles.guard';
import { isStaffRole, parseEmailList, resolveEffectiveRole } from '../src/common/staff-roles';

// Atribuicao operacional do papel admin (05/10/2026): ADMIN_EMAILS segue o padrao de COACH_EMAILS.
// Precedencia: admin > coach > papel persistido. Admin nao perde nada do que o coach ja faz.

describe('resolveEffectiveRole — ADMIN_EMAILS / COACH_EMAILS', () => {
  const ADMIN = 'admin@panzeri.run, Dono@Panzeri.run';
  const COACH = 'treinador@panzeri.run,dono@panzeri.run';

  it('e-mail em ADMIN_EMAILS => admin (sem diferenciar maiusculas nem espacos)', () => {
    expect(resolveEffectiveRole('ADMIN@panzeri.run', 'student', ADMIN, COACH)).toBe('admin');
  });

  it('e-mail em COACH_EMAILS => coach', () => {
    expect(resolveEffectiveRole('treinador@panzeri.run', 'student', ADMIN, COACH)).toBe('coach');
  });

  it('e-mail nas duas listas => admin (precedencia)', () => {
    expect(resolveEffectiveRole('dono@panzeri.run', 'student', ADMIN, COACH)).toBe('admin');
  });

  it('e-mail em nenhuma lista => papel persistido (comportamento atual), inclusive sem as variaveis', () => {
    expect(resolveEffectiveRole('aluno@x.com', 'student', ADMIN, COACH)).toBe('student');
    expect(resolveEffectiveRole('aluno@x.com', 'student', undefined, undefined)).toBe('student');
    expect(resolveEffectiveRole('treinador@panzeri.run', 'student', undefined, COACH)).toBe('coach'); // sem ADMIN_EMAILS nada muda
  });

  it('parseEmailList ignora vazios e normaliza', () => {
    expect(parseEmailList(' A@x.com ,, b@X.com ')).toEqual(['a@x.com', 'b@x.com']);
    expect(parseEmailList(undefined)).toEqual([]);
  });

  it('isStaffRole: coach e admin sim; student e indefinido nao', () => {
    expect([isStaffRole('coach'), isStaffRole('admin'), isStaffRole('student'), isStaffRole(undefined)]).toEqual([true, true, false, false]);
  });
});

describe('AuthService.login — papel efetivo e isencao do status de matricula', () => {
  const env: Record<string, string> = { ADMIN_EMAILS: 'admin@panzeri.run', COACH_EMAILS: 'treinador@panzeri.run' };
  const hash = bcrypt.hashSync('senha-teste', 4);

  function build(user: { email: string; role: string; accountStatus: string }) {
    const prisma = {
      user: {
        findUnique: jest.fn(async () => ({ id: 'u1', name: 'N', passwordHash: hash, ...user })),
        update: jest.fn(async () => ({})),
      },
    };
    const jwt = { signAsync: jest.fn(async (payload: { role: string }) => `jwt-${payload.role}`) };
    const config = { get: jest.fn((name: string) => env[name]) };
    return { service: new AuthService(prisma as never, jwt as never, config as never, {} as never), jwt };
  }
  const login = (service: AuthService, email: string) => service.login({ email, password: 'senha-teste' } as never);

  it('login de e-mail em ADMIN_EMAILS devolve role admin e token com role admin', async () => {
    const { service, jwt } = build({ email: 'admin@panzeri.run', role: 'student', accountStatus: 'active' });
    const result = await login(service, 'admin@panzeri.run');
    expect(result.user.role).toBe('admin');
    expect((jwt.signAsync.mock.calls[0] as unknown[])[0]).toMatchObject({ role: 'admin' });
  });

  it('login de e-mail em COACH_EMAILS continua coach', async () => {
    const { service } = build({ email: 'treinador@panzeri.run', role: 'student', accountStatus: 'active' });
    expect((await login(service, 'treinador@panzeri.run')).user.role).toBe('coach');
  });

  it('admin e coach nao sao trancados por accountStatus de matricula; aluno inativo continua barrado', async () => {
    for (const email of ['admin@panzeri.run', 'treinador@panzeri.run']) {
      const { service } = build({ email, role: 'student', accountStatus: 'paused' });
      await expect(login(service, email)).resolves.toBeDefined();
    }
    const { service } = build({ email: 'aluno@x.com', role: 'student', accountStatus: 'paused' });
    await expect(login(service, 'aluno@x.com')).rejects.toThrow('Conta sem acesso ativo.');
  });
});

describe('capacidades de coach preservadas para admin', () => {
  const guard = new RolesGuard(new Reflector());
  const proto = CoachController.prototype as unknown as Record<string, (...args: never[]) => unknown>;
  const ctx = (handler: string, role: string) => ({
    getHandler: () => proto[handler],
    getClass: () => CoachController,
    switchToHttp: () => ({ getRequest: () => ({ user: { sub: 'u', email: 'e', role } }) }),
  } as unknown as ExecutionContext);
  const allowed = (handler: string, role: string) => {
    try { return guard.canActivate(ctx(handler, role)); } catch (e) { if (e instanceof ForbiddenException) return false; throw e; }
  };

  it('admin acessa o endpoint raw; coach recebe 403 no raw', () => {
    expect(allowed('getExternalActivityRaw', 'admin')).toBe(true);
    expect(allowed('getExternalActivityRaw', 'coach')).toBe(false);
  });

  it('admin mantem o acompanhamento que o coach tem (painel do treinador)', () => {
    for (const handler of ['listExternalActivities', 'reclassifyExternalActivity', 'sendStudentMessage', 'getStudentMenstrualData']) {
      expect(allowed(handler, 'admin')).toBe(true);
      expect(allowed(handler, 'coach')).toBe(true);
    }
  });

  it('relatorio de funil (antes so coach): admin e coach acessam; aluno nao', async () => {
    const funnel = { getReport: jest.fn(async () => ({ ok: true })) };
    const controller = new FunnelController(funnel as never);
    const as = (role: string) => controller.getFunnel({ user: { sub: 'u', role } }, '30');
    await expect(as('admin')).resolves.toEqual({ ok: true });
    await expect(as('coach')).resolves.toEqual({ ok: true });
    await expect(as('student')).resolves.toEqual({ error: 'Acesso restrito ao treinador.' });
  });

  it('papel efetivo de e-mail so em ADMIN_EMAILS passa pelo guard do raw (ponta a ponta da atribuicao)', () => {
    const role = resolveEffectiveRole('so-admin@x.com', 'student', 'so-admin@x.com', '');
    expect(allowed('getExternalActivityRaw', role)).toBe(true);
    expect(allowed('listExternalActivities', role)).toBe(true);
  });
});
