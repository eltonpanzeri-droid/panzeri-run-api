import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { AiRunDaySchema, AiStrengthSessionSchema, AiWeeklyDecisionSchema, PrescriptionAgentService } from '../src/training-plans/prescription-agent.service';
import {
  BASIS_SOURCES, buildDecisionReasoning, DeclaredBasis, EvidenceItem, invalidateDeclaredForProvider, normalizeDeclaredReasoning, REASONING_LIMITS,
} from '../src/training-plans/prescription-trace';

// Etapa 1.2b — raciocinio tecnico DECLARADO pela IA (intent / expected / basis): contratos, normalizacao, vinculo com evidencias, controle de tamanho
// e exclusao de dados de provedor. Declaracao da IA nao e' prova de que a evidencia influenciou a decisao.

const evidence = (overrides: Partial<EvidenceItem>): EvidenceItem => ({ ref: 'x', kind: 'k', source: 's', sourceId: null, provider: null, asOf: null, label: 'l', delivery: 'delivered', storage: 'complete', excerpt: null, ...overrides });

describe('normalizacao do raciocinio declarado (tamanho controlado em codigo)', () => {
  it('trunca nos limites, descarta vazios, troca fonte desconhecida por "outro" e nunca lanca', () => {
    const long = 'x'.repeat(5000);
    const result = normalizeDeclaredReasoning({
      intent: ` ${long} `, expected: long,
      basis: [
        { source: 'historicoSemanal', note: long }, { source: 'invencao', note: 'fonte inexistente' }, { source: 'outro', note: '' },
        { source: 'metasDeProva', note: 'a' }, { source: 'athleteStateContext', note: 'b' }, { source: 'sinalDeSeguranca', note: 'c' },
      ],
    })!;
    expect(result.intent).toHaveLength(REASONING_LIMITS.intent);
    expect(result.expected).toHaveLength(REASONING_LIMITS.expected);
    expect(result.basis).toHaveLength(REASONING_LIMITS.basisItems);
    expect(result.basis[0].note).toHaveLength(REASONING_LIMITS.basisNote);
    expect(result.basis[1]).toEqual({ source: 'outro', note: 'fonte inexistente' });
    expect(result.basis.every((entry) => (BASIS_SOURCES as readonly string[]).includes(entry.source))).toBe(true);
  });

  it('nada a declarar => null (nunca um objeto vazio); entradas invalidas => null', () => {
    expect(normalizeDeclaredReasoning(null)).toBeNull();
    expect(normalizeDeclaredReasoning(undefined)).toBeNull();
    expect(normalizeDeclaredReasoning('texto')).toBeNull();
    expect(normalizeDeclaredReasoning({ intent: '  ', expected: '', basis: [] })).toBeNull();
    expect(normalizeDeclaredReasoning({ intent: 'so objetivo', expected: null, basis: 'nao-e-lista' })).toEqual({ intent: 'so objetivo', expected: null, basis: [] });
  });

  it('o pior caso de tamanho de TODA a semana (7 corridas + 14 forca) cabe com folga: custo de tokens previsivel', () => {
    const worst = normalizeDeclaredReasoning({ intent: 'i'.repeat(999), expected: 'e'.repeat(999), basis: Array.from({ length: 9 }, () => ({ source: 'historicoSemanal', note: 'n'.repeat(999) })) })!;
    const perSession = JSON.stringify(worst).length;
    const weekWorstCase = perSession * (7 + 14);
    expect(perSession).toBeLessThan(800);
    expect(weekWorstCase).toBeLessThan(17_000); // ~4-5 mil tokens no PIOR caso absoluto; o normal sao ~100 tokens por sessao
  });
});

