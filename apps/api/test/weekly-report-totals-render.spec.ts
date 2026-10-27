import { renderWeeklyReport, WeeklyExecutionIndicators } from '../src/activity-execution/execution-report';
import { buildWeeklyRealizedTotals, TotalsActivityInput, TotalsSessionInput } from '../src/activity-execution/weekly-realized-totals';

// Apresentacao dos totais ao aluno (lote 2, 26/10/2026): o relatorio sem extras sai EXATAMENTE como sempre saiu; relatorios antigos (sem o bloco totals) continuam legiveis.

const WEEK = '2026-10-19';
const base = (over: Partial<WeeklyExecutionIndicators> = {}): WeeklyExecutionIndicators => ({
  version: 1, weekStartDate: WEEK,
  overview: { prescribed: 3, performed: 3, notPerformed: 0, noRecord: 0, frequencyPct: 100, byModality: { corrida: { prescribed: 3, performed: 3 } } },
  strength: null,
  run: {
    prescribed: 3, performed: 3, prescribedKmAll: 35, prescribedKmPerformed: 35, realizedKm: 36.6, sessionsWithDistance: 3, intensityByRole: {}, sessionsWithBands: 0,
    structure: { intervalPrescribed: 0, classified: 0, scenarios: {} }, fidelity: { analyzable: 0, intensityWithin: 0, structureCompatible: 0 },
  },
  completeness: { sessionsWithoutData: 0, summaryOnly: 0, manualOnly: 0, notes: [] },
  sources: { sessionIds: ['s1', 's2', 's3'], activityLogIds: ['a1', 'a2', 'a3'], providers: ['polar'] },
  ...over,
});
const session = (over: Partial<TotalsSessionInput> & { sessionId: string }): TotalsSessionInput => ({ scheduledDate: '2026-10-20', modality: 'corrida', origin: 'agent', status: 'performed', ...over });
const activity = (over: Partial<TotalsActivityInput> & { activityLogId: string }): TotalsActivityInput => ({
  startedAt: new Date('2026-10-20T10:00:00Z'), utcOffsetMinutes: -180, sport: 'corrida', distanceKm: 10, durationMin: 60, classification: 'corresponding', provider: 'polar', ...over,
});
const caseTotals = (withExtra: boolean) => buildWeeklyRealizedTotals({
  weekStartDate: WEEK,
  sessions: [
    session({ sessionId: 's1', scheduledDate: '2026-10-20', plannedDistanceKm: 10, linkedActivityLogIds: ['a1'] }),
    session({ sessionId: 's2', scheduledDate: '2026-10-22', plannedDistanceKm: 10, linkedActivityLogIds: ['a2'] }),
    session({ sessionId: 's3', scheduledDate: '2026-10-25', plannedDistanceKm: 15, linkedActivityLogIds: ['a3'] }),
  ],
  activities: [
    activity({ activityLogId: 'a1', startedAt: new Date('2026-10-20T10:00:00Z'), distanceKm: 10.2, durationMin: 62 }),
    activity({ activityLogId: 'a2', startedAt: new Date('2026-10-22T10:00:00Z'), distanceKm: 10.4, durationMin: 64 }),
    activity({ activityLogId: 'a3', startedAt: new Date('2026-10-25T10:00:00Z'), distanceKm: 16, durationMin: 100 }),
    ...(withExtra ? [activity({ activityLogId: 'a4', startedAt: new Date('2026-10-24T10:00:00Z'), distanceKm: 5, durationMin: 30, classification: 'alternative' as const })] : []),
  ],
});

