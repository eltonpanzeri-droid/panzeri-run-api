import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HR_DECOUPLING_CATEGORIES as SERVER_CATEGORIES, HR_DECOUPLING_CATEGORY_LABELS, hrDecouplingVariableId as serverVariableId } from '../src/training-intelligence/hr-decoupling';
import { HR_DECOUPLING_BACKFILL_BATCH, HrDecouplingBackfillService } from '../src/training-intelligence/hr-decoupling-backfill.service';
import { ObservationReaderService } from '../src/training-intelligence/observation-reader.service';
import { MathLayerService } from '../src/training-intelligence/math-layer.service';
import { HR_DECOUPLING_CATEGORIES as APP_CATEGORIES, HR_DECOUPLING_MEANING, HR_DECOUPLING_MIN_PRIOR, comparisonSentences, hrDecouplingVariableId as appVariableId } from '../../mobile/home/hrDecouplingInfo';

// 03/11/2026 — Lote 2 do desacoplamento da FC: preenchimento em segundo plano, auditoria por corrida (aluna e treinador), Evolucao da aluna e painel. A tela do celular nao calcula nada:
// aqui se verifica que as faixas acompanham o servidor, que as comparacoes respeitam o minimo de 5 corridas anteriores e que a auditoria devolve tambem as corridas que NAO entraram.
const read = (...parts: string[]) => readFileSync(join(__dirname, '..', ...parts), 'utf8');

describe('Evolucao da aluna — faixas e textos', () => {
  it('as cinco faixas do celular sao as do servidor (mesmo id e mesmo rotulo)', () => {
    expect(APP_CATEGORIES.map((c) => c.id)).toEqual([...SERVER_CATEGORIES]);
    for (const c of APP_CATEGORIES) {
      expect(c.label).toBe(HR_DECOUPLING_CATEGORY_LABELS[c.id]);
      expect(appVariableId(c.id)).toBe(serverVariableId(c.id));
    }
  });

  it('o texto "O que isso representa" nao afirma desempenho, desgaste do sistema nervoso nem risco, e nao usa o nome antigo', () => {
    expect(HR_DECOUPLING_MEANING).not.toMatch(/sistema nervoso|aer[oó]bi|risco|les[aã]o|piora de desempenho|garante|certamente/i);
    expect(HR_DECOUPLING_MEANING).toMatch(/sugerem|pode|costuma/);
    expect(HR_DECOUPLING_MEANING.length).toBeLessThanOrEqual(750);
  });

  it('a secao fica na area "Resposta a carga" e a modalidade e fixa (sem seletor de modalidade)', () => {
    expect(read('..', 'mobile', 'home', 'LoadSection.tsx')).toContain('<HrDecouplingSection accessToken={accessToken} />');
    const section = read('..', 'mobile', 'home', 'HrDecouplingSection.tsx');
    expect(section).toContain('Modalidade: Corrida');
    expect(section).toContain('/me/hr-decoupling/audit');
    expect(section).not.toContain('availableModalities');
  });
});

