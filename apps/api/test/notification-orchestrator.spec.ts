import { readFileSync } from 'fs';
import { join } from 'path';
import {
  bandMaxPerDay, decideNotification, defaultPreferences, localDayStartUtc, localHour, normalizePreferences, NOTIFICATION_BANDS, NOTIFICATION_CATEGORIES,
} from '../src/notifications/notification-policy';
import { NotificationOrchestratorService } from '../src/notifications/notification-orchestrator.service';

// 19/11/2026 (Elton): teto diario padrao de 36 = 6 temas x 6 (nao e meta), seis categorias, faixas de 1-2 / 3-4 / 5-6 por dia por categoria, janela 06:00 a 20:00, e a aluna gerencia tudo.
const at = (hourLocal: number) => new Date(Date.UTC(2026, 10, 19, hourLocal + 3, 0, 0)); // Sao Paulo = UTC-3

describe('politica de avisos proativos', () => {
  it('padroes: teto 36, janela 6 a 20, seis categorias ligadas na faixa 5 a 6', () => {
    const prefs = defaultPreferences();
    expect(prefs.dailyCap).toBe(36);
    expect([prefs.windowStartHour, prefs.windowEndHour]).toEqual([6, 20]);
    expect(NOTIFICATION_CATEGORIES.map((c) => c.id)).toEqual(['novidades', 'instrucoes', 'relatorios', 'saude', 'educacao_treino', 'mundo_corrida']);
    expect(NOTIFICATION_CATEGORIES.every((c) => prefs.categories[c.id].enabled && prefs.categories[c.id].band === '5-6')).toBe(true);
    expect(NOTIFICATION_BANDS.map((b) => b.id)).toEqual(['1-2', '3-4', '5-6']);
    expect(['1-2', '3-4', '5-6'].map((b) => bandMaxPerDay(b as never))).toEqual([2, 4, 6]);
  });

  it('o texto visivel diz Panzeri Run, nunca "app"', () => {
    expect(JSON.stringify(NOTIFICATION_CATEGORIES).toLowerCase()).not.toMatch(/\bapp\b/);
  });

  it('normaliza qualquer entrada: lixo cai no padrao, teto nunca passa de 36, horas invertidas voltam ao padrao', () => {
    expect(normalizePreferences(null)).toEqual(defaultPreferences());
    expect(normalizePreferences('x')).toEqual(defaultPreferences());
    expect(normalizePreferences({ dailyCap: 999 }).dailyCap).toBe(36);
    expect(normalizePreferences({ dailyCap: -4 }).dailyCap).toBe(0);
    expect(normalizePreferences({ dailyCap: 7.5 }).dailyCap).toBe(36);
    const swapped = normalizePreferences({ windowStartHour: 22, windowEndHour: 8 });
    expect([swapped.windowStartHour, swapped.windowEndHour]).toEqual([6, 20]);
    const custom = normalizePreferences({ windowStartHour: 8, windowEndHour: 22, categories: { saude: { enabled: false, band: '5-6' }, inventada: { enabled: false }, relatorios: { band: 'xx' } } });
    expect([custom.windowStartHour, custom.windowEndHour]).toEqual([8, 22]);
    expect(custom.categories.saude).toEqual({ enabled: false, band: '5-6' });
    expect(custom.categories.relatorios).toEqual({ enabled: true, band: '5-6' });
    expect(Object.keys(custom.categories)).toHaveLength(6);
  });

  it('hora e dia local de Sao Paulo', () => {
    expect(localHour(new Date('2026-11-19T09:30:00Z'))).toBe(6);
    expect(localHour(new Date('2026-11-19T02:59:00Z'))).toBe(23); // 23:59 do dia 18 em SP
    expect(localDayStartUtc(new Date('2026-11-19T15:00:00Z')).toISOString()).toBe('2026-11-19T03:00:00.000Z');
    expect(localDayStartUtc(new Date('2026-11-19T02:00:00Z')).toISOString()).toBe('2026-11-18T03:00:00.000Z');
  });

  it('decisao: dentro da janela e dos limites envia; cada limite barra com o motivo certo', () => {
    const prefs = defaultPreferences();
    const base = { prefs, category: 'educacao_treino', now: at(10), sentTodayTotal: 0, sentTodayInCategory: 0 };
    expect(decideNotification(base)).toEqual({ allow: true });
    expect(decideNotification({ ...base, category: 'nao_existe' })).toEqual({ allow: false, reason: 'unknown_category' });
    expect(decideNotification({ ...base, now: at(5) })).toEqual({ allow: false, reason: 'outside_window' });
    expect(decideNotification({ ...base, now: at(20) })).toEqual({ allow: false, reason: 'outside_window' });
    expect(decideNotification({ ...base, now: at(19) })).toEqual({ allow: true });
    expect(decideNotification({ ...base, sentTodayInCategory: 6 })).toEqual({ allow: false, reason: 'category_cap' });
    const narrow = normalizePreferences({ categories: { educacao_treino: { enabled: true, band: '1-2' } } });
    expect(decideNotification({ ...base, prefs: narrow, sentTodayInCategory: 2 })).toEqual({ allow: false, reason: 'category_cap' });
    expect(decideNotification({ ...base, sentTodayTotal: 36 })).toEqual({ allow: false, reason: 'daily_cap' });
    const off = normalizePreferences({ categories: { educacao_treino: { enabled: false, band: '1-2' } } });
    expect(decideNotification({ ...base, prefs: off })).toEqual({ allow: false, reason: 'category_off' });
    const wide = normalizePreferences({ categories: { educacao_treino: { enabled: true, band: '5-6' } } });
    expect(decideNotification({ ...base, prefs: wide, sentTodayInCategory: 5 })).toEqual({ allow: true });
    expect(decideNotification({ ...base, prefs: wide, sentTodayInCategory: 6 })).toEqual({ allow: false, reason: 'category_cap' });
  });
});

