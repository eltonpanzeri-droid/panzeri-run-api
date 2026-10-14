import { Prisma } from '@prisma/client';
import { AwardReevaluationInput, CatalogEntry, ExistingAward, planAwardReevaluation } from '../src/medals/medal-award-decision';
import type { UnlockCandidate } from '../src/medals/medal-evaluation.service';
import { withVolumeReconciliation } from '../src/medals/volume-reconciliation';
import type { EvolutionSeries } from '../src/evolution/evolution.types';

// Etapa 3 (15/10/2026): decisao PURA sobre concessoes de medalha apos uma correcao. Nada aqui le banco nem e' chamado por fluxo algum; a revogacao so' e'
// recomendada ('review' + wouldRevoke) enquanto allowRevocation estiver desligado.

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const catalog = (code: string, category: string, ruleVersion = 1, active = true): CatalogEntry => ({ code, category, active, ruleVersion });

function award(code: string, category: string, extra: Partial<ExistingAward> = {}): ExistingAward {
  return {
    id: `ua-${code}`, code, category, threshold: null, criteria: {}, catalogVersion: 1, awardedVersion: 1,
    value: null, periodStart: null, periodEnd: null, evidence: {}, ...extra,
  };
}
const candidate = (code: string, extra: Partial<UnlockCandidate> = {}): UnlockCandidate => ({ code, value: null, periodStart: null, periodEnd: null, modality: null, evidence: {}, ...extra });

const none = new Set<string>();
const emptyScope = { weeks: none, months: none, countsChanged: false };
const weekSeries = (weeks: string[]): EvolutionSeries => ({
  weeks: weeks.map((weekStart) => ({ weekStart, kmPercorridos: 10 })) as never,
  months: [] as never, calculatedAt: '2026-10-15T00:00:00Z',
});

function plan(overrides: Partial<AwardReevaluationInput> & Pick<AwardReevaluationInput, 'existing' | 'candidates' | 'catalog' | 'evaluatedCategories'>) {
  return planAwardReevaluation({ scope: emptyScope, ...overrides });
}
const kinds = (actions: ReturnType<typeof plan>) => actions.map((a) => [a.code, a.kind, a.reason]);

describe('contagens (treinos concluidos, feedbacks...): so revoga se o total ficou abaixo do limiar', () => {
  const base = { catalog: [catalog('T10', 'treinos_concluidos')], evaluatedCategories: new Set(['treinos_concluidos']) };

  it('total corrigido continua >= limiar (candidato presente): mantem, mesmo com o valor historico diferente', () => {
    const actions = plan({ ...base, existing: [award('T10', 'treinos_concluidos', { value: 12 })], candidates: [candidate('T10', { value: 10 })] });
    expect(kinds(actions)).toEqual([['T10', 'keep', 'criterio_mantido']]);
  });

  it('total ficou abaixo do limiar apos a correcao de feedback: revogacao recomendada (desativada por padrao)', () => {
    const actions = plan({ ...base, existing: [award('T10', 'treinos_concluidos')], candidates: [], scope: { ...emptyScope, countsChanged: true } });
    expect(kinds(actions)).toEqual([['T10', 'review', 'revogacao_desativada']]);
    expect(actions[0].wouldRevoke).toBe(true);
  });

  it('com allowRevocation ligado: revoga', () => {
    const actions = plan({ ...base, existing: [award('T10', 'treinos_concluidos')], candidates: [], scope: { ...emptyScope, countsChanged: true }, allowRevocation: true });
    expect(kinds(actions)).toEqual([['T10', 'revoke', 'criterio_nao_atendido']]);
  });

  it('correcao NAO mexeu em feedback (countsChanged=false): nunca revoga, vai para revisao', () => {
    const actions = plan({ ...base, existing: [award('T10', 'treinos_concluidos')], candidates: [], allowRevocation: true });
    expect(kinds(actions)).toEqual([['T10', 'review', 'fora_do_escopo_da_correcao']]);
  });
});

