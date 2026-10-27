import { buildWeeklyRealizedTotals, promptTotalsOf, TotalsActivityInput, TotalsSessionInput } from '../src/activity-execution/weekly-realized-totals';
import { EXECUTION_REPORT_INSTRUCTION } from '../src/training-plans/prescription-agent.service';
import { analyzeWeekInContext } from '../src/training-plans/training-analyst';

// Lote 3 (26/10/2026): representacao dos totais para o Prescritor e o Analista de Treinos. Sem chamada de IA; so' a forma dos dados e as instrucoes.

const WEEK = '2026-10-19';
const session = (over: Partial<TotalsSessionInput> & { sessionId: string }): TotalsSessionInput => ({ scheduledDate: '2026-10-20', modality: 'corrida', origin: 'agent', status: 'performed', ...over });
const activity = (over: Partial<TotalsActivityInput> & { activityLogId: string }): TotalsActivityInput => ({
  startedAt: new Date('2026-10-20T10:00:00Z'), utcOffsetMinutes: -180, sport: 'corrida', distanceKm: 10, durationMin: 60, classification: 'corresponding', provider: 'polar', ...over,
});

function caseTotals() {
  return buildWeeklyRealizedTotals({
    weekStartDate: WEEK,
    sessions: [
      session({ sessionId: 's1', scheduledDate: '2026-10-20', plannedDistanceKm: 10, linkedActivityLogIds: ['a1'], linkOrigins: { a1: 'automatic' } }),
      session({ sessionId: 's2', scheduledDate: '2026-10-22', plannedDistanceKm: 10, linkedActivityLogIds: ['a2'], linkOrigins: { a2: 'student' } }),
      session({ sessionId: 's3', scheduledDate: '2026-10-25', plannedDistanceKm: 15, linkedActivityLogIds: ['a3'], linkOrigins: { a3: 'automatic' } }),
      session({ sessionId: 'x2', scheduledDate: '2026-10-23', modality: 'forca', origin: 'student_extra', completionDurationMin: 50, perceivedEffort: 7, completionAvgHeartRate: 118, completionMaxHeartRate: 150 }),
    ],
    activities: [
      activity({ activityLogId: 'a1', startedAt: new Date('2026-10-20T10:00:00Z'), distanceKm: 10.2, durationMin: 62 }),
      activity({ activityLogId: 'a2', startedAt: new Date('2026-10-22T10:00:00Z'), distanceKm: 10.4, durationMin: 64 }),
      activity({ activityLogId: 'a3', startedAt: new Date('2026-10-25T10:00:00Z'), distanceKm: 16, durationMin: 100 }),
      activity({ activityLogId: 'a4', provider: 'wahoo', startedAt: new Date('2026-10-24T10:00:00Z'), distanceKm: 5, durationMin: 30, classification: 'alternative', avgHeartRateBpm: 152, maxHeartRateBpm: 171, powerAvgWatts: 210, elevationGainMeters: 38.4, caloriesKcal: 320, cadenceAvg: 168 }),
    ],
  });
}

