import { addMonths, buildMonthlyReport, deltaText, fmtDuration, fmtKm, fmtPace, hasAnyActivity, isMonthKey, monthLabelOf, optOutToken, previousMonthKey, renderMonthlyReportHtml, renderMonthlyReportText, reportSubject, verifyOptOutToken, ReportActivity } from '../src/monthly-report/monthly-report';
import { MonthlyReportCoachController, MonthlyReportPublicController, MonthlyReportScheduler, MonthlyReportService } from '../src/monthly-report/monthly-report.service';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// 09/11/2026 — Relatorio mensal por e-mail. Calculo puro, textos, descadastro e envio (banco e e-mail simulados).
const run = (localDate: string, km: number, min: number, kcal = 500): ReportActivity => ({ localDate, isRun: true, distanceMeters: km * 1000, durationSec: min * 60, caloriesKcal: kcal });
const other = (localDate: string, min: number): ReportActivity => ({ localDate, isRun: false, distanceMeters: null, durationSec: min * 60, caloriesKcal: null });
const links = { appUrl: 'https://app.example', unsubscribeUrl: 'https://api.example/monthly-report/unsubscribe?u=1&t=abc' };

describe('meses', () => {
  it('mes anterior no calendario de Sao Paulo (UTC-3), inclusive na virada do ano', () => {
    expect(previousMonthKey(new Date('2026-11-01T12:00:00Z'))).toBe('2026-10');
    expect(previousMonthKey(new Date('2026-11-01T01:00:00Z'))).toBe('2026-09'); // 31/10 22h em SP: o mes local ainda e outubro, entao o anterior e setembro
    expect(previousMonthKey(new Date('2027-01-01T12:00:00Z'))).toBe('2026-12');
  });
  it('janeiro volta para dezembro do ano anterior; rotulos em portugues; validacao', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(monthLabelOf('2026-03')).toBe('março de 2026');
    expect(isMonthKey('2026-10')).toBe(true);
    expect(isMonthKey('2026-13')).toBe(false);
    expect(isMonthKey('2026-1')).toBe(false);
    expect(isMonthKey(undefined)).toBe(false);
  });
});

describe('calculo do relatorio', () => {
  const activities = [
    run('2026-10-02', 10, 55, 600), run('2026-10-15', 5, 28, 300), other('2026-10-20', 45),
    run('2026-09-05', 8, 48, 480), other('2026-09-10', 30), run('2026-08-30', 20, 100), // agosto fica fora (so' mes e mes anterior)
  ];
  const data = buildMonthlyReport(activities, '2026-10', 'Ana', []);
  it('resumo do mes e do mes anterior', () => {
    expect(data.overall.current).toEqual({ activities: 3, durationSec: (55 + 28 + 45) * 60, caloriesKcal: 900 });
    expect(data.overall.previous).toEqual({ activities: 2, durationSec: (48 + 30) * 60, caloriesKcal: 480 });
  });
  it('corrida: distancia, tempo e pace medio; outras modalidades separadas', () => {
    expect(data.running.current).toMatchObject({ activities: 2, distanceMeters: 15000, durationSec: 83 * 60, paceSecondsKm: Math.round((83 * 60) / 15) });
    expect(data.running.previous.activities).toBe(1);
    expect(data.other.current).toMatchObject({ activities: 1, durationSec: 45 * 60 });
  });
  it('quem nao treinou nada no mes nao recebe nada (mesmo tendo treinado no mes anterior)', () => {
    const empty = buildMonthlyReport([run('2026-09-05', 8, 48)], '2026-10', 'Ana', []);
    expect(hasAnyActivity(empty)).toBe(false);
    expect(hasAnyActivity(data)).toBe(true);
  });
  it('novas melhores marcas: so as que aconteceram no mes', () => {
    const withMarks = buildMonthlyReport(activities, '2026-10', 'Ana', [
      { label: '10 km', seconds: 3300, paceSecondsKm: 330, localDate: '2026-10-02' },
      { label: '5 km', seconds: 1500, paceSecondsKm: 300, localDate: '2026-07-01' },
    ]);
    expect(withMarks.newMarks.map((m) => m.label)).toEqual(['10 km']);
  });
});