describe('Evolucao da aluna — comparacoes com o historico', () => {
  const point = (over: Record<string, unknown>) => ({
    timestamp: '2026-10-20T10:00:00Z', value: 4, priorN: 8, historicalMean: { value: 3, n: 8 },
    movingAverages: { mm21: { value: 3.2, n: 8, isPartialWindow: true }, mm60: { value: 3.4, n: 8, isPartialWindow: true } },
    band: { lower: 1, upper: 5, median: 3, n: 8, basis: 'limited' as const }, signal: 'within' as const, ...over,
  });
  const snap = (p: Record<string, unknown>) => ({ reference: { points: [p] } }) as never;

  it(`com menos de ${HR_DECOUPLING_MIN_PRIOR} corridas anteriores nao compara: so' informa a quantidade`, () => {
    const out = comparisonSentences(snap(point({ priorN: 4 })));
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('começam com 5 corridas anteriores');
    expect(comparisonSentences(snap(point({ priorN: 0 })))[0]).toContain('Há 0 corridas anteriores');
  });

  it('a partir de 5: media historica sempre; medias moveis so quando a janela esta completa; faixa com a base declarada', () => {
    const partial = comparisonSentences(snap(point({})));
    expect(partial.some((s) => s.startsWith('Média de todas as corridas anteriores da faixa: 3%'))).toBe(true);
    expect(partial.some((s) => s.includes('últimas 21') || s.includes('últimas 60'))).toBe(false);
    expect(partial.some((s) => s.includes('(base pequena)'))).toBe(true);
    const full = comparisonSentences(snap(point({ movingAverages: { mm21: { value: 3.25, n: 21, isPartialWindow: false }, mm60: { value: 3.4, n: 60, isPartialWindow: true } } })));
    expect(full.some((s) => s.includes('últimas 21') && s.includes('3,3%'))).toBe(true);
    expect(full.some((s) => s.includes('últimas 60'))).toBe(false);
  });

  it('a posicao em relacao a faixa e descritiva, sem julgamento; sem faixa nao inventa faixa', () => {
    const above = comparisonSentences(snap(point({ signal: 'above' }))).join(' ');
    expect(above).toContain('ficou acima dela (só a posição, sem julgamento)');
    expect(above).not.toMatch(/melhor|pior|bom|ruim|risco/i);
    expect(comparisonSentences(snap(point({ band: { lower: null, upper: null, median: null, n: 8, basis: 'none' }, signal: 'no_reference' }))).join(' ')).not.toContain('Faixa habitual');
    expect(comparisonSentences(null)).toEqual([]);
  });
});

