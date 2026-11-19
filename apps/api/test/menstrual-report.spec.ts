import { buildPhasedCycles } from '../src/menstrual-cycle/cycle-phases';
import { buildOverviewSentences, daysPerPhase, FORMAT_PACE, statsByPhase } from '../src/menstrual-cycle/cycle-phase-report';
import { MenstrualReportService, reportMonthKey } from '../src/menstrual-cycle/menstrual-report.service';
import { compactReportForAgent, WomanAgentService, WOMAN_HISTORY_MAX_CHARS } from '../src/menstrual-cycle/woman-agent.service';
import { CYCLE_AI_CONSENT_VERSION, cycleAiConsentHash } from '../src/menstrual-cycle/menstrual-ai-consent';

// 19/11/2026 (Elton): relatorio do ciclo por fase, so' a pedido, um por mes, com o Agente da Mulher.
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const cycles = buildPhasedCycles([{ start: d('2026-10-01'), end: d('2026-10-05') }, { start: d('2026-10-29'), end: d('2026-11-02') }], null);

describe('parte pura do relatorio por fase', () => {
  it('separa os registros por fase e calcula media e contagem', () => {
    const items = [
      { timestamp: d('2026-10-02'), value: 4 }, { timestamp: d('2026-10-03'), value: 2 }, // menstrual
      { timestamp: d('2026-10-10'), value: 3 }, // folicular
      { timestamp: d('2026-09-01'), value: 9 }, // antes do primeiro ciclo: fora
    ];
    const stats = statsByPhase(items, cycles, null);
    expect(stats.menstruacao).toEqual({ n: 2, mean: 3 });
    expect(stats.folicular).toEqual({ n: 1, mean: 3 });
    expect(stats.lutea).toEqual({ n: 0, mean: null });
  });

  it('dias observados por fase somam os dias dentro dos ciclos', () => {
    const days = daysPerPhase(cycles, d('2026-10-01'), d('2026-11-10'));
    expect(Object.values(days).reduce((sum, value) => sum + value, 0)).toBeGreaterThan(30);
    expect(days.menstruacao).toBeGreaterThanOrEqual(10);
  });

  it('quadro geral so compara fases com 3 ou mais registros e nunca afirma causa', () => {
    const stats = (menstruacao: number, lutea: number, n = 3) => ({ menstruacao: { n, mean: menstruacao }, folicular: { n: 0, mean: null }, ovulatoria: { n: 0, mean: null }, lutea: { n, mean: lutea } });
    const sentences = buildOverviewSentences([{ id: 'x', label: 'Esforço percebido', unit: '', stats: stats(3, 4) }]);
    expect(sentences[0]).toContain('mais alta na fase lútea');
    expect(sentences[0]).toContain('no que você registrou');
    expect(sentences[0]).not.toMatch(/causa|por causa|devido/i);
    expect(buildOverviewSentences([{ id: 'x', label: 'Esforço', unit: '', stats: stats(3, 4, 2) }])).toEqual([]); // poucos registros
    expect(buildOverviewSentences([{ id: 'x', label: 'Esforço', unit: '', stats: stats(3, 3) }])).toEqual([]); // sem diferenca
    expect(FORMAT_PACE(345)).toBe('5:45/km');
    expect(FORMAT_PACE(null)).toBeNull();
  });

  it('chave do mes usa o fuso de Sao Paulo', () => {
    expect(reportMonthKey(new Date('2026-12-01T02:00:00Z'))).toBe('2026-11'); // 23h de 30/11 em SP
    expect(reportMonthKey(new Date('2026-12-01T12:00:00Z'))).toBe('2026-12');
  });
});