describe('vinculo do raciocinio declarado com o indice de evidencias (feito pelo codigo)', () => {
  const index = [
    evidence({ ref: 'history_week:2026-09-28', kind: 'history_week', providers: ['polar'] }),
    evidence({ ref: 'report:r1', kind: 'report' }),
    evidence({ ref: 'variable:activity.cadenceAvg', kind: 'athlete_state_variable', providers: ['polar', 'wahoo'] }),
    evidence({ ref: 'gap:estado_do_atleta', kind: 'directive', delivery: 'absent' }),
  ];

  it('liga cada fonte aos itens correspondentes, marca entregue/nao entregue, herda provedores e rotula como declaracao (nao prova)', () => {
    const fields = buildDecisionReasoning({
      intent: 'Consolidar base aerobica', expected: 'Ritmo estavel sem dor',
      basis: [{ source: 'historicoSemanal', note: 'volume da semana' }, { source: 'relatosEstruturadosDoAluno', note: 'limite da esteira' }, { source: 'diretrizesEspecificasDoTreinadorParaEsteAluno', note: 'sem corrida na quarta' }, { source: 'maiorLongaoJaRegistrado', note: 'recorde' }],
    }, index);
    expect(fields.traceStatus).toBe('complete');
    expect(fields.intent).toBe('Consolidar base aerobica');
    expect(fields.expected).toEqual({ text: 'Ritmo estavel sem dor' });
    expect(fields.basis).toMatchObject({ declared: true, nature: 'declared_by_ai_not_proof_of_influence', providers: ['polar'], invalidatedProviders: [] });
    const [week, report, directive, record] = fields.basis!.entries;
    expect(week).toMatchObject({ evidenceRefs: ['history_week:2026-09-28'], delivered: true, providers: ['polar'] });
    expect(report).toMatchObject({ evidenceRefs: ['report:r1'], delivered: true, providers: [] });
    expect(directive).toMatchObject({ delivered: false }); // so ha item AUSENTE: a declaracao nao tem lastro no contexto entregue
    expect(record).toMatchObject({ evidenceRefs: [], delivered: false });
  });

  it('declaracao parcial => partial; sem declaracao (ou registro antigo) => absent com campos nulos', () => {
    expect(buildDecisionReasoning({ intent: 'so objetivo', expected: null, basis: [] }, index).traceStatus).toBe('partial');
    expect(buildDecisionReasoning({ intent: 'a', expected: 'b', basis: [] }, index).traceStatus).toBe('partial'); // sem fundamento nao e completo
    expect(buildDecisionReasoning(null, index)).toEqual({ intent: null, expected: null, basis: null, traceStatus: 'absent' });
    expect(buildDecisionReasoning(undefined, index).traceStatus).toBe('absent');
  });
});

describe('exclusao de dados de provedor sobre o raciocinio declarado', () => {
  const basis = (): DeclaredBasis => ({
    declared: true, nature: 'declared_by_ai_not_proof_of_influence', providers: ['polar', 'wahoo'], invalidatedProviders: [],
    entries: [
      { source: 'historicoSemanal', note: 'correu 5km em 41min', evidenceRefs: ['history_week:2026-09-28'], delivered: true, providers: ['polar'] },
      { source: 'relatosEstruturadosDoAluno', note: 'esteira limitada', evidenceRefs: ['report:r1'], delivered: true, providers: [] },
      { source: 'athleteStateContext', note: 'cadencia estavel', evidenceRefs: ['variable:activity.cadenceAvg'], delivered: true, providers: ['wahoo'] },
    ],
  });

  it('invalida o texto das entradas derivadas do provedor e limpa objetivo/esperado; preserva entradas independentes e outro provedor', () => {
    const out = invalidateDeclaredForProvider(basis(), 'polar');
    expect(out).toMatchObject({ changed: true, clearTexts: true });
    const [week, report, state] = out.basis!.entries;
    expect(week).toEqual({ source: 'historicoSemanal', note: null, evidenceRefs: [], delivered: true, providers: [], removed: true });
    expect(report.note).toBe('esteira limitada'); // independente: fica
    expect(state.note).toBe('cadencia estavel'); // outro provedor: fica ate a exclusao dele
    expect(out.basis).toMatchObject({ providers: ['wahoo'], invalidatedProviders: ['polar'] });
    // exclusao sucessiva (Wahoo) e idempotencia
    const second = invalidateDeclaredForProvider(out.basis, 'wahoo');
    expect(second.basis!.entries[2].removed).toBe(true);
    expect(second.basis!.entries[1].note).toBe('esteira limitada');
    expect(second.basis!.invalidatedProviders).toEqual(['polar', 'wahoo']);
    expect(invalidateDeclaredForProvider(second.basis, 'polar').changed).toBe(false);
  });

  it('decisao sem apoio em evidencia do provedor (ou registro antigo sem basis) nao e tocada', () => {
    expect(invalidateDeclaredForProvider(basis(), 'garmin')).toMatchObject({ changed: false, clearTexts: false });
    expect(invalidateDeclaredForProvider(null, 'polar')).toEqual({ changed: false, basis: null, clearTexts: false });
    expect(invalidateDeclaredForProvider({ legado: true }, 'polar').changed).toBe(false);
  });
});

