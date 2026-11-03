import { FEELING_DOMAINS, WEARABLE_SLEEP_VARIABLES } from '../../mobile/home/insights';
import { INDICATOR_MEANINGS, MEANING_FOOTER, meaningOf } from '../../mobile/home/indicatorMeanings';

// 02/11/2026 — "O que isso representa": rascunho de textos fixos por indicador (revisao de Elton e do advogado pendente). Estas verificacoes protegem as REGRAS de redacao combinadas, nao o conteudo.
// Indicadores que a tela mostra com explicacao, alem dos de FEELING_DOMAINS e do relogio:
const OTHER_DISPLAYED_IDS = [
  'load.weekly', 'load.acuteChronic', 'training.acwr', 'activity.avgHeartRateBpm', 'workout.sessionInternalLoad',
  'training.volume', 'training.volumeDiffAbsoluteKm', 'training.volumeRatioCompletedPrescribed', 'activity.cadenceAvg', 'activity.avgPaceSecondsKm', 'activity.weeklyAvgPaceSecondsKm', 'execution.timeInBandPct',
  'training.adherencePercent', 'pain.perWorkout', 'pain.reports', 'checkin.weekDemandVsNormal',
];

describe('textos "O que isso representa"', () => {
  const shownIds = [...new Set([
    ...Object.values(FEELING_DOMAINS).flatMap((d) => d.variables.map((v) => v.id)),
    ...WEARABLE_SLEEP_VARIABLES.map((v) => v.id),
    ...OTHER_DISPLAYED_IDS,
  ])];

  it('todo indicador mostrado na Evolucao tem explicacao escrita (nenhum bloco some por esquecimento)', () => {
    const missing = shownIds.filter((id) => meaningOf(id) == null);
    expect(missing).toEqual([]);
  });

  it('nao ha explicacao orfa: todo texto pertence a um indicador que a tela mostra', () => {
    const orphans = Object.keys(INDICATOR_MEANINGS).filter((id) => !shownIds.includes(id));
    expect(orphans).toEqual([]);
  });

  it('respeita o vocabulario do produto: "programa" (nunca "plano de treino") e nunca "motor"', () => {
    for (const [id, text] of Object.entries(INDICATOR_MEANINGS)) {
      expect({ id, hit: /plano de treino|\bmotor\b/i.test(text) }).toEqual({ id, hit: false });
    }
    expect(/plano de treino|\bmotor\b/i.test(MEANING_FOOTER)).toBe(false);
  });

  it('inferencia com fonte e cautela, nunca causa direta nem promessa ("vai se lesionar", "garante", "certamente")', () => {
    for (const [id, text] of Object.entries(INDICATOR_MEANINGS)) {
      expect({ id, hit: /vai se lesionar|vai lesionar|causa lesão|garante|certamente|com certeza|sempre leva/i.test(text) }).toEqual({ id, hit: false });
    }
  });

  it('cada texto tem tamanho legivel no celular (entre 120 e 750 caracteres) e o rodape avisa que nao e diagnostico nem analise isolada', () => {
    for (const [id, text] of Object.entries(INDICATOR_MEANINGS)) {
      expect({ id, ok: text.length >= 120 && text.length <= 750 }).toEqual({ id, ok: true });
    }
    expect(MEANING_FOOTER).toContain('Nenhum indicador é analisado sozinho');
    expect(MEANING_FOOTER).toContain('não é diagnóstico');
  });

  it('indicadores de dor reforcam que nao substitui profissional de saude; dados de relogio avisam que dependem do aparelho', () => {
    expect(meaningOf('pain.reports')).toContain('profissional de saúde');
    for (const id of ['wearable.sleepDeepMin', 'wearable.sleepScore', 'wearable.hrvLastNightAvg']) {
      expect(meaningOf(id)).toMatch(/aparelho|fabricante|marca/i);
    }
  });

  it('id sem texto devolve null (a tela nao mostra bloco vazio)', () => {
    expect(meaningOf('inexistente')).toBeNull();
    expect(meaningOf(undefined)).toBeNull();
  });
});
