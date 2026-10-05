import { ReportTimelineService } from '../src/reporter/report-timeline.service';
import { RelatorOutputSchema, StudentReporterAgentService } from '../src/reporter/student-reporter-agent.service';
import { StudentProfileService, ProfileEventCode } from '../src/training-plans/student-profile.service';
import { EvolutionAgentService } from '../src/reassessment/evolution-agent.service';
import { PrescriptionAgentService } from '../src/training-plans/prescription-agent.service';
import { MethodologyInput } from '../src/training-plans/training-methodology';

// 05/10/2026 — Fatos persistentes relatados pelo aluno (ex: "minha academia nao tem hack squat").
// Pontualidade do relato (relevance) != duracao da informacao (temporality=PERSISTENTE_ATE_CONTRARIO).
// A IA (Relator/condensacao/Treinador) nao e' chamada aqui: testamos o encanamento deterministico
// (promocao ao prontuario, o que a condensacao recebe, o que o Treinador recebe) e o conteudo das
// instrucoes de prompt. O comportamento semantico dos modelos em si nao e' testavel sem chamar a API.

function relatorResult(overrides: Record<string, unknown>) {
  return {
    facts: 'fato', perception: null, themes: [], temporality: 'ATUAL', longitudinalNote: null,
    hypotheses: [], relevance: 'PONTUAL', ...overrides,
  };
}

function buildTimeline(result: unknown, originalText = 'texto') {
  const occurredAt = new Date('2026-10-05T12:00:00Z');
  const studentReportEntry = {
    create: jest.fn().mockResolvedValue({ id: 'e1', userId: 'aluno-1', occurredAt }),
    findUnique: jest.fn().mockResolvedValue({
      id: 'e1', userId: 'aluno-1', sourceType: 'workout_feedback_notes', promptQuestion: null,
      relatedLabel: 'Feedback do treino', originalText, occurredAt,
    }),
    findMany: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue({}),
  };
  const prisma = { studentReportEntry, user: { findUnique: jest.fn().mockResolvedValue({ name: 'Ana' }) } };
  const relatorAgent = { analyze: jest.fn().mockResolvedValue(result) };
  const studentProfile = { recordEvent: jest.fn().mockResolvedValue(undefined) };
  const service = new ReportTimelineService(prisma as never, relatorAgent as never, studentProfile as never);
  return { service, studentProfile, studentReportEntry };
}

function baseInput(overrides: Partial<MethodologyInput> = {}): MethodologyInput {
  return {
    goal: 'Correr 10km', experience: 'intermediario', answers: {},
    availability: [{ weekday: 1, modalities: ['corrida'], availableMin: 60, modalityDurations: null }],
    history: [], studentDirectives: [], activeObservations: [], ...overrides,
  };
}

function prescriptionService() {
  return new PrescriptionAgentService({ get: jest.fn().mockReturnValue('') } as never, { enqueue: jest.fn() } as never);
}

describe('Relator: temporalidade PERSISTENTE_ATE_CONTRARIO', () => {
  it('o schema do Relator aceita o novo valor', () => {
    expect(RelatorOutputSchema.safeParse(relatorResult({ temporality: 'PERSISTENTE_ATE_CONTRARIO' })).success).toBe(true);
  });

  it('o prompt separa frequencia do relato (relevance) de duracao da informacao (temporality) e traz os exemplos', () => {
    const service = new StudentReporterAgentService({ get: jest.fn() } as never, { run: jest.fn() } as never);
    const prompt = (service as unknown as { buildSystemPrompt: () => string }).buildSystemPrompt();
    expect(prompt).toContain('PERSISTENTE_ATE_CONTRARIO');
    expect(prompt).toContain('NAO precisa ser recorrente para ser persistente');
    expect(prompt).toContain('minha academia nao tem hack squat');
    expect(prompt).toContain('hoje o aparelho estava quebrado');
    expect(prompt).toContain('nesta semana estou viajando');
    expect(prompt).toContain('relevance mede a FREQUENCIA');
  });
});