describe('auditoria por corrida e leitura', () => {
  const log = (id: string, startedAt: string, sport = 'RUNNING') => ({ id, userId: 's1', startedAt: new Date(startedAt), provider: 'polar', sport, executionClassification: 'alternative', physicalIdentityStatus: 'unique', durationSec: 3000, distanceMeters: 8000 });
  const stored = (activityLogId: string, over: Record<string, unknown>) => ({ activityLogId, algorithmVersion: 1, pointCount: 5, eligible: true, category: 'd30', exclusionReason: null, decouplingPct: 2, speedCvPct: 4, halfDiffPct: 1, validHrSamples: 100, validSpeedSamples: 100, discardedHrSamples: 0, discardedSpeedSamples: 0, gapCount: 0, ...over });
  const logs = [log('a', '2026-10-01T10:00:00Z'), log('b', '2026-10-05T10:00:00Z', 'corrida'), log('c', '2026-10-08T10:00:00Z')];
  const rows = [stored('a', {}), stored('b', { eligible: false, exclusionReason: 'cv_velocidade_acima_do_limite', decouplingPct: 9, speedCvPct: 14 }), stored('c', { eligible: false, category: null, exclusionReason: 'sem_serie_temporal', decouplingPct: null, speedCvPct: null, halfDiffPct: null, validHrSamples: 0, validSpeedSamples: 0 })];

  function reader() {
    const prisma = {
      activityLog: { findMany: jest.fn().mockResolvedValue(logs) },
      activityTimeSeriesPoint: { groupBy: jest.fn().mockResolvedValue(logs.map((l) => ({ activityLogId: l.id, _count: { _all: 5 } }))), findMany: jest.fn() },
      activityHrDecoupling: { findMany: jest.fn().mockResolvedValue(rows), upsert: jest.fn() },
      sessionExecutionLink: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return new ObservationReaderService(prisma as never, {} as never, new MathLayerService());
  }

  it('devolve TODAS as corridas (elegiveis ou nao), a mais recente primeiro, com motivo em portugues e os dados do calculo', async () => {
    const audit = await reader().getHrDecouplingAudit('s1');
    expect(audit.map((a) => a.activityLogId)).toEqual(['c', 'b', 'a']);
    expect(audit.find((a) => a.activityLogId === 'b')).toMatchObject({ eligible: false, exclusionReason: 'cv_velocidade_acima_do_limite', exclusionText: 'Velocidade variou mais de 10% (CV) ao longo da corrida', decouplingPct: 9 });
    expect(audit.find((a) => a.activityLogId === 'c')).toMatchObject({ eligible: false, exclusionText: 'Sem registro segundo a segundo desta corrida', decouplingPct: null });
    expect(audit.find((a) => a.activityLogId === 'a')).toMatchObject({ eligible: true, exclusionText: null, provider: 'polar', durationSec: 3000, validHrSamples: 100 });
  });

  it('as observacoes saem com modalidade fixa "corrida", mesmo quando o provedor grava RUNNING (nao vira dois botoes)', async () => {
    const obs = await reader().getObservations('s1', serverVariableId('d30'));
    expect(obs.map((o) => [o.context.activityLogId, o.context.modality])).toEqual([['a', 'corrida']]);
  });

  it('as rotas existem para a aluna (id do token) e para o treinador', () => {
    const me = read('src', 'me', 'me.controller.ts');
    expect(me).toContain("@Get('hr-decoupling/audit')");
    expect(me).toContain('getHrDecouplingAudit(user.sub)');
    expect(read('src', 'coach', 'coach.controller.ts')).toContain("@Get('students/:id/hr-decoupling/audit')");
    expect(read('..', 'admin', 'app', 'ti', 'explorer.tsx')).toContain("active.id.startsWith('activity.hrDecoupling.')");
  });
});

describe('preenchimento em segundo plano', () => {
  function service(pending: Array<{ id: string }>) {
    const prisma = {
      activityLog: { findMany: jest.fn().mockResolvedValue(pending) },
      activityTimeSeriesPoint: { groupBy: jest.fn().mockResolvedValue([]), findMany: jest.fn().mockResolvedValue([]) },
      activityHrDecoupling: { findMany: jest.fn().mockResolvedValue([]), upsert: jest.fn().mockImplementation(({ create }) => Promise.resolve(create)) },
    };
    return { prisma, svc: new HrDecouplingBackfillService(prisma as never) };
  }

  it('busca so corridas com serie e sem resultado desta versao, no tamanho do lote, e calcula cada uma', async () => {
    const { prisma, svc } = service([{ id: 'a' }, { id: 'b' }]);
    expect(await svc.fillPending()).toBe(2);
    const args = prisma.activityLog.findMany.mock.calls[0][0];
    expect(args.take).toBe(HR_DECOUPLING_BACKFILL_BATCH);
    expect(args.where.timeSeriesPoints).toEqual({ some: {} });
    expect(args.where.hrDecouplings).toEqual({ none: { algorithmVersion: 1 } });
    expect(args.orderBy).toEqual({ startedAt: 'desc' });
    expect(prisma.activityHrDecoupling.upsert).toHaveBeenCalledTimes(2);
  });

  it('sem pendencia nao faz nada; falha do banco nao derruba nem trava as proximas rodadas', async () => {
    const { svc } = service([]);
    expect(await svc.fillPending()).toBe(0);
    const broken = service([{ id: 'a' }]);
    broken.prisma.activityLog.findMany.mockRejectedValueOnce(new Error('banco fora'));
    expect(await broken.svc.fillPending()).toBe(0);
    expect(await broken.svc.fillPending()).toBe(1);
  });

  it('duas rodadas ao mesmo tempo nao se sobrepoem', async () => {
    const { prisma, svc } = service([{ id: 'a' }]);
    let release: (v: unknown) => void = () => undefined;
    prisma.activityLog.findMany.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    const first = svc.fillPending();
    expect(await svc.fillPending()).toBe(0);
    release([{ id: 'a' }]);
    expect(await first).toBe(1);
  });

  it('esta registrado no modulo e agendado a cada 10 minutos', () => {
    expect(read('src', 'training-intelligence', 'training-intelligence.module.ts')).toContain('HrDecouplingBackfillService');
    expect(read('src', 'training-intelligence', 'hr-decoupling-backfill.service.ts')).toContain('CronExpression.EVERY_10_MINUTES');
  });
});
