import { PhysiologyService } from '../src/physiology/physiology.service';
import { OperationalReferenceService } from '../src/physiology/operational-reference.service';
import { PrescriptionAgentService } from '../src/training-plans/prescription-agent.service';
import { fakeDb } from './helpers/fake-physiology-db';

// Validação integrada (30/10/2026): o fluxo completo da seção Testes físicos com os serviços reais e banco em memória.
// A geração com a IA real NÃO roda aqui (exige chave e banco de um ambiente validado): este teste prova o que a IA recebe e o que acontece depois.
const A = 'aluno';
const COACH = { id: 'treinador', role: 'coach' };
const NOW = new Date('2026-10-30T12:00:00Z');
const ev = (dates: string[]) => dates.map((data) => ({ data, descricao: `Treino de ${data}: ritmo acima do L2 com FC estavel e boa recuperacao` }));

describe('fluxo completo: 3 km → indicadores → referência → zonas → histórico → agentes → ajuste → nova avaliação', () => {
  it('percorre todas as etapas sem alterar as camadas originais e sem tocar em programa ou tentativas', async () => {
    const { db, t } = fakeDb({ [A]: { birthDate: new Date('1985-05-10'), sex: 'masculino' } });
    const phys = new PhysiologyService(db);
    const ref = new OperationalReferenceService(db);

    // 1-2. registro do 3 km e cálculo dos indicadores
    await phys.saveThreeKm(A, { totalSeconds: 720, maxHeartRate: 186, environment: 'rua', performedAt: '2026-10-01' });
    const profile: any = await phys.profile(A);
    expect(profile.indicators.find((i: any) => i.key === 'vo2max')).toMatchObject({ value: 47.9, origin: 'estimated' });

    // 3-4. referência operacional e zonas
    const v1 = (await ref.getAgentView(A, NOW))!;
    expect(v1).toMatchObject({ versao: 1, origemDaVersao: 'avaliacoes' });
    expect(v1.zonas).toHaveLength(5);

    // 5. histórico e dados dos gráficos
    const hist: any = await phys.history(A, {});
    expect(JSON.stringify(hist)).toContain('three_km');

    // 6. disponibilização aos agentes: prescrição (prompt), Evolução e snapshot leem a mesma fonte
    const agent: any = new PrescriptionAgentService({ get: () => undefined } as any, {} as any);
    const prompt = JSON.parse(agent.buildUserPrompt({ goal: 'x', experience: 'y', answers: {}, availability: [], history: [], physiologicalReference: v1 }, [], [], false, false, {}, null));
    expect(prompt.referenciaFisiologicaOperacional).toMatchObject({ versao: 1, fonte: 'referencia_operacional' });
    expect((await ref.evolutionInput(A))!.referenciaAtual).toBeDefined();

    const original = JSON.stringify([t.fitness, t.assess, t.ind]);

    // 8. ajuste fundamentado nos treinos: 3 observações em 3 dias seguidos bastam para PODER propor (sem cobertura mínima nem intervalo)
    const adj = { indicadores: [{ chave: 'l2_speed_kmh', novoValor: 13.9 }], evidencias: ev(['2026-10-20', '2026-10-21', '2026-10-22']), justificativa: 'Sustenta ritmos acima do L2 estimado, FC estavel, recuperacao boa.', proposedBy: 'prescription_agent' };
    expect(await ref.proposeAdjustment(A, adj, NOW)).toMatchObject({ accepted: true, version: 2 });
    // sem bloqueio de tempo: outro ajuste logo depois, mas só com observação nova
    expect((await ref.proposeAdjustment(A, { ...adj, indicadores: [{ chave: 'l2_speed_kmh', novoValor: 14.1 }] }, NOW)).accepted).toBe(false);
    const fresh = await ref.proposeAdjustment(A, { ...adj, indicadores: [{ chave: 'l2_speed_kmh', novoValor: 14.1 }], evidencias: ev(['2026-10-21', '2026-10-22', '2026-11-02']) }, new Date('2026-11-03T12:00:00Z'));
    expect(fresh.accepted).toBe(true);
    expect(JSON.stringify([t.fitness, t.assess, t.ind])).toBe(original); // resultados e indicadores originais intactos
    expect(t.ref.map((r: any) => r.source)).toEqual(['tests', 'ai_adjustment', 'ai_adjustment']); // histórico completo preservado

    // 7. avaliação externa (ergoespirometria) depois do 3 km: vira a referência e supera os ajustes anteriores, que permanecem no histórico
    await phys.recordExternal(A, { method: 'ergospirometry', performedAt: '2026-10-29', results: { vo2max: 57, vvo2max_kmh: 17.2, hrmax_bpm: 189 } }, COACH);
    const v4 = (await ref.getAgentView(A, new Date('2026-10-31T12:00:00Z')))!;
    expect(v4.origemDaVersao).toBe('avaliacoes');
    expect(v4.ajustesDaIADesdeAUltimaAvaliacao).toHaveLength(0);
    expect(t.ref).toHaveLength(4);

    // nada disso gera programa nem gasta tentativa (a fake não tem essas tabelas)
    expect(t.touched).not.toContain('trainingPlan');
  });

  it('aluno com 3 km antigo (modelo da equação anterior): a leitura recalcula pelo modelo vigente, sem gravar nada', async () => {
    const { db, t } = fakeDb({ [A]: { birthDate: new Date('1985-05-10'), sex: 'masculino' } });
    t.fitness.push({ id: 'old1', userId: A, testType: '3km', totalSeconds: 720, vo2max: 40.1, maxHeartRate: 186, createdAt: new Date('2026-06-01T12:00:00Z'), modelVersion: null });
    const ref = new OperationalReferenceService(db);
    const view = (await ref.getAgentView(A, NOW))!;
    expect(view.fonte).toBe('teste_de_3km_recalculado_na_leitura');
    expect(view.indicadores.find((i) => i.indicador === 'vo2max')!.valor).toBe(47.9);
    expect(t.fitness[0].vo2max).toBe(40.1);
    expect(t.assess).toHaveLength(0);
  });
});
