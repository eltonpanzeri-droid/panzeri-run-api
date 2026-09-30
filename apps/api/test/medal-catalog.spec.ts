import { MEDAL_CATALOG, getMedalCategoryCatalog } from '../src/medals/medal-catalog';

// Sistema de Medalhas (30/09/2026) — catálogo é DADO puro, sem lógica de negócio. Estes testes
// garantem integridade estrutural (codes estáveis/únicos, contagens batendo com a especificação
// aprovada em SISTEMA_DE_MEDALHAS.md) — nunca testam "se o aluno merece a medalha" (isso é
// MedalEvaluationService).

describe('MEDAL_CATALOG — integridade estrutural', () => {
  it('todo code é único — nunca duas medalhas com o mesmo identificador estável', () => {
    const codes = MEDAL_CATALOG.map((m) => m.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('nenhum code vazio ou com espaço (precisa ser estável e seguro como identificador de banco)', () => {
    for (const m of MEDAL_CATALOG) {
      expect(m.code).toMatch(/^[a-z0-9_.]+$/);
    }
  });

  it('total de medalhas bate com a especificação aprovada (30/09/2026)', () => {
    // 10 constância + 7 aderência + 9 treinos + 8 volume semanal + 30 sustentação (6x5) +
    // 13 volume mensal + 13 distância única + 7 acumulado + 8 feedbacks + 4 check-ins +
    // 5 reavaliações + 7 provas + 3 retomada = 124
    expect(MEDAL_CATALOG).toHaveLength(124);
  });

  it('constância: 10 marcos, 1ª semana e 100 semanas presentes nas pontas', () => {
    const constancia = getMedalCategoryCatalog('constancia');
    expect(constancia).toHaveLength(10);
    expect(constancia[0].threshold).toBe(1);
    expect(constancia[constancia.length - 1].threshold).toBe(100);
  });

  it('sustentação de volume: 30 combinações (6 patamares x 5 durações), cada uma com criteria correto', () => {
    const sustentacao = getMedalCategoryCatalog('sustentacao_volume');
    expect(sustentacao).toHaveLength(30);
    const patamar30x4semanas = sustentacao.find(
      (m) => (m.criteria as { weeklyKmThreshold: number }).weeklyKmThreshold === 30 && m.threshold === 4,
    );
    expect(patamar30x4semanas).toBeDefined();
    expect(patamar30x4semanas?.code).toBe('sustentacao_volume_corrida_30km_4_semanas');
  });

  it('distância única: nomenclaturas especiais corretas (meia, maratona, ultramaratona a partir de 50km)', () => {
    const distancia = getMedalCategoryCatalog('distancia_unica');
    const meia = distancia.find((m) => m.threshold === 21.1);
    const maratona = distancia.find((m) => m.threshold === 42.195);
    const ultra = distancia.find((m) => m.threshold === 50);
    expect(meia?.name).toBe('Meia distância');
    expect(maratona?.name).toBe('Maratona');
    expect(ultra?.name).toBe('Ultramaratona');
    // nenhuma medalha entre 42.195 (exclusive) e 50 (exclusive) chamada de ultramaratona —
    // regra do Panzeri Run: ultra começa em 50km, não logo acima da maratona.
    const between = distancia.filter((m) => (m.threshold ?? 0) > 42.195 && (m.threshold ?? 0) < 50);
    expect(between.every((m) => m.name !== 'Ultramaratona')).toBe(true);
  });

  it('volume mensal: patamares muito altos existem no catálogo mas marcados como não-recomendados', () => {
    const mensal = getMedalCategoryCatalog('volume_mensal');
    const alto = mensal.find((m) => m.threshold === 750);
    expect(alto).toBeDefined();
    expect((alto?.criteria as { recommendedAsNextGoal: boolean }).recommendedAsNextGoal).toBe(false);
    const baixo = mensal.find((m) => m.threshold === 100);
    expect((baixo?.criteria as { recommendedAsNextGoal: boolean }).recommendedAsNextGoal).toBe(true);
  });

  it('provas: nenhuma medalha por QUANTIDADE de provas (nunca "5 provas"/"10 provas")', () => {
    const provas = getMedalCategoryCatalog('provas');
    expect(provas).toHaveLength(7);
    expect(provas.every((m) => !/\d+\s*provas/i.test(m.name))).toBe(true);
  });

  it('provas: todas desativadas (avaliação automática adiada — evidência é autodeclarada)', () => {
    const provas = getMedalCategoryCatalog('provas');
    expect(provas.every((m) => m.active === false)).toBe(true);
  });

  it('nenhuma outra categoria está desativada por padrão (só provas)', () => {
    const activeByCategory = new Set(MEDAL_CATALOG.filter((m) => !m.active).map((m) => m.category));
    expect([...activeByCategory]).toEqual(['provas']);
  });

  it('retomada: 3 medalhas na ordem Voltei -> 2 semanas -> 4 semanas', () => {
    const retomada = getMedalCategoryCatalog('retomada');
    expect(retomada.map((m) => m.code)).toEqual(['retomada_voltei', 'retomada_2_semanas', 'retomada_4_semanas']);
  });

  it('aderência: primeira semana + 5 streaks + semana perfeita = 7 medalhas', () => {
    const aderencia = getMedalCategoryCatalog('aderencia');
    expect(aderencia).toHaveLength(7);
    expect(aderencia.some((m) => m.code === 'aderencia_semana_perfeita')).toBe(true);
  });

  it('cada medalha tem grau válido dentre os 6 definidos', () => {
    const GRAUS = ['bronze', 'prata', 'ouro', 'platina', 'diamante', 'lendaria'];
    for (const m of MEDAL_CATALOG) {
      expect(GRAUS).toContain(m.grau);
    }
  });

  it('sortOrder é único dentro de cada categoria (progressão bem definida)', () => {
    const categories = new Set(MEDAL_CATALOG.map((m) => m.category));
    for (const category of categories) {
      const orders = getMedalCategoryCatalog(category).map((m) => m.sortOrder);
      expect(new Set(orders).size).toBe(orders.length);
    }
  });
});