describe('relatorio semanal — totais ao aluno', () => {
  const OLD_LINES = ['Você realizou os 3 treinos previstos: 3 de corrida.', 'Na corrida, 3 de 3 sessões. Percorreu 36,6 dos 35 km previstos.'];

  it('relatorio ANTIGO (sem o bloco totals) continua exatamente igual, inclusive depois de gravado e relido como JSON', () => {
    const old = base();
    expect(renderWeeklyReport(old)).toEqual(OLD_LINES);
    expect(renderWeeklyReport(JSON.parse(JSON.stringify(old)) as WeeklyExecutionIndicators)).toEqual(OLD_LINES);
    expect('totals' in old).toBe(false);
  });

  it('semana SEM extras: com o bloco totals o texto fica identico ao antigo', () => {
    expect(renderWeeklyReport(base({ totals: caseTotals(false) }))).toEqual(OLD_LINES);
  });

  it('semana COM extra: mantem as linhas da prescricao e acrescenta resumo por modalidade, a corrida extra individual e o total', () => {
    const lines = renderWeeklyReport(base({ totals: caseTotals(true) }));
    expect(lines.slice(0, 2)).toEqual(OLD_LINES);
    expect(lines).toContain('Além dos treinos previstos, você fez 1 atividade extra: 1 corrida.');
    expect(lines).toContain('Corrida extra em sáb 24/10: 5 km em 30 min.');
    expect(lines).toContain('Total da semana, somando treinos previstos e extras: 4 atividades — corrida: 4 (41,6 km em 4h16).');
    // o cumprimento NAO foi alterado pelo extra
    expect(lines[0]).toBe('Você realizou os 3 treinos previstos: 3 de corrida.');
  });

  it('o texto ao aluno nao usa as palavras proibidas', () => {
    const text = renderWeeklyReport(base({ totals: caseTotals(true) })).join(' ');
    expect(text).not.toMatch(/plano de treino|motor/i);
  });

  it('corrida extra sem distancia/duracao e outras modalidades: so mostra o que existe', () => {
    const totals = buildWeeklyRealizedTotals({
      weekStartDate: WEEK, sessions: [],
      activities: [
        activity({ activityLogId: 'r', classification: 'alternative', distanceKm: null, durationMin: null, startedAt: new Date('2026-10-21T10:00:00Z') }),
        activity({ activityLogId: 'n', sport: 'natacao', classification: 'alternative', distanceKm: 1.5, durationMin: 40, startedAt: new Date('2026-10-22T10:00:00Z') }),
      ],
    });
    const lines = renderWeeklyReport(base({ totals }));
    expect(lines).toContain('Além dos treinos previstos, você fez 2 atividades extras: 1 corrida, 1 natação.');
    expect(lines).toContain('Corrida extra em qua 21/10.');
    expect(lines.join(' ')).toContain('corrida: 1');
    expect(lines.join(' ')).toContain('natação: 1');
    expect(lines.join(' ')).toContain('sem distância registrada');
  });

  it('semana sem treino prescrito mas com extras: mantem o aviso e acrescenta os extras', () => {
    const totals = buildWeeklyRealizedTotals({ weekStartDate: WEEK, sessions: [], activities: [activity({ activityLogId: 'r', classification: 'alternative', distanceKm: 6, durationMin: 40 })] });
    const lines = renderWeeklyReport(base({ overview: { prescribed: 0, performed: 0, notPerformed: 0, noRecord: 0, frequencyPct: null, byModality: {} }, run: null, totals }));
    expect(lines[0]).toBe('Não havia treinos prescritos na semana anterior.');
    expect(lines.some((line) => line.startsWith('Corrida extra em'))).toBe(true);
    expect(renderWeeklyReport(base({ overview: { prescribed: 0, performed: 0, notPerformed: 0, noRecord: 0, frequencyPct: null, byModality: {} }, run: null }))).toEqual(['Não havia treinos prescritos na semana anterior.']);
  });
});

describe('relatorio semanal — atividade aguardando confirmacao do aluno', () => {
  it('a atividade pendente ja conta no total da semana e o texto pede a confirmacao (nem cumprimento, nem extra)', () => {
    const totals = buildWeeklyRealizedTotals({
      weekStartDate: WEEK, sessions: [session({ sessionId: 's1', status: 'not_performed', plannedDistanceKm: 12 })],
      activities: [activity({ activityLogId: 'p1', classification: 'ambiguous', distanceKm: 12, durationMin: 70, startedAt: new Date('2026-10-21T13:00:00Z') })],
    });
    expect(totals.total).toMatchObject({ events: 1, run: { events: 1, km: 12 } });
    expect(totals.prescription.performedSessions).toBe(0);
    expect(totals.extras.events).toHaveLength(0);
    const lines = renderWeeklyReport(base({ overview: { prescribed: 1, performed: 0, notPerformed: 1, noRecord: 0, frequencyPct: 0, byModality: { corrida: { prescribed: 1, performed: 0 } } }, run: null, totals }));
    expect(lines).toContain('1 atividade ainda está sem classificação definitiva (treino previsto ou extra; responda se o aplicativo perguntar) e já conta no total da semana: corrida em qua 21/10 (12 km em 1h10).');
    expect(lines.some((line) => line.startsWith('Total da semana, somando treinos previstos e extras e atividades a confirmar: 1 atividade'))).toBe(true);
    expect(lines.join(' ')).not.toMatch(/plano de treino|motor/i);
  });
});