describe('contratos de saida estruturada do Prescritor (semana, dia de corrida, dia de forca)', () => {
  const part = { kind: 'continua', distanceKm: 5, paceSecondsPerKmMin: 480, paceSecondsPerKmMax: 480 };
  const reasoning = { intent: 'x'.repeat(2000), expected: 'y'.repeat(2000), basis: [{ source: 'historicoSemanal', note: 'z'.repeat(2000) }] };
  const run = { weekday: 2, title: 'Corrida', durationMin: 40, parts: [part], notes: 'n', durationJustification: null };
  const strength = { weekday: 3, modality: 'forca', title: 'Forca', exerciseIds: ['a', 'b', 'c'], sets: 3, reps: '10', restSeconds: 60, intensity: 'Leve', notes: 'n' };

  it('os tres schemas convertem para JSON Schema da saida estruturada e exigem a chave reasoning (que pode ser null)', () => {
    for (const schema of [AiWeeklyDecisionSchema, AiStrengthSessionSchema, AiRunDaySchema]) expect(() => zodOutputFormat(schema)).not.toThrow();
    // percorre o JSON Schema (com $defs): todo objeto que declara "reasoning" o lista como obrigatorio (nullable), e o vocabulario de fontes e fechado
    const found: boolean[] = [];
    const walk = (node: unknown) => {
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (!node || typeof node !== 'object') return;
      const record = node as { properties?: Record<string, unknown>; required?: string[] };
      if (record.properties && 'reasoning' in record.properties) found.push(Array.isArray(record.required) && record.required.includes('reasoning'));
      Object.values(record).forEach(walk);
    };
    for (const schema of [AiWeeklyDecisionSchema, AiStrengthSessionSchema, AiRunDaySchema]) walk(zodOutputFormat(schema).schema);
    expect(found.length).toBeGreaterThanOrEqual(4); // sessao de corrida + sessao de forca (semana), forca avulsa e dia de corrida avulso
    expect(found.every(Boolean)).toBe(true);
    const text = JSON.stringify(zodOutputFormat(AiWeeklyDecisionSchema).schema);
    for (const source of BASIS_SOURCES) expect(text).toContain(source);
  });

  it('aceita reasoning = null e reasoning enorme SEM rejeitar a prescricao (o tamanho e truncado em codigo, nunca no schema)', () => {
    expect(AiRunDaySchema.safeParse({ parts: [part], reasoning: null }).success).toBe(true);
    expect(AiRunDaySchema.safeParse({ parts: [part], reasoning }).success).toBe(true);
    expect(AiStrengthSessionSchema.safeParse({ ...strength, reasoning }).success).toBe(true);
    expect(AiWeeklyDecisionSchema.safeParse({ sessions: [{ ...run, reasoning }], strengthSessions: [{ ...strength, reasoning: null }], recommendation: 'r', rationale: ['a'] }).success).toBe(true);
    // fonte fora do vocabulario e rejeitada pela saida estruturada (a IA nao inventa nomes): garantia do enum
    expect(AiRunDaySchema.safeParse({ parts: [part], reasoning: { intent: 'a', expected: 'b', basis: [{ source: 'invencao', note: 'c' }] } }).success).toBe(false);
  });

  it('a montagem das decisoes normaliza o raciocinio (truncado) e preserva o resto da prescricao', () => {
    const agent = new PrescriptionAgentService({ get: () => undefined } as never, {} as never) as unknown as {
      validateSessions: (sessions: unknown[], slots: unknown[]) => { sessions: Array<{ declared: { intent: string } | null; durationMin: number; notes: string }> };
      validateStrengthSessions: (sessions: unknown[], slots: unknown[]) => { sessions: Array<{ declared: { intent: string } | null; reps: string }> };
    };
    const runs = agent.validateSessions([{ ...run, reasoning }, { ...run, weekday: 4, reasoning: null }], [{ weekday: 2, durationMin: 40 }, { weekday: 4, durationMin: 40 }]).sessions;
    expect(runs[0].declared?.intent).toHaveLength(REASONING_LIMITS.intent);
    expect(runs[1].declared).toBeNull();
    expect(runs[0]).toMatchObject({ durationMin: 40, notes: 'n' });
    const strengths = agent.validateStrengthSessions([{ ...strength, reasoning }], [{ weekday: 3, modality: 'forca', durationMin: 45 }]).sessions;
    expect(strengths[0].declared?.intent).toHaveLength(REASONING_LIMITS.intent);
    expect(strengths[0].reps).toBe('10');
  });
});
