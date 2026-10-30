import { readFileSync } from 'fs';
import { join } from 'path';
import { PhysiologyService } from '../src/physiology/physiology.service';
import { OperationalReferenceService } from '../src/physiology/operational-reference.service';
import { PrescriptionAgentService, AiWeeklyDecisionSchema, type RunSessionParams } from '../src/training-plans/prescription-agent.service';
import { fakeDb } from './helpers/fake-physiology-db';

// Testes físicos, Lote 4 (30/10/2026): a referência operacional chega aos agentes, a IA pode propor ajustes com salvaguardas, e nada original é perdido.
const A = 'alunoA';
const users = { [A]: { birthDate: new Date('1985-05-10'), sex: 'masculino' }, B: { birthDate: new Date('1990-01-01'), sex: 'feminino' } };
const COACH = { id: 'treinador', role: 'coach' };
const setup = () => {
  const { db, t } = fakeDb(users);
  return { db, t, phys: new PhysiologyService(db), ref: new OperationalReferenceService(db) };
};
const evidence = (dates: string[]) => dates.map((data) => ({ data, descricao: `Treino de ${data}: sustentou o ritmo com FC estavel` }));
const GOOD = (over: Partial<Parameters<OperationalReferenceService['proposeAdjustment']>[1]> = {}) => ({
  indicadores: [{ chave: 'l2_speed_kmh', novoValor: 13.9 }],
  evidencias: evidence(['2026-10-01', '2026-10-12', '2026-10-24']),
  justificativa: 'Sustenta ritmos acima do L2 estimado, com FC estavel, por varias semanas.',
  proposedBy: 'prescription_agent',
  ...over,
});
const NOW = new Date('2026-11-01T12:00:00Z');

describe('1. aluno sem avaliação física', () => {
  it('nenhum agente recebe referência inventada, e o prompt diz null', async () => {
    const { ref } = setup();
    expect(await ref.getAgentView(A)).toBeNull();
    expect(await ref.evolutionInput(A)).toBeNull();
    expect(await ref.versions(A)).toEqual({ latest: null, fromTests: null, source: null });
    const agent: any = new PrescriptionAgentService({ get: () => undefined } as any, {} as any);
    const prompt = JSON.parse(agent.buildUserPrompt({ goal: 'x', experience: 'y', answers: {}, availability: [], history: [] }, [], [], false, false, {}, null));
    expect(prompt.referenciaFisiologicaOperacional).toBeNull();
    expect(await ref.proposeAdjustment(A, GOOD(), NOW)).toMatchObject({ accepted: false });
  });
});