function fakeOrchestrator(options: { stored?: unknown; sent?: Array<{ category: string }>; created?: boolean } = {}) {
  const logs: Array<Record<string, unknown>> = [];
  const sentRows = options.sent ?? [];
  const prisma = {
    notificationPreference: { findUnique: jest.fn().mockResolvedValue(options.stored ?? null), upsert: jest.fn().mockResolvedValue({}) },
    notificationSendLog: {
      count: jest.fn().mockImplementation(({ where }: { where: { category?: string } }) => Promise.resolve(where.category ? sentRows.filter((row) => row.category === where.category).length : sentRows.length)),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => { logs.push(data); return Promise.resolve(data); }),
    },
  };
  const notifications = { notifyUserIfNotRecent: jest.fn().mockResolvedValue(options.created ?? true) };
  const service = new NotificationOrchestratorService(prisma as never, notifications as never);
  return { service, prisma, notifications, logs };
}

describe('orquestrador de avisos proativos', () => {
  const rule = { ruleId: 'dica_hidratacao', category: 'saude', title: 'Dica', message: 'Beba agua', now: at(10) };

  it('envia, registra "sent" e usa o servico de avisos (sino + push)', async () => {
    const { service, notifications, logs } = fakeOrchestrator();
    expect(await service.dispatch('u1', rule)).toEqual({ sent: true });
    expect(notifications.notifyUserIfNotRecent).toHaveBeenCalledTimes(1);
    expect(logs).toEqual([{ userId: 'u1', category: 'saude', ruleId: 'dica_hidratacao', status: 'sent', reason: null }]);
  });

  it('barra fora do horario SEM chamar o servico de avisos e registra o motivo', async () => {
    const { service, notifications, logs } = fakeOrchestrator();
    expect(await service.dispatch('u1', { ...rule, now: at(3) })).toEqual({ sent: false, reason: 'outside_window' });
    expect(notifications.notifyUserIfNotRecent).not.toHaveBeenCalled();
    expect(logs[0]).toMatchObject({ status: 'blocked', reason: 'outside_window' });
  });

  it('respeita a preferencia da aluna: categoria desligada nao envia', async () => {
    const stored = { dailyCap: 36, windowStartHour: 6, windowEndHour: 20, categories: { saude: { enabled: false, band: '1-2' } } };
    const { service, notifications } = fakeOrchestrator({ stored });
    expect(await service.dispatch('u1', rule)).toEqual({ sent: false, reason: 'category_off' });
    expect(notifications.notifyUserIfNotRecent).not.toHaveBeenCalled();
  });

  it('limite da faixa na categoria e teto diario total', async () => {
    const two = fakeOrchestrator({ sent: Array.from({ length: 6 }, () => ({ category: 'saude' })) });
    expect(await two.service.dispatch('u1', rule)).toEqual({ sent: false, reason: 'category_cap' });
    const twenty = fakeOrchestrator({ sent: Array.from({ length: 36 }, () => ({ category: 'novidades' })) });
    expect(await twenty.service.dispatch('u1', rule)).toEqual({ sent: false, reason: 'daily_cap' });
  });

  it('o mesmo evento nao avisa duas vezes: duplicata registrada como barrada', async () => {
    const { service, logs } = fakeOrchestrator({ created: false });
    expect(await service.dispatch('u1', rule)).toEqual({ sent: false, reason: 'duplicate' });
    expect(logs[0]).toMatchObject({ status: 'blocked', reason: 'duplicate' });
  });

  it('nunca lanca: falha interna vira { sent:false, reason:"error" }', async () => {
    const { service, prisma } = fakeOrchestrator();
    prisma.notificationPreference.findUnique.mockRejectedValue(new Error('banco fora'));
    expect(await service.dispatch('u1', rule)).toEqual({ sent: false, reason: 'error' });
  });

  it('salvar preferencias grava o valor JA normalizado e devolve o que gravou', async () => {
    const { service, prisma } = fakeOrchestrator();
    const saved = await service.savePreferences('u1', { dailyCap: 500, windowStartHour: 7, windowEndHour: 21, categories: { saude: { enabled: false, band: '3-4' } } });
    expect(saved.dailyCap).toBe(36);
    const call = prisma.notificationPreference.upsert.mock.calls[0][0];
    expect(call.update).toMatchObject({ dailyCap: 36, windowStartHour: 7, windowEndHour: 21 });
    expect(call.update.categories.saude).toEqual({ enabled: false, band: '3-4' });
  });
});

