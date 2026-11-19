import { readFileSync } from 'fs';
import { join } from 'path';
import { categoriesForDay, LIBRARY_REPEAT_DAYS, nextTipFor, NOTIFICATION_LIBRARY } from '../src/notifications/notification-library';
import { NOTIFICATION_CATEGORIES } from '../src/notifications/notification-policy';
import { ProactiveNotificationsService } from '../src/notifications/proactive-notifications.service';

// 19/11/2026 (Elton): avisos educativos/de uso e relatorio semanal, sempre pelo orquestrador (respeita as preferencias da aluna); desligado por padrao.
const at = (hourLocal: number, day = 19) => new Date(Date.UTC(2026, 10, day, hourLocal + 3, 0, 0)); // Sao Paulo = UTC-3; 19/11/2026 e' quinta, 23/11 e' segunda

describe('biblioteca de avisos', () => {
  it('toda categoria tem aviso e todo texto segue a linguagem do Panzeri Run', () => {
    for (const category of NOTIFICATION_CATEGORIES) expect(NOTIFICATION_LIBRARY.some((tip) => tip.category === category.id)).toBe(true);
    const text = JSON.stringify(NOTIFICATION_LIBRARY).toLowerCase();
    expect(text).not.toMatch(/\bapp\b/);
    expect(text).not.toContain('plano de treino');
    expect(text).not.toContain('motor');
    expect(new Set(NOTIFICATION_LIBRARY.map((tip) => tip.id)).size).toBe(NOTIFICATION_LIBRARY.length);
  });

  it('proximo aviso da categoria que ainda nao foi enviado; esgotou = null', () => {
    const first = nextTipFor('saude', new Set())!;
    expect(first.category).toBe('saude');
    const second = nextTipFor('saude', new Set([`tip:${first.id}`]))!;
    expect(second.id).not.toBe(first.id);
    const all = new Set(NOTIFICATION_LIBRARY.filter((tip) => tip.category === 'saude').map((tip) => `tip:${tip.id}`));
    expect(nextTipFor('saude', all)).toBeNull();
    expect(nextTipFor('inexistente', new Set())).toBeNull();
    expect(LIBRARY_REPEAT_DAYS).toBe(90);
  });

  it('rodizio: duas categorias por dia, todas aparecem em tres dias seguidos', () => {
    const ids = NOTIFICATION_CATEGORIES.map((category) => category.id);
    const days = [0, 1, 2].flatMap((day) => categoriesForDay(ids, day));
    expect(new Set(days).size).toBe(6);
    expect(categoriesForDay(ids, 5)).toHaveLength(2);
    expect(categoriesForDay([], 3)).toEqual([]);
  });
});

function fakeService(options: { enabled?: boolean; students?: string[]; sentRuleIds?: string[] } = {}) {
  const dispatch = jest.fn().mockResolvedValue({ sent: true });
  const prisma = {
    user: { findMany: jest.fn().mockResolvedValue((options.students ?? ['u1']).map((id) => ({ id }))) },
    notificationSendLog: { findMany: jest.fn().mockResolvedValue((options.sentRuleIds ?? []).map((ruleId) => ({ ruleId }))) },
  };
  const config = { get: () => (options.enabled ? 'true' : undefined) };
  return { service: new ProactiveNotificationsService(prisma as never, { dispatch } as never, config as never), dispatch, prisma };
}

describe('envio diario', () => {
  it('desligado por padrao: o cron nao envia nada', async () => {
    const { service, dispatch } = fakeService();
    expect(service.isEnabled()).toBe(false);
    await service.dailyRun();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('envia no maximo dois avisos da biblioteca por aluna, pelo orquestrador, sem repetir o ja enviado', async () => {
    const first = nextTipFor(categoriesForDay(NOTIFICATION_CATEGORIES.map((c) => c.id), Math.floor((at(10).getTime() - 3 * 3_600_000) / 86_400_000))[0], new Set())!;
    const { service, dispatch } = fakeService({ sentRuleIds: [`tip:${first.id}`] });
    const result = await service.run(at(10)); // quinta-feira: sem aviso semanal
    expect(result).toEqual({ students: 1, sent: 2, blocked: 0 });
    const calls = dispatch.mock.calls.map((call) => call[1]);
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => String(call.ruleId).startsWith('tip:'))).toBe(true);
    expect(calls.some((call) => call.ruleId === `tip:${first.id}`)).toBe(false);
    expect(calls.every((call) => typeof call.externalRef === 'string' && call.externalRef.includes('2026-11-19'))).toBe(true);
  });

  it('na segunda-feira entra o aviso semanal de relatorios, com chave da semana', async () => {
    const { service, dispatch } = fakeService();
    await service.run(at(10, 23));
    const weekly = dispatch.mock.calls.map((call) => call[1]).find((call) => call.ruleId === 'report:weekly');
    expect(weekly).toMatchObject({ category: 'relatorios', externalRef: 'report:weekly:2026-11-23' });
  });

  it('falha em uma aluna nao derruba as demais', async () => {
    const { service, dispatch } = fakeService({ students: ['u1', 'u2'] });
    dispatch.mockRejectedValueOnce(new Error('boom'));
    const result = await service.run(at(10));
    expect(result.students).toBe(2);
    expect(result.sent).toBeGreaterThan(0);
  });

  it('ligacao: modulo, painel do treinador (so coach/admin) e tela de Ferramentas', () => {
    const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');
    expect(read('src', 'notifications', 'notifications.module.ts')).toContain('ProactiveNotificationsService');
    const controller = read('src', 'notifications', 'notification-log.controller.ts');
    expect(controller).toContain("@Roles('coach', 'admin')");
    expect(controller).toContain("@Controller('coach/notifications')");
    expect(readFileSync(join(__dirname, '..', '..', 'admin', 'app', 'page.tsx'), 'utf8')).toContain('<NotificationsLog apiUrl={API_URL} token={token} />');
  });
});