describe('2 a 6. o que a IA recebe conforme as avaliações', () => {
  it('2. só um 3 km: referência com origem estimada, confiança, faixa, zonas e aviso de uso; FC informada fica como informada', async () => {
    const { phys, ref } = setup();
    await phys.saveThreeKm(A, { totalSeconds: 720, maxHeartRate: 186, environment: 'rua', performedAt: '2026-10-10' });
    const view = (await ref.getAgentView(A, NOW))!;
    expect(view).toMatchObject({ fonte: 'referencia_operacional', origemDaVersao: 'avaliacoes', versao: 1 });
    expect(view.avaliacaoDeReferencia).toMatchObject({ metodo: 'Teste de 3 km', data: '2026-10-10', diasDesdeAAvaliacao: 22 });
    const by = Object.fromEntries(view.indicadores.map((i) => [i.indicador, i]));
    expect(by.vo2max).toMatchObject({ valor: 47.9, origem: 'estimado por modelo', confianca: 'moderada' });
    expect(by.hrmax_bpm.origem).toBe('informado pelo aluno');
    expect(by.l2_speed_kmh.faixa).toBeDefined();
    expect(by.l2_speed_kmh.pace).toMatch(/^\d:\d{2}\/km$/);
    expect(view.zonas).toHaveLength(5);
    expect(view.aviso).toMatch(/nao limites e nao ordens/);
  });

  it('3. ergoespirometria do treinador: valor medido com confiança alta, nunca confundido com estimativa', async () => {
    const { phys, ref } = setup();
    await phys.recordExternal(A, { method: 'ergospirometry', performedAt: '2026-10-10', results: { vo2max: 58, vvo2max_kmh: 18, hrmax_bpm: 190 } }, COACH);
    const view = (await ref.getAgentView(A, NOW))!;
    const by = Object.fromEntries(view.indicadores.map((i) => [i.indicador, i]));
    expect(by.vo2max).toMatchObject({ valor: 58, origem: 'medido', confianca: 'alta' });
    expect(by.l2_speed_kmh.origem).toBe('estimado por modelo');
    expect(view.avaliacaoDeReferencia?.metodo).toBe('Ergoespirometria');
  });

  it('4 e 5. métodos diferentes: dentro de 60 dias a ergoespirometria vence; fora, vence a mais recente, e a IA recebe o motivo da escolha', async () => {
    const dentro = setup();
    await dentro.phys.recordExternal(A, { method: 'ergospirometry', performedAt: '2026-09-01', results: { vo2max: 58, vvo2max_kmh: 18 } }, COACH);
    await dentro.phys.saveThreeKm(A, { totalSeconds: 720, environment: 'rua', performedAt: '2026-10-15' });
    const v1 = (await dentro.ref.getAgentView(A, NOW))!;
    expect(v1.avaliacaoDeReferencia).toMatchObject({ metodo: 'Ergoespirometria', motivoDaEscolha: 'ergoespirometria_ate_60_dias' });
    const fora = setup();
    await fora.phys.recordExternal(A, { method: 'ergospirometry', performedAt: '2026-05-01', results: { vo2max: 58, vvo2max_kmh: 18 } }, COACH);
    await fora.phys.saveThreeKm(A, { totalSeconds: 720, environment: 'rua', performedAt: '2026-10-15' });
    const v2 = (await fora.ref.getAgentView(A, NOW))!;
    expect(v2.avaliacaoDeReferencia).toMatchObject({ metodo: 'Teste de 3 km', motivoDaEscolha: 'mais_recente_ergoespirometria_antiga' });
  });

  it('6. referência com indicadores ausentes: nada é inventado e as zonas ficam nulas; o que falta vem de outra avaliação com procedência', async () => {
    const { phys, ref } = setup();
    await phys.recordExternal(A, { method: 'ergospirometry', performedAt: '2026-10-10', results: { vo2max: 58 } }, COACH);
    const only = (await ref.getAgentView(A, NOW))!;
    expect(only.indicadores.map((i) => i.indicador)).toEqual(['vo2max']);
    expect(only.zonas).toBeNull();
    await phys.saveThreeKm(A, { totalSeconds: 720, environment: 'rua', performedAt: '2026-10-05', maxHeartRate: 185 });
    const merged = (await ref.getAgentView(A, NOW))!;
    expect(merged.indicadores.find((i) => i.indicador === 'vvo2max_kmh')?.vindoDe).toMatchObject({ metodo: 'Teste de 3 km', data: '2026-10-05' });
    expect(merged.indicadores.find((i) => i.indicador === 'vo2max')?.vindoDe).toBeUndefined();
  });
});