function fakeReportService(options: { existing?: boolean; cycleLogs?: Array<{ cycleStartDate: Date; cycleEndDate: Date | null }>; agent?: { narrate: jest.Mock } } = {}) {
  const created: Array<Record<string, unknown>> = [];
  const prisma = {
    menstrualReport: {
      findUnique: jest.fn().mockResolvedValue(options.existing ? { id: 'r0', monthKey: '2026-11', createdAt: new Date(), narrative: 'antigo', payload: {} } : null),
      findFirst: jest.fn().mockResolvedValue({ id: 'r1', monthKey: '2026-11', createdAt: new Date(), narrative: 'texto', payload: {} }),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { created.push(data); return { id: 'r1' }; }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    menstrualProfile: { findUnique: jest.fn().mockResolvedValue(null) },
    menstrualCycleLog: { findMany: jest.fn().mockResolvedValue(options.cycleLogs ?? [{ cycleStartDate: d('2026-10-01'), cycleEndDate: d('2026-10-05') }]) },
    workoutCompletion: { findMany: jest.fn().mockResolvedValue([{ status: 'done', distanceKm: 8, painFlag: 'leve', session: { scheduledDate: d('2026-10-10'), modality: 'corrida' } }, { status: 'missed', distanceKm: null, painFlag: null, session: { scheduledDate: d('2026-10-12'), modality: 'corrida' } }]) },
    painReport: { findMany: jest.fn().mockResolvedValue([{ createdAt: d('2026-10-03'), intensity: 6 }]) },
  };
  const reader = { getObservations: jest.fn().mockResolvedValue([]) };
  return { service: new MenstrualReportService(prisma as never, reader as never, options.agent as never), prisma, created };
}

describe('pedido do relatorio mensal', () => {
  const now = new Date('2026-11-19T15:00:00Z');
  it('monta treinos, aderencia, km e dor por fase', async () => {
    const { service } = fakeReportService();
    const payload = await service.buildPayload('u1', now);
    const follicular = payload.phases.find((phase) => phase.id === 'folicular')!;
    expect(follicular.workouts).toEqual({ done: 1, missed: 1, adherencePct: 50, km: 8 });
    expect(follicular.pain).toMatchObject({ workoutsWithPain: 1, meanLevel: 1 });
    expect(payload.phases.find((phase) => phase.id === 'menstruacao')!.pain).toMatchObject({ standaloneReports: 1, standaloneMeanIntensity: 6 });
    expect(payload.limitations.join(' ')).toContain('padrão de 28 dias');
  });

  it('um por mes: se ja existe, devolve o do mes sem gerar nem chamar a IA de novo', async () => {
    const agent = { narrate: jest.fn() };
    const { service, created } = fakeReportService({ existing: true, agent });
    const out = await service.request('u1', now);
    expect(out.alreadyGenerated).toBe(true);
    expect(created).toHaveLength(0);
    expect(agent.narrate).not.toHaveBeenCalled();
  });

  it('sem nenhum ciclo registrado: pede para registrar, nada e gravado', async () => {
    const { service, created } = fakeReportService({ cycleLogs: [] });
    await expect(service.request('u1', now)).rejects.toMatchObject({ response: { code: 'no_cycles' } });
    expect(created).toHaveLength(0);
  });

  it('falha do Agente da Mulher nao impede o relatorio: sai so com os numeros', async () => {
    const agent = { narrate: jest.fn().mockRejectedValue(new Error('IA fora')) };
    const { service, created } = fakeReportService({ agent });
    const out = await service.request('u1', now);
    expect(out.alreadyGenerated).toBe(false);
    expect(created[0]).toMatchObject({ userId: 'u1', monthKey: '2026-11', narrative: null, agentStatus: 'failed' });
  });

  it('com o agente: grava o texto', async () => {
    const agent = { narrate: jest.fn().mockResolvedValue({ narrative: 'Resumo do mês', history: 'h' }) };
    const { service, created } = fakeReportService({ agent });
    await service.request('u1', now);
    expect(created[0]).toMatchObject({ narrative: 'Resumo do mês', agentStatus: 'ok' });
  });
});

describe('Agente da Mulher', () => {
  it('sem aceite vigente do ciclo para a IA nada e enviado', async () => {
    const prisma = { menstrualAiConsent: { findUnique: jest.fn().mockResolvedValue(null) } };
    const agent = new WomanAgentService({ get: () => 'chave' } as never, { run: jest.fn() } as never, prisma as never);
    const payload = await fakeReportService().service.buildPayload('u1', new Date('2026-11-19T15:00:00Z'));
    expect(await agent.narrate('u1', payload, '2026-11')).toBeNull();
  });

  it('o que vai a IA e compacto, sem relato livre e com a regra dos 6 mil caracteres', async () => {
    const payload = await fakeReportService().service.buildPayload('u1', new Date('2026-11-19T15:00:00Z'));
    const compact = JSON.stringify(compactReportForAgent(payload));
    expect(compact).toContain('limitacoes');
    expect(compact).not.toContain('notes');
    expect(WOMAN_HISTORY_MAX_CHARS).toBe(6000);
  });

  it('com aceite vigente: grava o historico (cortado no teto) e devolve o texto', async () => {
    const consent = { version: CYCLE_AI_CONSENT_VERSION, textHash: cycleAiConsentHash(), acceptedAt: new Date(), revokedAt: null };
    const upsert = jest.fn().mockResolvedValue({});
    const prisma = {
      menstrualAiConsent: { findUnique: jest.fn().mockResolvedValue(consent) },
      menstrualHistorySummary: { findUnique: jest.fn().mockResolvedValue(null), upsert },
      menstrualDailyLog: { findMany: jest.fn().mockResolvedValue([{ date: d('2026-11-10'), notes: 'Dor forte no primeiro dia', symptoms: ['inchaco'] }]) },
    };
    const agent = new WomanAgentService({ get: () => 'chave' } as never, { run: jest.fn() } as never, prisma as never);
    const calls: unknown[] = [];
    (agent as unknown as { request: (input: unknown) => Promise<unknown> }).request = async (input) => { calls.push(input); return { narrative: 'Texto', history: 'x'.repeat(4000) }; };
    const payload = await fakeReportService().service.buildPayload('u1', new Date('2026-11-19T15:00:00Z'));
    const out = await agent.narrate('u1', payload, '2026-11');
    expect(out?.narrative).toBe('Texto');
    expect(upsert.mock.calls[0][0].update.chars).toBe(4000);
    expect(JSON.stringify(calls[0])).toContain('Dor forte no primeiro dia');
  });
});