describe('totais da semana na visao de IA', () => {
  it('as medidas disponiveis de cada atividade extra sao preservadas (modalidade, distancia, duracao, FC, potencia, elevacao, cadencia, calorias, esforco percebido)', () => {
    const totals = caseTotals();
    const run = totals.extras.events.find((e) => e.modality === 'corrida')!;
    expect(run.measures).toEqual({ avgHeartRateBpm: 152, maxHeartRateBpm: 171, powerAvgWatts: 210, elevationGainMeters: 38.4, caloriesKcal: 320, cadenceAvg: 168 });
    const strength = totals.extras.events.find((e) => e.modality === 'forca')!;
    expect(strength).toMatchObject({ origin: 'student_extra', durationMin: 50, perceivedEffort: 7, measures: expect.objectContaining({ avgHeartRateBpm: 118, maxHeartRateBpm: 150 }) });
  });

  it('o objeto enviado a IA tem os tres blocos separados, os mesmos numeros dos totais e nenhum id de fonte nem nome de provedor', () => {
    const totals = caseTotals();
    const prompt = promptTotalsOf(totals) as { prescricao: Record<string, unknown>; extras: { atividades: number; detalhe: Array<Record<string, unknown>> }; totalRealizado: { atividades: number; corrida: Record<string, number> } };
    expect(prompt.prescricao).toMatchObject({ sessoesPrevistas: 3, sessoesCumpridas: 3, kmDeCorridaPrevistos: 35, kmDeCorridaExecutadosNasPrescritas: 36.6 });
    expect(prompt.extras.atividades).toBe(2);
    expect(prompt.totalRealizado).toMatchObject({ atividades: 5, corrida: { atividades: 4, km: 41.6, minutos: 256 } });
    const run = prompt.extras.detalhe.find((d) => d.modalidade === 'corrida')!;
    expect(run).toMatchObject({ data: '2026-10-24', origem: 'somente_atividade', distanciaKm: 5, duracaoMin: 30, fcMediaBpm: 152, fcMaximaBpm: 171, potenciaMediaW: 210, ganhoDeElevacaoM: 38, cadenciaMedia: 168, caloriasKcal: 320 });
    expect(prompt.extras.detalhe.find((d) => d.modalidade === 'forca')).toMatchObject({ origem: 'student_extra', duracaoMin: 50, esforcoPercebido: 7 });
    const json = JSON.stringify(prompt);
    for (const forbidden of ['a1', 'a2', 'a3', 'a4', 'wahoo', 'polar', 'activityLogId', 'sessionId', 'provider']) expect(json).not.toContain(`"${forbidden}"`);
    expect(json).not.toMatch(/wahoo|polar|strava/i);
    expect(json).not.toContain('null'); // ausencia nao vira zero nem null: o campo some
  });

  it('procedencia do cumprimento: vinculo automatico x confirmado por humano, com o aviso de que automatico nao prova intensidade, estrutura nem objetivo', () => {
    const prompt = promptTotalsOf(caseTotals()) as { prescricao: { origemDoCumprimento: Record<string, number>; avisoSobreVinculo: string } };
    expect(prompt.prescricao.origemDoCumprimento).toEqual({ vinculoAutomaticoDoSistema: 2, vinculoConfirmadoPorAlunoOuTreinador: 1, registroManualSemAtividade: 0, classificadaComoCorrespondenteSemSessaoNaSelecao: 0 });
    expect(prompt.prescricao.avisoSobreVinculo).toMatch(/NAO e prova de que a intensidade, a estrutura ou o objetivo/);
  });

  it('a instrucao do Prescritor distingue cumprimento x extras x total, trata extra como exposicao adicional e nao como determinante, e rebaixa o vinculo automatico', () => {
    const text = EXECUTION_REPORT_INSTRUCTION;
    expect(text).toContain('CUMPRIMENTO DA PRESCRICAO');
    expect(text).toContain('ATIVIDADES EXTRAS');
    expect(text).toContain('TOTAL REALIZADO');
    expect(text).toMatch(/Cumprir a prescricao e diferente de ter o volume total executado/);
    expect(text).toMatch(/EXPOSICAO ADICIONAL ao treinamento; ela NAO determina, isoladamente, fadiga, recuperacao nem necessidade de alterar a carga/);
    expect(text).toMatch(/nao ha formula/);
    expect(text).toMatch(/vinculoAutomaticoDoSistema e so a associacao feita pelo sistema por dia e modalidade; NAO e prova de que a intensidade, a estrutura ou o objetivo do treino foram cumpridos/);
    expect(text).toMatch(/nao some a distancia das extras ao cumprimento/);
    // regras permanentes do projeto
    expect(text).not.toMatch(/plano de treino|motor/i);
  });
});