describe('ligacao (esquema, migracao, exclusao de conta, modulo)', () => {
  const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');
  it('tabelas novas no esquema e na migracao aditiva, e entram na exclusao de conta', () => {
    const schema = read('prisma', 'schema.prisma');
    expect(schema).toContain('model NotificationPreference {');
    expect(schema).toContain('model NotificationSendLog {');
    const sql = read('prisma', 'migrations', '20261119120000_notification_preferences', 'migration.sql');
    expect(sql).toContain('CREATE TABLE "NotificationPreference"');
    expect(sql).toContain('CREATE TABLE "NotificationSendLog"');
    expect(sql).not.toMatch(/DROP |ALTER TABLE "(?!Notification)/i);
    const deletion = read('src', 'account-deletion', 'account-deletion.service.ts');
    expect(deletion).toContain("'notificationPreference'");
    expect(deletion).toContain("'notificationSendLog'");
  });
  it('o modulo expoe a rota da tela e exporta o orquestrador', () => {
    const module = read('src', 'notifications', 'notifications.module.ts');
    expect(module).toContain('NotificationPreferencesController');
    expect(module).toContain('exports: [NotificationsService, NotificationOrchestratorService]');
    expect(read('src', 'notifications', 'notification-preferences.controller.ts')).toContain("@Controller('me/notification-preferences')");
  });
});

describe('tela de preferencias de notificacao no Panzeri Run', () => {
  const read = (...p: string[]) => readFileSync(join(__dirname, '..', '..', 'mobile', ...p), 'utf8');
  it('esta no menu, abre a tela e a tela usa a rota do servidor com temas, faixas e padrao vindos de la', () => {
    const app = read('App.tsx');
    expect(app).toContain("{ id: 'notificationPreferences', label: 'Preferências de notificações'");
    expect(app).toContain("{activeTab === 'notificationPreferences' && <NotificationPreferencesScreen");
    const screen = read('src', 'notificationPreferences', 'NotificationPreferencesScreen.tsx');
    expect(screen).toContain('/me/notification-preferences');
    expect(screen).toContain("method: 'PUT'");
    expect(screen).toContain('data.categories.map');
    expect(screen).toContain('data.bands.map');
    expect(screen).toContain('setPrefs(data.defaults)');
    expect(screen.toLowerCase()).not.toMatch(/\bapp\b/); // texto visivel diz Panzeri Run
  });
});