describe('7 a 9. ajustes da referência pela IA', () => {
  async function withTest() { const s = setup(); await s.phys.saveThreeKm(A, { totalSeconds: 720, maxHeartRate: 186, environment: 'rua', performedAt: '2026-09-20' }); return s; }

  it('7. ajuste aceito: nova versão com data, origem e justificativa; zonas recalculadas; valor marcado como ajustado e original preservado no indicador', async () => {
    const { ref, t } = await withTest();
    const before = JSON.stringify([t.fitness, t.assess, t.ind]);
    const result = await ref.proposeAdjustment(A, GOOD(), NOW);
    expect(result).toMatchObject({ accepted: true, version: 2 });
    const row = t.ref.find((r: any) => r.version === 2);
    expect(row).toMatchObject({ source: 'ai_adjustment', justification: expect.stringContaining('Sustenta ritmos') });
    expect(row.payload.adjustment).toMatchObject({ proposedBy: 'prescription_agent', basedOnVersion: 1, changes: [{ key: 'l2_speed_kmh', to: 13.9 }] });
    const view = (await ref.getAgentView(A, NOW))!;
    const l2 = view.indicadores.find((i) => i.indicador === 'l2_speed_kmh')!;
    expect(l2).toMatchObject({ valor: 13.9, origem: 'ajustado pela analise dos treinos' });
    expect(l2.valorOriginalDaAvaliacao).toBeDefined();
    expect(l2.faixa).toBeUndefined();
    expect(view.zonas![1].ritmoMaisRapido).toBe('4:19/km'); // 3600 / 13.9 = 259 s
    expect(view.ajustesDaIADesdeAUltimaAvaliacao).toHaveLength(1);
    // 8. resultados originais e indicadores das avaliações intactos
    expect(JSON.stringify([t.fitness, t.assess, t.ind])).toBe(before);
  });

  it('salvaguardas: uma única observação, evidência concentrada, valores impossíveis, indicador não ajustável e ajuste repetido são recusados e nada muda', async () => {
    const { ref, t } = await withTest();
    const cases: Array<[string, any]> = [
      ['uma observação', GOOD({ evidencias: evidence(['2026-10-24']) })],
      ['mesma data repetida', GOOD({ evidencias: evidence(['2026-10-24', '2026-10-24', '2026-10-24']) })],
      ['data futura', GOOD({ evidencias: evidence(['2026-10-01', '2026-10-12', '2026-12-24']) })],
      ['sem justificativa', GOOD({ justificativa: '' })],
      ['L2 acima da velocidade no VO2máx', GOOD({ indicadores: [{ chave: 'l2_speed_kmh', novoValor: 29 }] })],
      ['L1 acima de L2', GOOD({ indicadores: [{ chave: 'l1_speed_kmh', novoValor: 14.5 }] })],
      ['FC fora do intervalo', GOOD({ indicadores: [{ chave: 'l2_hr_bpm', novoValor: 300 }] })],
      ['VO2máx não é ajustável', GOOD({ indicadores: [{ chave: 'vo2max', novoValor: 60 }] })],
      ['indicador inexistente', GOOD({ indicadores: [{ chave: 'l2_vo2', novoValor: 40 }] })],
      ['sem mudança de valor', GOOD({ indicadores: [{ chave: 'l2_speed_kmh', novoValor: (await ref.getAgentView(A, NOW))!.indicadores.find((i) => i.indicador === 'l2_speed_kmh')!.valor }] })],
    ];
    for (const [name, proposal] of cases) {
      const r = await ref.proposeAdjustment(A, proposal, NOW);
      expect({ name, accepted: r.accepted }).toEqual({ name, accepted: false });
    }
    expect(t.ref).toHaveLength(1);
    // sem cobertura mínima de dias nem intervalo: observações em 3 dias seguidos bastam para PODER propor
    expect((await ref.proposeAdjustment(A, GOOD({ evidencias: evidence(['2026-10-20', '2026-10-21', '2026-10-22']) }), NOW)).accepted).toBe(true);
    // ajuste seguinte no mesmo dia: não há bloqueio de tempo, mas a mesma evidência não pode ser reaproveitada
    const reuse = await ref.proposeAdjustment(A, GOOD({ indicadores: [{ chave: 'l2_speed_kmh', novoValor: 14.1 }], evidencias: evidence(['2026-10-20', '2026-10-21', '2026-10-22']) }), NOW);
    expect(reuse.accepted).toBe(false);
    expect(reuse.reasons.join(' ')).toContain('evidencia ja usada');
    // com observação nova (posterior ao ajuste), passa logo no dia seguinte
    const next = new Date(NOW.getTime() + 2 * 86_400_000);
    expect((await ref.proposeAdjustment(A, GOOD({ indicadores: [{ chave: 'l2_speed_kmh', novoValor: 14.1 }], evidencias: evidence(['2026-10-21', '2026-10-22', '2026-11-02']) }), next)).accepted).toBe(true);
  });

  it('ajuste do treinador (Gerente Técnico) dispensa a evidência, mas continua validando estrutura e justificativa, e fica identificado', async () => {
    const { ref, t } = await withTest();
    const ok = await ref.proposeAdjustment(A, { indicadores: [{ chave: 'l1_speed_kmh', novoValor: 11.5 }], evidencias: [], justificativa: 'Treinador observou evolucao nos longoes recentes.', proposedBy: 'technical_manager', coachInitiated: true }, NOW);
    expect(ok.accepted).toBe(true);
    expect(t.ref.find((r: any) => r.version === 2).source).toBe('coach_adjustment');
    expect((await ref.getAgentView(A, NOW))!.origemDaVersao).toBe('ajuste_do_treinador');
    const bad = await ref.proposeAdjustment(A, { indicadores: [{ chave: 'l1_speed_kmh', novoValor: 14.9 }], evidencias: [], justificativa: 'Treinador pediu.', proposedBy: 'technical_manager', coachInitiated: true }, NOW);
    expect(bad.accepted).toBe(false);
  });

  it('9. nova avaliação depois de ajustes da IA: a referência volta a vir da avaliação, o histórico de ajustes é preservado e o aviso de uso não cita ajustes antigos como atuais', async () => {
    const { ref, phys, t } = await withTest();
    await ref.proposeAdjustment(A, GOOD(), NOW);
    expect((await ref.getAgentView(A, NOW))!.ajustesDaIADesdeAUltimaAvaliacao).toHaveLength(1);
    await phys.recordExternal(A, { method: 'ergospirometry', performedAt: '2026-10-28', results: { vo2max: 57, vvo2max_kmh: 17.2, hrmax_bpm: 189 } }, COACH);
    const view = (await ref.getAgentView(A, NOW))!;
    expect(view.origemDaVersao).toBe('avaliacoes');
    expect(view.versao).toBe(3);
    expect(view.avaliacaoDeReferencia?.metodo).toBe('Ergoespirometria');
    expect(view.ajustesDaIADesdeAUltimaAvaliacao).toEqual([]);
    expect(t.ref.map((r: any) => r.source)).toEqual(['tests', 'ai_adjustment', 'tests']);
    const evo = (await ref.evolutionInput(A, NOW))!;
    expect(evo.avaliacoes).toHaveLength(2);
    expect(evo.historicoDaReferenciaOperacional.map((h) => h.origem)).toEqual(['tests', 'ai_adjustment', 'tests']);
    expect(await ref.versions(A)).toMatchObject({ latest: 3, fromTests: 3 });
  });
});