describe('Analista de Treinos com os totais da semana', () => {
  it('inclui o total realizado, a origem do cumprimento e as extras com suas medidas — inclusive corrida extra sem sessao no calendario', () => {
    const totals = caseTotals();
    const contract = analyzeWeekInContext({
      weekStart: WEEK, indicators: null, rows: [], previousWeeks: [], trends: [], feedbackBySession: new Map(), realized: totals,
      otherActivities: [{ modality: 'forca', count: 1, minutes: 50 }],
    });
    const byCode = (list: typeof contract.facts, code: string) => list.find((f) => f.code === code);
    expect(byCode(contract.facts, 'total_realizado_da_semana')!.statement).toMatch(/5 atividade\(s\).*corrida: 4 atividade\(s\), 41,6 km, 256 min.*cumprimento da prescrição \(3 de 3 sessões\) é medido só sobre as sessões prescritas/);
    expect(byCode(contract.facts, 'origem_do_cumprimento')!.statement).toMatch(/2 por vínculo automático do sistema \(.*não comprova intensidade, estrutura nem objetivo do treino\), 1 confirmado\(s\) pelo aluno ou pelo treinador/);
    const extras = byCode(contract.findings, 'atividades_sem_prescricao')!;
    expect(extras.statement).toContain('exposição adicional ao treinamento que não determina, isoladamente, fadiga, recuperação nem necessidade de alterar a carga');
    expect(extras.statement).toContain('FC média 152 bpm');
    expect(extras.statement).toContain('FC máxima 171 bpm');
    expect(extras.statement).toContain('potência média 210 W');
    expect(extras.statement).toContain('esforço percebido 7/10');
    expect(extras.data).toMatchObject({ count: 2, runCount: 1, runKm: 5 });
  });

  it('sem totais o contrato continua como antes (caminho anterior intacto)', () => {
    const contract = analyzeWeekInContext({ weekStart: WEEK, indicators: null, rows: [], previousWeeks: [], trends: [], feedbackBySession: new Map() });
    expect(contract.facts.map((f) => f.code)).not.toContain('total_realizado_da_semana');
    expect(contract.gaps[0]?.code).toBe('semana_sem_dados');
  });
});

describe('totais na visao de IA — atividade aguardando confirmacao do aluno', () => {
  it('chega ao Prescritor como bloco proprio (conta no total, nem cumprimento nem extra) e ao Analista como fato; a instrucao explica', () => {
    const totals = buildWeeklyRealizedTotals({
      weekStartDate: WEEK, sessions: [session({ sessionId: 's1', status: 'not_performed', plannedDistanceKm: 12 })],
      activities: [activity({ activityLogId: 'p1', provider: 'polar', classification: 'ambiguous', distanceKm: 12, durationMin: 70, avgHeartRateBpm: 151, startedAt: new Date('2026-10-21T13:00:00Z') })],
    });
    const prompt = promptTotalsOf(totals) as { prescricao: Record<string, unknown>; extras: { atividades: number }; aguardandoConfirmacaoDoAluno: { atividades: number; detalhe: Array<Record<string, unknown>> }; totalRealizado: { atividades: number; corrida: Record<string, number> } };
    expect(prompt.aguardandoConfirmacaoDoAluno).toMatchObject({ atividades: 1, detalhe: [expect.objectContaining({ modalidade: 'corrida', distanciaKm: 12, duracaoMin: 70, fcMediaBpm: 151 })] });
    expect(prompt.extras.atividades).toBe(0);
    expect(prompt.prescricao).toMatchObject({ sessoesCumpridas: 0 });
    expect(prompt.totalRealizado).toMatchObject({ atividades: 1, corrida: { atividades: 1, km: 12 } });
    expect(JSON.stringify(prompt)).not.toMatch(/polar|"p1"/);
    expect(EXECUTION_REPORT_INSTRUCTION).toMatch(/aguardandoConfirmacaoDoAluno: atividade realizada ainda sem classificacao definitiva/);
    expect(EXECUTION_REPORT_INSTRUCTION).toMatch(/NAO a trate como cumprimento nem como extra ate a resposta/);
    const contract = analyzeWeekInContext({ weekStart: WEEK, indicators: null, rows: [], previousWeeks: [], trends: [], feedbackBySession: new Map(), realized: totals });
    expect(contract.facts.find((f) => f.code === 'atividades_aguardando_confirmacao')!.statement).toMatch(/NÃO devem ser tratadas como cumprimento da prescrição nem como extra até a resposta/);
  });
});