describe('periodo (volume semanal): ajusta se outro periodo atinge; revoga so se nenhum atinge e sem incerteza', () => {
  const week = '2026-09-14';
  const existing = award('V30', 'volume_semanal', { value: 31, periodStart: d(week), periodEnd: d(week), evidence: { weekStart: week } });
  const base = { catalog: [catalog('V30', 'volume_semanal')], evaluatedCategories: new Set(['volume_semanal']), series: weekSeries([week]) };
  const scope = { weeks: new Set([week]), months: new Set(['2026-09']), countsChanged: false };

  it('outra semana passou a ser a primeira que atinge o limiar: ajusta periodo e valor (nao revoga)', () => {
    const actions = plan({ ...base, existing: [existing], candidates: [candidate('V30', { value: 32, periodStart: d('2026-09-28'), periodEnd: d('2026-09-28'), evidence: { weekStart: '2026-09-28' } })], scope });
    expect(kinds(actions)).toEqual([['V30', 'adjust', 'periodo_ou_valor_diferente']]);
  });

  it('mesmo periodo e valor: mantem', () => {
    const actions = plan({ ...base, existing: [existing], candidates: [candidate('V30', { value: 31, periodStart: d(week), periodEnd: d(week), evidence: { weekStart: week } })], scope });
    expect(kinds(actions)).toEqual([['V30', 'keep', 'criterio_mantido']]);
  });

  it('nenhum periodo atinge mais, periodo tocado pela correcao e com observacoes: revogacao recomendada', () => {
    const actions = plan({ ...base, existing: [existing], candidates: [], scope, allowRevocation: true });
    expect(kinds(actions)).toEqual([['V30', 'revoke', 'criterio_nao_atendido']]);
  });

  it('periodo INCERTO: ausencia de dado nao e prova — revisao, nunca revoga', () => {
    const actions = plan({ ...base, existing: [existing], candidates: [], scope, uncertainty: { weeks: new Set([week]), months: none }, allowRevocation: true });
    expect(kinds(actions)).toEqual([['V30', 'review', 'periodo_incerto_ou_sem_observacoes']]);
  });

  it('sem observacoes no periodo (serie vazia ou ausente): revisao', () => {
    expect(kinds(plan({ ...base, series: weekSeries([]), existing: [existing], candidates: [], scope, allowRevocation: true }))).toEqual([['V30', 'review', 'periodo_incerto_ou_sem_observacoes']]);
    expect(kinds(plan({ ...base, series: undefined, existing: [existing], candidates: [], scope, allowRevocation: true }))).toEqual([['V30', 'review', 'periodo_incerto_ou_sem_observacoes']]);
  });

  it('periodo da concessao fora do que a correcao tocou: inconsistencia anterior => revisao', () => {
    const actions = plan({ ...base, existing: [existing], candidates: [], scope: { weeks: new Set(['2026-10-05']), months: new Set(['2026-10']), countsChanged: false }, allowRevocation: true });
    expect(kinds(actions)).toEqual([['V30', 'review', 'fora_do_escopo_da_correcao']]);
  });

  it('candidato de volume com periodo anterior incerto: revisao (mesma regra da reconciliacao de volume)', () => {
    const actions = plan({ ...base, existing: [existing], candidates: [candidate('V30', { value: 31, periodStart: d(week), periodEnd: d(week) })], scope, uncertainty: { weeks: new Set(['2026-09-07']), months: none } });
    expect(kinds(actions)).toEqual([['V30', 'review', 'periodo_incerto']]);
  });
});

describe('sequencias: a janela de semanas da concessao decide se a correcao a tocou', () => {
  const existing = award('C4', 'constancia', { threshold: 4, periodEnd: d('2026-09-28'), evidence: { consecutiveWeeks: 4, endWeek: '2026-09-28' } });
  const base = { catalog: [catalog('C4', 'constancia')], evaluatedCategories: new Set(['constancia']), allowRevocation: true };

  it('correcao em semana DENTRO da janela de 4 semanas e nenhuma sequencia valida resta: revoga', () => {
    const actions = plan({ ...base, existing: [existing], candidates: [], scope: { weeks: new Set(['2026-09-14']), months: none, countsChanged: false } });
    expect(kinds(actions)).toEqual([['C4', 'revoke', 'criterio_nao_atendido']]);
  });

  it('correcao em semana FORA da janela (depois do fim): nao revoga', () => {
    const actions = plan({ ...base, existing: [existing], candidates: [], scope: { weeks: new Set(['2026-10-12']), months: none, countsChanged: false } });
    expect(kinds(actions)).toEqual([['C4', 'review', 'fora_do_escopo_da_correcao']]);
  });

  it('outra sequencia valida existe (candidato com outro fim): ajusta, nao revoga', () => {
    const actions = plan({ ...base, existing: [existing], candidates: [candidate('C4', { periodEnd: d('2026-10-12'), evidence: { endWeek: '2026-10-12' } })], scope: { weeks: new Set(['2026-09-14']), months: none, countsChanged: false } });
    expect(kinds(actions)).toEqual([['C4', 'adjust', 'periodo_ou_valor_diferente']]);
  });

  it('sem periodo determinavel na concessao: revisao conservadora', () => {
    const actions = plan({ ...base, existing: [award('C4', 'constancia', { threshold: 4 })], candidates: [], scope: { weeks: new Set(['2026-09-14']), months: none, countsChanged: false } });
    expect(kinds(actions)).toEqual([['C4', 'review', 'periodo_nao_determinado']]);
  });
});

describe('versao da regra e catalogo', () => {
  it('concessao sob versao de regra diferente da do catalogo nunca e reavaliada automaticamente', () => {
    const actions = plan({
      catalog: [catalog('T10', 'treinos_concluidos', 2)], evaluatedCategories: new Set(['treinos_concluidos']),
      existing: [award('T10', 'treinos_concluidos', { awardedVersion: 1, catalogVersion: 2 })], candidates: [], scope: { ...emptyScope, countsChanged: true }, allowRevocation: true,
    });
    expect(kinds(actions)).toEqual([['T10', 'review', 'versao_ou_catalogo_divergente']]);
  });

  it('medalha fora do catalogo => revisao', () => {
    const actions = plan({ catalog: [], evaluatedCategories: new Set(['treinos_concluidos']), existing: [award('X', 'treinos_concluidos')], candidates: [] });
    expect(kinds(actions)).toEqual([['X', 'review', 'versao_ou_catalogo_divergente']]);
  });
});

