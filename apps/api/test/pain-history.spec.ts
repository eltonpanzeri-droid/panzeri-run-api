import { buildPainHistory, PainHistorySessionRow } from '../src/pain-reports/pain-history';
import { PainReportsService } from '../src/pain-reports/pain-reports.service';

// 02/11/2026 — historico de dor por treino (area "Dor" da Evolucao). Regra de Elton: treino registrado e que conta nas contas = zero quando nao ha relato de dor;
// "nenhuma" respondida e' zero afirmado (answered), sem resposta e' zero assumido (answered=false). Valor desconhecido nunca vira zero.
const session = (over: Partial<PainHistorySessionRow> & { id: string }): PainHistorySessionRow => ({
  modality: 'corrida', scheduledDate: new Date('2026-10-20T00:00:00Z'), origin: null, hasActiveLink: false,
  completion: { status: 'done', painFlag: 'none', painTiming: null }, ...over,
});

describe('buildPainHistory', () => {
  it('"nenhuma" respondida = zero afirmado; leve/moderado/forte mantem o nivel e o momento da dor', () => {
    const result = buildPainHistory({
      sessions: [
        session({ id: 'a' }),
        session({ id: 'b', completion: { status: 'done', painFlag: 'moderado', painTiming: 'durante_continuou' } }),
      ],
      unlinkedActivities: [],
    });
    expect(result[0]).toMatchObject({ id: 'a', level: 'none', answered: true, timing: null });
    expect(result[1]).toMatchObject({ id: 'b', level: 'moderado', answered: true, timing: 'durante_continuou' });
  });

  it('treino registrado SEM resposta de dor (extra do relogio com completion sintetica) = zero assumido, marcado answered=false', () => {
    const [entry] = buildPainHistory({
      sessions: [session({ id: 'x', origin: 'device_extra', completion: { status: 'done', painFlag: null, painTiming: null } })],
      unlinkedActivities: [],
    });
    expect(entry).toMatchObject({ level: 'none', answered: false, origin: 'relogio' });
  });

  it('treino com vinculo ativo e sem feedback conta (execucao objetiva) como zero assumido', () => {
    const [entry] = buildPainHistory({ sessions: [session({ id: 'v', completion: null, hasActiveLink: true })], unlinkedActivities: [] });
    expect(entry).toMatchObject({ id: 'v', level: 'none', answered: false });
  });

  it('nao feito explicito (missed) e sessao sem registro nenhum ficam FORA: nunca viram zero', () => {
    const result = buildPainHistory({
      sessions: [
        session({ id: 'm', completion: { status: 'missed', painFlag: null, painTiming: null }, hasActiveLink: true }),
        session({ id: 'n', completion: null, hasActiveLink: false }),
      ],
      unlinkedActivities: [],
    });
    expect(result).toEqual([]);
  });

  it('valor de dor desconhecido nao e adivinhado: o treino fica de fora', () => {
    expect(buildPainHistory({ sessions: [session({ id: 'u', completion: { status: 'done', painFlag: 'talvez', painTiming: null } })], unlinkedActivities: [] })).toEqual([]);
  });

  it('atividade do relogio sem vinculo e sem treino extra entra como zero assumido, no dia LOCAL da atividade', () => {
    const [entry] = buildPainHistory({
      sessions: [],
      // 01:30 UTC de 21/10 com fuso -03:00 = 22:30 de 20/10 local
      unlinkedActivities: [{ id: 'w1', sport: 'corrida', startedAt: new Date('2026-10-21T01:30:00Z'), utcOffsetMinutes: -180 }],
    });
    expect(entry).toMatchObject({ id: 'act:w1', date: '2026-10-20', modality: 'corrida', level: 'none', answered: false, origin: 'relogio' });
  });

  it('duas sessoes no mesmo dia ficam separadas, cada uma na sua modalidade (corrida 3 e forca 0)', () => {
    const result = buildPainHistory({
      sessions: [
        session({ id: 'corrida-1', modality: 'corrida', completion: { status: 'done', painFlag: 'forte', painTiming: 'so_depois' } }),
        session({ id: 'forca-1', modality: 'forca' }),
      ],
      unlinkedActivities: [],
    });
    expect(result.map((e) => [e.modality, e.level])).toEqual([['corrida', 'forte'], ['forca', 'none']]);
    expect(new Set(result.map((e) => e.date)).size).toBe(1);
  });
});

describe('PainReportsService.history', () => {
  it('une treinos registrados, atividades sem vinculo e relatos avulsos; atividade ja virada em treino extra nao duplica', async () => {
    const act = (id: string, startedAt: string) => ({ id, sport: 'corrida', startedAt: new Date(startedAt), utcOffsetMinutes: -180, physicalIdentityStatus: null, physicalEventId: null, physicalCanonicalActivityLogId: null });
    const prisma: any = {
      trainingSession: {
        findMany: jest.fn()
          .mockResolvedValueOnce([{ id: 's1', modality: 'forca', scheduledDate: new Date('2026-10-20T00:00:00Z'), origin: null, completion: { status: 'done', painFlag: 'leve', painTiming: 'durante_passou' }, executionLinks: [] }])
          .mockResolvedValueOnce([{ structure: { activityLogId: 'act-materializada' } }]),
      },
      activityLog: { findMany: jest.fn().mockResolvedValue([act('act-materializada', '2026-10-19T12:00:00Z'), act('act-solta', '2026-10-21T12:00:00Z')]) },
      painReport: { findMany: jest.fn().mockResolvedValue([{ id: 'r1', createdAt: new Date('2026-10-22T10:00:00Z'), regions: ['joelho'], otherLocation: null, intensity: 4, worseningTrend: 'stable', dailyLifeImpact: 'no' }]) },
    };
    const service = new PainReportsService(prisma, {} as never, {} as never);
    const result = await service.history('aluno-1');
    expect(result.entries.map((e) => e.id)).toEqual(['s1', 'act:act-solta']);
    expect(result.entries[0]).toMatchObject({ modality: 'forca', level: 'leve', answered: true });
    expect(result.reports).toHaveLength(1);
    // sempre so' do proprio aluno
    expect(prisma.trainingSession.findMany.mock.calls[0][0].where.userId).toBe('aluno-1');
    expect(prisma.painReport.findMany.mock.calls[0][0].where.userId).toBe('aluno-1');
  });
});