describe('textos neutros em portugues', () => {
  it('formatacao', () => {
    expect(fmtDuration(8 * 3600 + 41 * 60)).toBe('8h41');
    expect(fmtKm(48580)).toBe('48,58 km');
    expect(fmtPace(326)).toBe('5:26 /km');
  });
  it('variacao: mais/menos/igual/sem comparacao (sem julgar)', () => {
    expect(deltaText(10, 8, String, true)).toBe('▲ 2 a mais que no mês anterior');
    expect(deltaText(6, 8, String, true)).toBe('▼ 2 a menos que no mês anterior');
    expect(deltaText(8, 8, String, true)).toBe('igual ao mês anterior');
    expect(deltaText(8, 0, String, false)).toBe('sem comparação com o mês anterior');
  });
  it('e-mail em HTML e texto: saudacao, blocos, link do app e de descadastro; nada de saude ou termos proibidos', () => {
    const data = buildMonthlyReport([run('2026-10-02', 10, 55), other('2026-10-20', 45)], '2026-10', 'Ana <b>', [{ label: '10 km', seconds: 3300, paceSecondsKm: 330, localDate: '2026-10-02' }]);
    const html = renderMonthlyReportHtml(data, links);
    const text = renderMonthlyReportText(data, links);
    expect(reportSubject(data)).toBe('Seu mês no Panzeri Run: outubro de 2026');
    expect(html).toContain('Oi, Ana &lt;b&gt;!'); // nome escapado
    expect(html).toContain('Resumo do mês');
    expect(html).toContain('Novas melhores marcas');
    expect(html).toContain(links.unsubscribeUrl.replace(/&/g, '&amp;')); // no HTML o & do endereco vai escapado
    expect(html).toContain(links.appUrl);
    expect(text).toContain('Corrida');
    expect(text).toContain(links.unsubscribeUrl);
    for (const content of [html, text]) {
      expect(content).not.toMatch(/motor|plano de treino|sono|dor |ciclo|Strava/i);
    }
  });
  it('sem corrida no mes o bloco Corrida nao aparece; sem outras modalidades tambem nao', () => {
    const data = buildMonthlyReport([other('2026-10-20', 45)], '2026-10', 'Ana', []);
    const html = renderMonthlyReportHtml(data, links);
    expect(html).not.toContain('>Corrida<');
    expect(html).toContain('Outras modalidades');
  });
});

describe('link de descadastro', () => {
  it('codigo assinado por aluna: vale so para ela e so com o mesmo segredo', () => {
    const token = optOutToken('segredo', 'u1');
    expect(verifyOptOutToken('segredo', 'u1', token)).toBe(true);
    expect(verifyOptOutToken('segredo', 'u2', token)).toBe(false);
    expect(verifyOptOutToken('outro', 'u1', token)).toBe(false);
    expect(verifyOptOutToken('segredo', 'u1', 'zz')).toBe(false);
    expect(verifyOptOutToken('segredo', 'u1', '')).toBe(false);
  });
});