describe('Promocao ao prontuario', () => {
  it('"minha academia nao tem hack squat": PONTUAL + persistente e promovido, com marca de validade', async () => {
    const { service, studentProfile } = buildTimeline(relatorResult({
      facts: 'A aluna informa que a academia dela nao tem hack squat.',
      temporality: 'PERSISTENTE_ATE_CONTRARIO', relevance: 'PONTUAL',
    }), 'Minha academia nao tem hack squat.');
    await service.analyzeEntry('e1');
    expect(studentProfile.recordEvent).toHaveBeenCalledTimes(1);
    const [userId, code, content] = studentProfile.recordEvent.mock.calls[0];
    expect(userId).toBe('aluno-1');
    expect(code).toBe(ProfileEventCode.STUDENT_REPORT_ANALYZED);
    expect(content).toContain('relevancia=PONTUAL, temporalidade=PERSISTENTE_ATE_CONTRARIO');
    expect(content).toContain('FATO: A aluna informa que a academia dela nao tem hack squat.');
    expect(content).toContain('VALIDADE: informacao persistente');
  });

  it.each([
    ['hoje o aparelho estava quebrado', 'ATUAL'],
    ['estou viajando esta semana', 'ATUAL'],
    ['relato comum', 'PASSADO'],
    ['relato comum', 'INDETERMINADO'],
  ])('"%s" (%s) nao persistente + PONTUAL continua fora do prontuario', async (_texto, temporality) => {
    const { service, studentProfile } = buildTimeline(relatorResult({ temporality, relevance: 'PONTUAL' }));
    await service.analyzeEntry('e1');
    expect(studentProfile.recordEvent).not.toHaveBeenCalled();
  });

  it('o conteudo promovido de um relato nao persistente (ACOMPANHAR) nao ganha a marca de validade', async () => {
    const { service, studentProfile } = buildTimeline(relatorResult({ temporality: 'ATUAL', relevance: 'ACOMPANHAR' }));
    await service.analyzeEntry('e1');
    expect(studentProfile.recordEvent.mock.calls[0][2]).not.toContain('VALIDADE');
  });

  it('o Relator recebe a temporalidade dos relatos anteriores (para detectar atualizacao/contradicao)', async () => {
    const { service, studentReportEntry } = buildTimeline(relatorResult({}));
    studentReportEntry.findMany.mockResolvedValue([
      { occurredAt: new Date('2026-09-01T00:00:00Z'), sourceType: 'workout_feedback_notes', originalText: 'Minha academia nao tem hack squat.', themes: [], relevance: 'PONTUAL', temporality: 'PERSISTENTE_ATE_CONTRARIO' },
    ]);
    const relator = (service as unknown as { relatorAgent: { analyze: jest.Mock } }).relatorAgent;
    await service.analyzeEntry('e1');
    expect(relator.analyze.mock.calls[0][0].priorEntries[0]).toMatchObject({ temporality: 'PERSISTENTE_ATE_CONTRARIO' });
  });
});