describe('10. geração de treino usando a referência operacional', () => {
  const src = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');
  it('o prompt semanal e o do dia avulso levam a referência; o pace do 3 km antigo deixou de ser evidência separada', () => {
    const agent: any = new PrescriptionAgentService({ get: () => undefined } as any, {} as any);
    const reference = { fonte: 'referencia_operacional', versao: 2, indicadores: [{ indicador: 'l2_speed_kmh', valor: 13.9 }] };
    const weekly = JSON.parse(agent.buildUserPrompt({ goal: 'x', experience: 'y', answers: {}, availability: [], history: [], physiologicalReference: reference }, [], [], false, false, { testPace: { secondsPerKm: 300, daysAgo: 3 } }, null));
    expect(weekly.referenciaFisiologicaOperacional).toEqual(reference);
    expect(JSON.stringify(weekly.evidenciasDePace)).not.toContain('300');
    const day = JSON.parse(agent.buildRunSessionUserPrompt({ durationMin: 40, evidence: { testPace: { secondsPerKm: 300, daysAgo: 3 }, selfReportedPace: null }, studentDirectives: [], activeObservations: [], painTier: 'normal', painReason: null, physiologicalReference: reference } as unknown as RunSessionParams));
    expect(day.referenciaFisiologicaOperacional).toEqual(reference);
    expect(JSON.stringify(day.evidenciasDePace)).not.toContain('300');
  });

  it('as instruções dizem que a referência é dado e não limite, descrevem o ajuste com evidência mínima e não fingem mais que o recurso foi suspenso', () => {
    const agent: any = new PrescriptionAgentService({ get: () => undefined } as any, {} as any);
    const weekly = agent.buildSystemPromptStable().map?.((p: any) => (typeof p === 'string' ? p : p.text)).join('\n') ?? String(agent.buildSystemPromptStable());
    const day = String(agent.buildRunSessionSystemPrompt());
    for (const text of [weekly, day]) {
      expect(text).toContain('referenciaFisiologicaOperacional');
      expect(text).toContain('REGRA SOBRE TESTES FISICOS');
      expect(text).not.toContain('O aluno nao sabe que essa feature existiu');
    }
    expect(weekly).toContain('NAO e limite rigido nem ordem');
    expect(weekly).toContain('AO MENOS 3 observacoes');
    expect(weekly).toContain('NUNCA proponha por uma unica sessao');
  });

  it('a saída da IA aceita o campo de ajuste e continua válida sem ele (nunca derruba a semana)', () => {
    const base = { sessions: [], strengthSessions: [], recommendation: '', rationale: ['x'] };
    expect(() => AiWeeklyDecisionSchema.shape.ajusteDeReferenciaFisiologica.parse(undefined)).not.toThrow();
    expect(() => AiWeeklyDecisionSchema.shape.ajusteDeReferenciaFisiologica.parse(null)).not.toThrow();
    expect(AiWeeklyDecisionSchema.shape.ajusteDeReferenciaFisiologica.parse({ indicadores: [{ chave: 'l2_speed_kmh', novoValor: 13.9 }], evidencias: [], justificativa: 'x' })).toBeTruthy();
    void base;
  });

  it('generateWeek lê a referência, a entrega à IA, guarda a versão usada no programa e registra a proposta SÓ depois de salvar', () => {
    const tp = src('training-plans/training-plans.service.ts');
    expect(tp).toContain('const physiologicalReference = await this.referenceForAgents(userId);');
    expect(tp).toContain('physiologicalReference,\n');
    expect(tp).toMatch(/physiologicalReference: referenceVersions \? \{ version/);
    const savePlan = tp.indexOf('Telegram') > 0 ? tp.indexOf('await this.applyReferenceAdjustment(userId, user.name, user.studentCode, aiDecision.physiologicalReferenceAdjustment)') : -1;
    expect(savePlan).toBeGreaterThan(tp.indexOf('await this.telegram.notifyCoach(\n        `✅ Treino da semana gerado.'));
  });
});

describe('11. salvar um teste não gera programa nem gasta tentativa', () => {
  it('saveThreeKm e recordExternal funcionam com tabelas de programa/tentativas bloqueadas, e o serviço nem importa o de programas', async () => {
    const { phys, t } = setup();
    await phys.saveThreeKm(A, { totalSeconds: 720, environment: 'rua', performedAt: '2026-10-10' });
    await phys.recordExternal(A, { method: 'ergospirometry', performedAt: '2026-10-11', results: { vo2max: 55 } }, COACH);
    expect(t.touched).toEqual([]);
    for (const file of ['physiology/physiology.service.ts', 'physiology/operational-reference.service.ts', 'fitness-tests/fitness-tests.service.ts']) {
      const code = readFileSync(join(__dirname, '..', 'src', file), 'utf8');
      expect(code).not.toMatch(/generateWeek|TrainingPlansService|trainingPlanGenerationLock|generationAttempt/i);
    }
  });
});

describe('12. compatibilidade com os registros históricos', () => {
  it('aluno com 3 km antigo e sem a estrutura nova: a referência é recalculada NA LEITURA pelo modelo vigente, ignorando o VO2 gravado pela equação antiga', async () => {
    const { db, t, ref } = (() => { const s = setup(); return { db: s.db, t: s.t, ref: s.ref }; })();
    t.fitness.push({ id: 'legado', userId: A, testType: '3km', totalSeconds: 720, avgHeartRate: 170, maxHeartRate: 184, environment: 'rua', vo2maxEstimated: 43.8, vvo2Kmh: 15, paceSecondsPerKm: 240, notes: null, createdAt: new Date('2026-07-10T15:00:00Z'), performedAt: null, modelVersion: null });
    const view = (await ref.getAgentView(A, NOW))!;
    expect(view).toMatchObject({ fonte: 'teste_de_3km_recalculado_na_leitura', origemDaVersao: 'legado', versao: null });
    expect(view.indicadores.find((i) => i.indicador === 'vo2max')?.valor).toBe(47.9); // não 43,8
    expect(view.avaliacaoDeReferencia?.data).toBe('2026-07-10');
    expect(t.assess).toHaveLength(0); // nada foi gravado
    void db;
  });

  it('as camadas de leitura (snapshot, treinador, Agente de Evolução, Gerente Técnico) usam a mesma fonte e o mesmo modelo', () => {
    const read = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');
    expect(read('training-intelligence/athlete-state-snapshot.service.ts')).toContain('referenceVo2 ?? calculateThreeKmMetrics(latest.totalSeconds)');
    expect(read('reassessment/reassessment.service.ts')).toContain('physiologyReference?.evolutionInput(userId)');
    expect(read('reassessment/reassessment.service.ts')).toContain('calculateThreeKmMetrics(test.totalSeconds).vo2maxEstimated');
    expect(read('technical-manager/technical-manager-agent.service.ts')).toContain('referenciaFisiologicaOperacional: physiologicalReference');
    expect(read('coach/coach.service.ts')).toContain('calculateThreeKmMetrics(test.totalSeconds).vo2maxEstimated');
  });

  it('o aviso "há avaliação mais recente que o programa" só compara quando o programa registrou a versão usada (programas antigos não disparam em massa)', () => {
    const tp = readFileSync(join(__dirname, '..', 'src', 'training-plans', 'training-plans.service.ts'), 'utf8');
    expect(tp).toContain('if (usedReference !== undefined && this.operationalReference)');
    expect(tp).toContain("'Ha uma avaliacao fisica mais recente do que a usada no programa.'");
  });
});

describe('laudo de ergoespirometria com VO₂ dos limiares em % do máximo e 6 zonas (30/10/2026)', () => {
  const LAB = { vo2max: 44.7, vvo2max_kmh: 15, hrmax_bpm: 168, l1_speed_kmh: 8, l1_hr_bpm: 109, l1_vo2_pct: 53, l2_speed_kmh: 13, l2_hr_bpm: 156, l2_vo2_pct: 88 };

  it('converte o % em ml/kg/min com o VO₂máx do exame, guarda o % no resultado original e monta as 6 zonas (Z5 = ±3%)', async () => {
    const { phys, ref, t } = setup();
    await phys.recordExternal(A, { method: 'ergospirometry', performedAt: '2025-08-13', results: LAB }, COACH);
    const view = (await ref.getAgentView(A, NOW))!;
    const by = Object.fromEntries(view.indicadores.map((i) => [i.indicador, i]));
    expect(by.l1_vo2.valor).toBe(23.69);
    expect(by.l2_vo2.valor).toBe(39.34);
    expect(t.assess[0].rawResults).toMatchObject({ l1_vo2_pct: 53, l2_vo2_pct: 88 });
    expect(view.zonas!.map((z) => z.zona)).toEqual(['Z1-Z2', 'Z3', 'Z4', 'Z5', 'Z6']);
    expect(view.zonas![0]).toMatchObject({ ritmoMaisRapido: '7:30/km', fcMaxima: 109 });
    expect(view.zonas![1]).toMatchObject({ ritmoMaisLento: '7:30/km', ritmoMaisRapido: '4:37/km' });
    expect(view.zonas![3]).toMatchObject({ ritmoMaisLento: '4:07/km', ritmoMaisRapido: '3:53/km' });
    expect(view.zonas![4]).toMatchObject({ ritmoMaisRapido: 'sem limite', ritmoMaisLento: '3:53/km' });
  });

  it('% sem o VO₂máx do exame, ou informado junto com ml/kg/min, é recusado (nada é inventado)', async () => {
    const { phys } = setup();
    await expect(phys.recordExternal(A, { method: 'ergospirometry', performedAt: '2025-08-13', results: { l1_vo2_pct: 53, l1_speed_kmh: 8 } }, COACH)).rejects.toThrow();
    await expect(phys.recordExternal(A, { method: 'ergospirometry', performedAt: '2025-08-13', results: { vo2max: 44.7, l1_vo2: 23, l1_vo2_pct: 53 } }, COACH)).rejects.toThrow();
  });

  it('versão gravada com 3 zonas (antes desta mudança) é lida com as 6 zonas, sem alterar o que está gravado', async () => {
    const { phys, ref, t } = setup();
    await phys.recordExternal(A, { method: 'ergospirometry', performedAt: '2025-08-13', results: LAB }, COACH);
    t.ref[0].payload.zones = [{ id: 'Z1' }, { id: 'Z2' }, { id: 'Z3' }];
    const view = (await ref.getAgentView(A, NOW))!;
    expect(view.zonas).toHaveLength(5);
    expect(t.ref[0].payload.zones).toHaveLength(3);
    expect(((await phys.profile(A)) as any).operationalReference.payload.zones).toHaveLength(5);
  });
});

describe('zonas como faixas estimadas e FC só para avaliar (30/10/2026)', () => {
  it('as instruções dizem que FC não prescreve, que as zonas são faixas estimadas e que a IA pode prescrever outra zona explicando o motivo', () => {
    const agent: any = new PrescriptionAgentService({ get: () => undefined } as any, {} as any);
    const weekly = String(agent.buildSystemPromptStable().map?.((p: any) => (typeof p === 'string' ? p : p.text)).join('\n') ?? agent.buildSystemPromptStable());
    const day = String(agent.buildRunSessionSystemPrompt());
    expect(weekly).toContain('A FC NAO e usada para prescrever');
    expect(weekly).not.toContain('FC alvo, em vez de valores genericos');
    expect(weekly).toContain('tendem a ocorrer juntas na maioria dos casos');
    expect(weekly).toContain('NAO e estimativa');
    expect(weekly).toContain('leve em zona 3 em vez de 2');
    expect(day).toContain('A FC serve so para avaliar a repercussao do treino');
    expect(day).toContain('qualquer zona diferente da esperada');
  });
});
