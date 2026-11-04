import { emptyCounters, messageFor, workoutsGuidance } from '../../mobile/src/appleHealthSync/appleHealthSyncLogic';

// 04/11/2026 — caso Andreia: a sincronizacao guardou 55 registros de saude e NENHUM treino, e a aluna nao foi avisada. Agora a mensagem diz que nenhum treino chegou e o que conferir.
describe('Apple Saude: aviso quando entram dados de saude mas nenhum treino', () => {
  const healthOnly = () => ({ ...emptyCounters(), healthStored: 55 });

  it('treinos autorizados no Panzeri Run mas nenhum chegou: manda conferir "Treinos" nos Ajustes do iPhone', () => {
    const text = messageFor('completed', healthOnly(), { workoutsGranted: true }).text;
    expect(text).toContain('55 registros de saúde guardados');
    expect(text).toContain('Nenhum treino do app Saúde chegou');
    expect(text).toContain('Ajustes → Saúde → Acesso a dados e dispositivos → Panzeri Run');
  });

  it('grupo "Treinos" nao autorizado no Panzeri Run: manda marcar nas autorizacoes', () => {
    const text = messageFor('completed', healthOnly(), { workoutsGranted: false }).text;
    expect(text).toContain('Os treinos não estão autorizados');
    expect(text).toContain('marque "Treinos"');
  });

  it('sem aviso quando ha treino (novo, ja importado ou nao enviado) ou quando nao entrou dado de saude', () => {
    for (const counters of [{ ...healthOnly(), created: 1 }, { ...healthOnly(), already: 3 }, { ...healthOnly(), enriched: 1 }, { ...healthOnly(), workoutsNotSent: 2 }, { ...emptyCounters() }]) {
      expect(workoutsGuidance(counters, { workoutsGranted: true })).toBe('');
      expect(workoutsGuidance(counters, { workoutsGranted: false })).toBe('');
    }
  });

  it('compatibilidade: sem contexto a mensagem e a de sempre (nenhum teste ou chamada antiga muda)', () => {
    const before = messageFor('completed', healthOnly());
    expect(before.ok).toBe(true);
    expect(before.text).not.toContain('Nenhum treino');
    expect(workoutsGuidance(healthOnly())).toBe('');
  });
});