describe('Prontuario: condensacao recebe o fato persistente e a regra de substituicao', () => {
  const agent = new EvolutionAgentService({ get: jest.fn() } as never, { run: jest.fn() } as never);
  const systemPrompt = (agent as unknown as { buildProfileCondensationSystemPrompt: () => string }).buildProfileCondensationSystemPrompt();
  const userPrompt = (input: unknown) => (agent as unknown as { buildProfileCondensationUserPrompt: (i: unknown) => string }).buildProfileCondensationUserPrompt(input);

  it('o prompt manda preservar fato persistente em ESTADO ATUAL e substituir quando contradito, mantendo historico', () => {
    expect(systemPrompt).toContain('FATOS PERSISTENTES');
    expect(systemPrompt).toContain('PERSISTENTE_ATE_CONTRARIO');
    expect(systemPrompt).toContain('SUBSTITUI o anterior em ESTADO ATUAL');
    expect(systemPrompt).toContain('TRAJETORIA como historico datado');
    expect(systemPrompt).toContain('troquei de academia e agora tem hack squat');
    // relato persistente e preservado quase literalmente, como MUDANCA_IMPORTANTE
    expect(systemPrompt).toMatch(/MUDANCA_IMPORTANTE ou temporalidade PERSISTENTE_ATE_CONTRARIO/);
  });

  it('refreshProfile entrega a condensacao o resumo atual + o evento persistente novo; resumo devolvido e o que o Treinador le', async () => {
    const eventoAntigo = 'Relato do aluno interpretado (Feedback do treino, relevancia=PONTUAL, temporalidade=PERSISTENTE_ATE_CONTRARIO). FATO: academia sem hack squat.';
    const eventoNovo = 'Relato do aluno interpretado (Feedback do treino, relevancia=PONTUAL, temporalidade=PERSISTENTE_ATE_CONTRARIO). FATO: trocou de academia e a nova tem hack squat. PADRAO OBSERVADO: substitui o relato anterior de que a academia nao tinha hack squat.';
    const resumoAntes = '4) ESTADO ATUAL: aluna relata que a academia nao tem hack squat.';
    const resumoDepois = '3) TRAJETORIA: ate 05/10 a academia nao tinha hack squat. 4) ESTADO ATUAL: aluna relata que a nova academia tem hack squat.';

    const pending = [{ id: 'ev2', code: ProfileEventCode.STUDENT_REPORT_ANALYZED, content: eventoNovo, createdAt: new Date('2026-10-20T10:00:00Z') }];
    const prisma = {
      studentProfile: { findUnique: jest.fn().mockResolvedValue({ summary: resumoAntes }), upsert: jest.fn().mockResolvedValue({}) },
      studentProfileEvent: { findMany: jest.fn().mockResolvedValue(pending), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    const condenser = { condenseProfile: jest.fn().mockResolvedValue(resumoDepois) };
    const profile = new StudentProfileService(prisma as never, condenser as never);
    const summary = await profile.refreshProfile('aluno-1');

    const sent = condenser.condenseProfile.mock.calls[0][0];
    expect(sent.currentSummary).toBe(resumoAntes);
    expect(sent.newEvents[0].content).toContain('trocou de academia');
    const sentPrompt = JSON.parse(userPrompt(sent));
    expect(sentPrompt.resumoAtual).toBe(resumoAntes);
    expect(sentPrompt.eventosNovos[0]).toMatchObject({ codigo: 'STUDENT_REPORT_ANALYZED' });
    expect(eventoAntigo).toContain('sem hack squat'); // historico original segue gravado como evento

    // O que o Treinador recebe e' exatamente o resumo atualizado: sem a indisponibilidade como vigente.
    const prompt = JSON.parse((prescriptionService() as unknown as {
      buildUserPrompt: (...a: unknown[]) => string;
    }).buildUserPrompt(baseInput({ studentProfileSummary: summary }), [], [], false, false, {}, null));
    expect(prompt.prontuarioDoAluno).toBe(resumoDepois);
    const estadoAtual = String(prompt.prontuarioDoAluno).split('4) ESTADO ATUAL:')[1];
    expect(estadoAtual).not.toContain('nao tem hack squat');
    expect(estadoAtual).toContain('tem hack squat');
  });
});

describe('Agente Treinador: contexto de fatos persistentes na mesma chamada', () => {
  it('o prontuario com a indisponibilidade chega ao Treinador no campo prontuarioDoAluno', () => {
    const resumo = '4) ESTADO ATUAL: aluna relata que a academia dela nao tem hack squat (relato do aluno, persistente ate informar o contrario).';
    const prompt = JSON.parse((prescriptionService() as unknown as {
      buildUserPrompt: (...a: unknown[]) => string;
    }).buildUserPrompt(baseInput({ studentProfileSummary: resumo }), [], [], false, false, {}, null));
    expect(prompt.prontuarioDoAluno).toBe(resumo);
  });

  it('o system prompt manda considerar fato persistente atual como realidade operacional, sem regra mecanica, e ignorar o que e historico', () => {
    const system = (prescriptionService() as unknown as { buildSystemPromptStable: (...a: unknown[]) => string }).buildSystemPromptStable();
    expect(system).toContain('FATOS PERSISTENTES DO ALUNO');
    expect(system).toContain('realidade operacional');
    expect(system).toContain('busque uma alternativa compativel com o objetivo');
    expect(system).toContain('nao uma regra mecanica');
    expect(system).toContain('TRAJETORIA como historico');
  });
});
