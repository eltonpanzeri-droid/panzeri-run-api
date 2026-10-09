import { AnalysisContract, Capability, Finding, prontuarioDigest, toPrescriberEvidence } from '../src/training-plans/training-analyst';
import { buildDecisionReasoning, normalizeDeclaredReasoning } from '../src/training-plans/prescription-trace';

// Etapa 3 — priorizacao das evidencias enviadas ao Prescritor e fundamentacao declarada. Funcoes puras: sem banco, sem IA.

const finding = (code: string, statement: string, extra: Partial<Finding> = {}): Finding => ({
  id: code, code, source: 'technical', statement, data: {}, support: 'media', horizon: 'recente', kind: 'padrao', basis: [], refs: {}, ...extra,
});
const capability = (id: string, family: string, statement: string, horizon: Capability['horizon']): Capability => ({ id, kind: 'formato_recorrente', family, statement, data: {}, horizon, sessionIds: [] });
const contract = (scope: AnalysisContract['scope'], over: Partial<AnalysisContract> = {}): AnalysisContract => ({
  schema: 'training-analysis/1', analystVersion: 1, scope, period: { start: '2026-09-01', end: '2026-10-05' }, asOf: '2026-10-05',
  facts: [], reported: [], findings: [], gaps: [], capabilities: [], changes: [], evidence: { sessionIds: [], activityLogIds: [], providers: ['polar'], windowsDays: [21, 60, 200], limitations: [], madeWithoutAI: true }, ...over,
});

describe('toPrescriberEvidence — priorizacao sem alterar calculos', () => {
  const many = Array.from({ length: 8 }, (_, i) => finding(`generico_${i}`, `Observacao generica numero ${i}`));
  const goalRelated = finding('volume_de_longo', 'Longos de 30 km com trecho rapido: capacidade para maratona demonstrada', { support: 'media', horizon: 'pontual', kind: 'padrao' });
  const longitudinal = contract('longitudinal', { findings: [...many, goalRelated] });

  it('sem foco mantem a ordem por sustentacao/horizonte (comportamento anterior)', () => {
    const evidence = toPrescriberEvidence({ week: null, longitudinal, sessions: [] })! as { evolucao: { achados: Array<{ codigo: string }> } };
    expect(evidence.evolucao.achados.map((a) => a.codigo)).not.toContain('volume_de_longo');
  });

  it('o objetivo atual do aluno promove achados aderentes (a sustentacao continua pesando), sem aumentar a quantidade', () => {
    const evidence = toPrescriberEvidence({ week: null, longitudinal, sessions: [] }, { goal: 'Completar uma maratona', directives: [] })! as { evolucao: { achados: Array<{ codigo: string }> } };
    expect(evidence.evolucao.achados).toHaveLength(5);
    expect(evidence.evolucao.achados.map((a) => a.codigo)).toContain('volume_de_longo');
  });

  it('o tipo da sessao e as diretrizes orientam capacidades e mudancas; dificuldade recorrente sobe sobre achado neutro', () => {
    const caps = [
      capability('c1', 'longos', 'Longo de 30 km regular', 'consolidado'),
      capability('c2', 'intervalado 1 km', 'Formato recorrente: 1 km a 4:00 com 1 km leve, 10 repeticoes', 'recente'),
    ];
    const withKind = toPrescriberEvidence({ week: null, longitudinal: contract('longitudinal', { capabilities: caps }), sessions: [] }, { sessionKind: 'intervalado' })! as { evolucao: { capacidades: Array<{ texto: string }> } };
    expect(withKind.evolucao.capacidades[0].texto).toMatch(/Formato recorrente/);
    const hard = finding('dificuldade_x', 'Dificuldade recorrente de recuperacao entre repeticoes', { kind: 'dificuldade', support: 'media', horizon: 'recente' });
    const neutral = finding('neutro', 'Fato neutro', { kind: null, support: 'media', horizon: 'recente' });
    const evidence = toPrescriberEvidence({ week: contract('week', { findings: [neutral, hard] }), longitudinal: null, sessions: [] })! as { semana: { achados: Array<{ codigo: string }> } };
    expect(evidence.semana.achados[0].codigo).toBe('dificuldade_x');
  });

  it('nao descarta lacunas nem inventa: sem achados e sem lacunas => null', () => {
    expect(toPrescriberEvidence({ week: contract('week'), longitudinal: contract('longitudinal'), sessions: [] }, { goal: 'maratona' })).toBeNull();
  });
});

describe('prontuarioDigest — poucas linhas datadas, sem copiar relatorio', () => {
  it('inclui capacidades, mudancas e padroes/dificuldades com sustentacao >= media; ignora o resto; limita o tamanho', () => {
    const longitudinal = contract('longitudinal', {
      capabilities: [capability('c1', 'longos', 'Longo de 30 km com 1 km a ~4:30', 'consolidado')],
      changes: [{ family: 'intervalado 1 km', variable: 'repeticoes', unit: 'n', from: 6, to: 8, deltaPct: 33.3, fromSessionId: 'a', toSessionId: 'b' }],
      findings: [finding('p', 'Padrao com suporte', { support: 'media' }), finding('baixo', 'Padrao fraco', { support: 'baixa' }), finding('f', 'Fato', { kind: null })],
    });
    const text = prontuarioDigest(longitudinal)!;
    expect(text).toMatch(/dados ate 2026-10-05/);
    expect(text).toContain('Longo de 30 km');
    expect(text).toContain('repeticoes de 6 para 8');
    expect(text).toContain('Padrao com suporte');
    expect(text).not.toContain('Padrao fraco');
    expect(text.length).toBeLessThanOrEqual(900);
    expect(prontuarioDigest(contract('longitudinal'))).toBeNull();
    expect(prontuarioDigest(null)).toBeNull();
  });
});

describe('fundamentacao declarada: o Analista pode ser citado e a variavel decidida fica registrada', () => {
  it('normaliza decides (enum fechado; invalido some) e liga a fonte ao item training_analysis do indice', () => {
    const declared = normalizeDeclaredReasoning({ intent: 'i', expected: 'e', basis: [
      { source: 'analiseTecnicaDoAnalistaDeTreinos', note: 'capacidade recorrente', decides: 'progressao' },
      { source: 'relatorioDeExecucaoDaSemanaAnterior', note: 'fidelidade', decides: 'qualquer-coisa' },
    ] })!;
    expect(declared.basis[0].decides).toBe('progressao');
    expect(declared.basis[1].decides).toBeUndefined();
    const evidence = [{ ref: 'training_analysis', kind: 'training_analysis', delivery: 'full', providers: ['polar'] }] as never;
    const fields = buildDecisionReasoning(declared, evidence);
    expect(fields.basis!.entries[0]).toMatchObject({ source: 'analiseTecnicaDoAnalistaDeTreinos', decides: 'progressao', delivered: true, evidenceRefs: ['training_analysis'], providers: ['polar'] });
    expect(fields.basis!.entries[1].delivered).toBe(false); // declarada, mas o relatorio nao foi entregue: fica marcado
  });
});