describe('reativacao e concessao nova', () => {
  const week = '2026-09-14';
  const original = { value: 31, periodStart: d(week), periodEnd: d(week), evidence: { weekStart: week } as Prisma.JsonValue };
  const retracted = withVolumeReconciliation({ weekStart: week }, 'retracted', original, '2026-10-13T12:00:00.000Z') as Prisma.JsonValue;

  it('concessao revogada (marcador de volume) cujo criterio voltou a ser atendido: reativa, carregando a concessao existente (historico preservado)', () => {
    const existing = award('V30', 'volume_semanal', { evidence: retracted, value: 31, periodStart: d(week), periodEnd: d(week) });
    const actions = plan({ catalog: [catalog('V30', 'volume_semanal')], evaluatedCategories: new Set(['volume_semanal']), existing: [existing], candidates: [candidate('V30', { value: 31, periodStart: d(week), periodEnd: d(week) })] });
    expect(kinds(actions)).toEqual([['V30', 'reactivate', 'criterio_voltou_a_ser_atendido']]);
    expect(actions[0].existing).toBe(existing);
  });

  it('revogada pela coluna status (futura) tambem e reconhecida', () => {
    const existing = award('T10', 'treinos_concluidos', { status: 'revoked' });
    const actions = plan({ catalog: [catalog('T10', 'treinos_concluidos')], evaluatedCategories: new Set(['treinos_concluidos']), existing: [existing], candidates: [candidate('T10')] });
    expect(kinds(actions)).toEqual([['T10', 'reactivate', 'criterio_voltou_a_ser_atendido']]);
  });

  it('revogada e criterio continua nao atendido: segue revogada (nada a fazer)', () => {
    const existing = award('T10', 'treinos_concluidos', { status: 'revoked' });
    const actions = plan({ catalog: [catalog('T10', 'treinos_concluidos')], evaluatedCategories: new Set(['treinos_concluidos']), existing: [existing], candidates: [] });
    expect(kinds(actions)).toEqual([['T10', 'keep', 'segue_revogada']]);
  });

  it('criterio atendido sem concessao registrada: cria; catalogo inativo ou categoria nao avaliada: nao cria', () => {
    const evaluated = new Set(['treinos_concluidos']);
    expect(kinds(plan({ catalog: [catalog('T10', 'treinos_concluidos')], evaluatedCategories: evaluated, existing: [], candidates: [candidate('T10')] }))).toEqual([['T10', 'create', 'conquista_comprovada_nao_registrada']]);
    expect(kinds(plan({ catalog: [catalog('T10', 'treinos_concluidos', 1, false)], evaluatedCategories: evaluated, existing: [], candidates: [candidate('T10')] }))).toEqual([['T10', 'review', 'catalogo_inativo']]);
    expect(plan({ catalog: [catalog('F5', 'feedbacks')], evaluatedCategories: evaluated, existing: [], candidates: [candidate('F5')] })).toEqual([]);
  });
});

describe('escopo e pureza', () => {
  it('concessao de categoria NAO reavaliada nunca recebe acao (so as categorias afetadas)', () => {
    const actions = plan({
      catalog: [catalog('T10', 'treinos_concluidos'), catalog('CK', 'checkins')], evaluatedCategories: new Set(['treinos_concluidos']),
      existing: [award('T10', 'treinos_concluidos'), award('CK', 'checkins')], candidates: [candidate('T10')],
    });
    expect(actions.map((a) => a.code)).toEqual(['T10']);
  });

  it('idempotente e sem efeito colateral: mesma entrada, mesma saida, entrada intacta', () => {
    const input: AwardReevaluationInput = {
      catalog: [catalog('T10', 'treinos_concluidos')], evaluatedCategories: new Set(['treinos_concluidos']),
      existing: [award('T10', 'treinos_concluidos')], candidates: [], scope: { ...emptyScope, countsChanged: true },
    };
    const before = JSON.stringify(input.existing);
    const first = planAwardReevaluation(input);
    const second = planAwardReevaluation(input);
    expect(kinds(first)).toEqual(kinds(second));
    expect(JSON.stringify(input.existing)).toBe(before);
  });

  it('por padrao NUNCA devolve revoke (mecanismo de revogacao desativado)', () => {
    const actions = plan({
      catalog: [catalog('T10', 'treinos_concluidos')], evaluatedCategories: new Set(['treinos_concluidos']),
      existing: [award('T10', 'treinos_concluidos')], candidates: [], scope: { ...emptyScope, countsChanged: true },
    });
    expect(actions.some((a) => a.kind === 'revoke')).toBe(false);
  });
});