function build(opts: { students?: Array<{ id: string }>; activities?: Record<string, Array<Record<string, unknown>>>; sentUsers?: string[]; sendOk?: boolean } = {}) {
  const students = opts.students ?? [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const activities = opts.activities ?? {
    a: [{ id: 'a1', startedAt: new Date('2026-10-10T10:00:00Z'), utcOffsetMinutes: -180, sport: 'corrida', distanceMeters: 10000, durationSec: 3300, caloriesKcal: 600, physicalIdentityStatus: null }],
    b: [], // nao treinou
    c: [{ id: 'c1', startedAt: new Date('2026-10-12T10:00:00Z'), utcOffsetMinutes: -180, sport: 'corrida', distanceMeters: 5000, durationSec: 1500, caloriesKcal: 300, physicalIdentityStatus: null }],
  };
  const prisma: any = {
    user: {
      findMany: jest.fn(async () => students),
      findUnique: jest.fn(async ({ where }: any) => ({ name: `Aluna ${where.id}`, email: `${where.id}@x.com` })),
      update: jest.fn(async () => ({})),
    },
    activityLog: { findMany: jest.fn(async ({ where }: any) => (where.id ? [] : activities[where.userId] ?? [])) },
    messageLog: { findFirst: jest.fn(async ({ where }: any) => ((opts.sentUsers ?? []).includes(where.userId) ? { id: 'x' } : null)) },
  };
  const messaging: any = { sendEmail: jest.fn(async () => ({ ok: opts.sendOk !== false })) };
  const bestMarks: any = { forUser: jest.fn(async () => ({ marks: [] })) };
  const config: any = { get: jest.fn((key: string) => (key === 'JWT_ACCESS_SECRET' ? 'segredo' : undefined)) };
  const service = new MonthlyReportService(prisma, messaging, bestMarks, config);
  return { service, prisma, messaging, config };
}

describe('MonthlyReportService', () => {
  it('seleciona so alunas ativas (paga/cortesia), fora de teste e de quem pediu para nao receber', async () => {
    const { service, prisma } = build();
    await service.eligibleStudentIds();
    expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({ role: 'student', accountStatus: 'active', isTestAccount: false, monthlyReportOptOut: false, subscriptionStatus: { in: ['active', 'manual_active', 'grace'] } });
  });
  it('envia so para quem treinou, nunca duas vezes o mesmo mes, e registra o gatilho do mes', async () => {
    const { service, messaging } = build({ sentUsers: ['c'] });
    const summary = await service.sendForMonth('2026-10');
    expect(summary).toMatchObject({ considered: 3, sent: 1, skippedNoActivity: 1, skippedAlreadySent: 1, failed: 0 });
    expect(messaging.sendEmail).toHaveBeenCalledTimes(1);
    const [userId, params] = messaging.sendEmail.mock.calls[0];
    expect(userId).toBe('a');
    expect(params.trigger).toBe('monthly_report:2026-10');
    expect(params.html).toContain('Seu mês de outubro de 2026');
    expect(params.headers['List-Unsubscribe']).toContain('/monthly-report/unsubscribe?u=a&t=');
  });
  it('simulacao (dryRun) nao envia nada', async () => {
    const { service, messaging } = build();
    const summary = await service.sendForMonth('2026-10', { dryRun: true });
    expect(summary).toMatchObject({ sent: 2, dryRun: true });
    expect(messaging.sendEmail).not.toHaveBeenCalled();
  });
  it('falha de envio e contada e nao derruba o lote', async () => {
    const { service } = build({ sendOk: false });
    const summary = await service.sendForMonth('2026-10');
    expect(summary).toMatchObject({ sent: 0, failed: 2 });
  });
  it('teste do treinador vai SO para o e-mail do treinador (id do treinador), com [TESTE] e link de descadastro que nao altera nada', async () => {
    const { service, messaging } = build();
    const result = await service.sendTestToCoach('coach-1', 'a', '2026-10');
    expect(result).toMatchObject({ sent: true, month: '2026-10' });
    const [userId, params] = messaging.sendEmail.mock.calls[0];
    expect(userId).toBe('coach-1');
    expect(params.subject.startsWith('[TESTE] ')).toBe(true);
    expect(params.trigger).toBe('monthly_report_test');
    expect(params.html).toContain('unsubscribe?preview=1');
    expect(params.html).not.toContain('&t=');
  });
  it('teste de aluna sem treino no mes e recusado com mensagem clara', async () => {
    const { service } = build();
    await expect(service.sendTestToCoach('coach-1', 'b', '2026-10')).rejects.toThrow('não treinou nesse mês');
  });
});

describe('descadastro e envio automatico', () => {
  it('link valido desliga, "on=1" religa, codigo invalido nao altera nada', async () => {
    const { service, prisma } = build();
    const controller = new MonthlyReportPublicController(service);
    const sent: string[] = [];
    const response = { type: () => ({ send: (html: string) => sent.push(html) }) };
    const token = optOutToken('segredo', 'a');
    await controller.unsubscribe('a', token, undefined, undefined, response);
    expect(prisma.user.update).toHaveBeenLastCalledWith({ where: { id: 'a' }, data: { monthlyReportOptOut: true } });
    expect(sent[0]).toContain('não vai mais receber');
    await controller.unsubscribe('a', token, '1', undefined, response);
    expect(prisma.user.update).toHaveBeenLastCalledWith({ where: { id: 'a' }, data: { monthlyReportOptOut: false } });
    prisma.user.update.mockClear();
    await controller.unsubscribe('a', 'invalido', undefined, undefined, response);
    await controller.unsubscribe(undefined, undefined, undefined, undefined, response);
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(sent[sent.length - 1]).toContain('Link inválido');
  });
  it('previa do link de descadastro nao altera nada', async () => {
    const { service, prisma } = build();
    const sent: string[] = [];
    await new MonthlyReportPublicController(service).unsubscribe(undefined, undefined, undefined, '1', { type: () => ({ send: (html: string) => sent.push(html) }) });
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(sent[0]).toContain('só um teste');
  });
  it('envio automatico fica DESLIGADO sem MONTHLY_REPORT_ENABLED=true', async () => {
    const off = build();
    const spyOff = jest.spyOn(off.service, 'sendForMonth');
    await new MonthlyReportScheduler(off.service, off.config).runMonthly();
    expect(spyOff).not.toHaveBeenCalled();
    const on = build();
    on.config.get = jest.fn((key: string) => (key === 'MONTHLY_REPORT_ENABLED' ? 'true' : undefined));
    const spyOn = jest.spyOn(on.service, 'sendForMonth').mockResolvedValue({ month: 'x', considered: 0, sent: 0, skippedNoActivity: 0, skippedAlreadySent: 0, failed: 0, dryRun: false });
    await new MonthlyReportScheduler(on.service, on.config).runMonthly();
    expect(spyOn).toHaveBeenCalledTimes(1);
  });
  it('agendamento: dia 1 as 9h de Sao Paulo; rotas do treinador so coach/admin (estatico)', () => {
    const source = readFileSync(join(__dirname, '..', 'src', 'monthly-report', 'monthly-report.service.ts'), 'utf8');
    expect(source).toContain("@Cron('0 9 1 * *', { timeZone: 'America/Sao_Paulo' })");
    expect(source).toContain("@Roles('coach', 'admin')");
    expect(new MonthlyReportCoachController({} as never)).toBeDefined();
  });
});
