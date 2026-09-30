// Sistema de Medalhas (30/09/2026) — catálogo determinístico do que já foi aprovado em
// SISTEMA_DE_MEDALHAS.md. Isto é DADO, não lógica: nenhuma decisão de treino/prescrição vive
// aqui, só a definição estável de cada medalha (código, categoria, limiar, unidade, grau,
// critérios estruturados). O `MedalEvaluationService` lê este catálogo e compara contra as fontes
// canônicas já existentes — nunca o contrário.
//
// REGRA CENTRAL (preservada em cada família abaixo, ver SISTEMA_DE_MEDALHAS.md):
// - Medalhas de REALIZAÇÃO (constância, treinos, volume, distância, acumulado, provas, retomada)
//   usam o EXECUTADO, nunca o prescrito.
// - Medalhas de ADERÊNCIA comparam executado × prescrito pela fórmula canônica
//   (`realizado ÷ elegível`, extra fora do denominador — ver evolution-metric.service.ts).
// - Medalhas de PARTICIPAÇÃO/PROCESSO (feedbacks, check-ins, reavaliações) contam a ação
//   efetivamente concluída, nunca sua disponibilidade nem seu conteúdo.
//
// Seed real no banco (Achievement) é responsabilidade de um script de seed separado, que lê este
// arquivo como única fonte — nunca duplicar esta lista em SQL ou em outro lugar do código.

export type MedalCategory =
  | 'constancia'
  | 'aderencia'
  | 'treinos_concluidos'
  | 'volume_semanal'
  | 'sustentacao_volume'
  | 'volume_mensal'
  | 'distancia_unica'
  | 'acumulado'
  | 'feedbacks'
  | 'checkins'
  | 'reavaliacoes'
  | 'provas'
  | 'retomada';

export type MedalGrau = 'bronze' | 'prata' | 'ouro' | 'platina' | 'diamante' | 'lendaria';

export interface MedalDefinition {
  /** Estável para sempre — nunca renomear um code já com conquistas reais no banco. */
  code: string;
  category: MedalCategory;
  name: string;
  description: string;
  /** Atributo visual/de dificuldade — nunca pontuação fisiológica (ver seção 15 da spec). */
  grau: MedalGrau;
  threshold: number | null;
  unit: string | null;
  ruleVersion: number;
  criteria: Record<string, unknown>;
  /** Ordem dentro da própria categoria — usada pra progressão/"próxima conquista", nunca pra escolher sozinha qual mostrar. */
  sortOrder: number;
  active: boolean;
}

/**
 * Grau por posição dentro de uma progressão (1º marco = bronze, último = lendária/diamante
 * dependendo do tamanho da família). Puramente visual — nunca reutilizado como score fisiológico.
 */
function tierGrau(index: number, total: number): MedalGrau {
  const bands: MedalGrau[] = ['bronze', 'prata', 'ouro', 'platina', 'diamante', 'lendaria'];
  const position = total <= 1 ? bands.length - 1 : Math.round((index / (total - 1)) * (bands.length - 1));
  return bands[Math.min(position, bands.length - 1)];
}

function km(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value).replace('.', '_');
}

// ---------------------------------------------------------------------------------------------
// 1. Constância — semana válida = ≥1 sessão EFETIVAMENTE CONCLUÍDA (nunca só "com registro").
// ---------------------------------------------------------------------------------------------
const CONSTANCIA_SEMANAS = [1, 2, 4, 8, 12, 16, 24, 36, 52, 100];
const constanciaMedals: MedalDefinition[] = CONSTANCIA_SEMANAS.map((n, i) => ({
  code: `constancia_semanas_${n}`,
  category: 'constancia',
  name: n === 1 ? '1ª semana' : `${n} semanas consecutivas`,
  description: `Pelo menos 1 sessão efetivamente concluída em ${n} semana(s) consecutiva(s).`,
  grau: tierGrau(i, CONSTANCIA_SEMANAS.length),
  threshold: n,
  unit: 'semanas',
  ruleVersion: 1,
  criteria: { consecutiveWeeks: n, requireCompletedSession: true },
  sortOrder: i,
  active: true,
}));

// ---------------------------------------------------------------------------------------------
// 2. Aderência — realizado ÷ elegível (extra fora do denominador). Avaliação ativada só na etapa
// 6 do plano de implementação (depois da correção de divergência canônica validada em produção).
// ---------------------------------------------------------------------------------------------
const ADERENCIA_STREAKS = [4, 8, 12, 24, 52];
const aderenciaMedals: MedalDefinition[] = [
  {
    code: 'aderencia_primeira_semana_90',
    category: 'aderencia',
    name: 'Primeira semana ≥90%',
    description: 'Primeira semana com aderência (realizado ÷ elegível) de pelo menos 90%.',
    grau: 'bronze',
    // threshold em SEMANAS (1), igual aos demais da família — nunca o valor de % em si (esse fica
    // em criteria.minAdherencePercent). Consistência exigida pelo motor de avaliação, que trata
    // toda a família como "streak de N semanas consecutivas ≥90%", incluindo N=1.
    threshold: 1,
    unit: 'semanas',
    ruleVersion: 1,
    criteria: { minAdherencePercent: 90, consecutiveWeeks: 1 },
    sortOrder: 0,
    active: true,
  },
  ...ADERENCIA_STREAKS.map((n, i) => ({
    code: `aderencia_semanas_90_${n}`,
    category: 'aderencia' as const,
    name: `${n} semanas consecutivas ≥90%`,
    description: `Aderência de pelo menos 90% sustentada por ${n} semanas consecutivas.`,
    grau: tierGrau(i, ADERENCIA_STREAKS.length),
    threshold: n,
    unit: 'semanas',
    ruleVersion: 1,
    criteria: { minAdherencePercent: 90, consecutiveWeeks: n },
    sortOrder: i + 1,
    active: true,
  })),
  {
    code: 'aderencia_semana_perfeita',
    category: 'aderencia',
    name: 'Semana perfeita',
    description: '100% das sessões prescritas concluídas numa semana com pelo menos 2 sessões prescritas.',
    grau: 'ouro',
    threshold: 100,
    unit: '%',
    ruleVersion: 1,
    criteria: { minAdherencePercent: 100, minPrescribedSessions: 2 },
    sortOrder: ADERENCIA_STREAKS.length + 1,
    active: true,
  },
];

// ---------------------------------------------------------------------------------------------
// 3. Treinos concluídos — acumulativo, all-time, execução real (status done/adjusted).
// ---------------------------------------------------------------------------------------------
const TREINOS_CONCLUIDOS = [1, 5, 10, 25, 50, 100, 250, 500, 1000];
const treinosConcluidosMedals: MedalDefinition[] = TREINOS_CONCLUIDOS.map((n, i) => ({
  code: `treinos_concluidos_${n}`,
  category: 'treinos_concluidos',
  name: `${n} treino${n > 1 ? 's' : ''} concluído${n > 1 ? 's' : ''}`,
  description: `${n} sessões efetivamente concluídas (status done/adjusted), acumulado.`,
  grau: tierGrau(i, TREINOS_CONCLUIDOS.length),
  threshold: n,
  unit: 'treinos',
  ruleVersion: 1,
  criteria: { totalCompletedSessions: n },
  sortOrder: i,
  active: true,
}));

// ---------------------------------------------------------------------------------------------
// 4. Volume semanal de corrida — km EFETIVAMENTE REALIZADOS (corrida/esteira), semana ENCERRADA.
// ---------------------------------------------------------------------------------------------
const VOLUME_SEMANAL_KM = [10, 20, 30, 40, 50, 60, 75, 100];
const volumeSemanalMedals: MedalDefinition[] = VOLUME_SEMANAL_KM.map((n, i) => ({
  code: `volume_semanal_corrida_${km(n)}km`,
  category: 'volume_semanal',
  name: `${n}km numa semana`,
  description: `Primeira semana encerrada com ${n}km efetivamente realizados em corrida/esteira.`,
  grau: tierGrau(i, VOLUME_SEMANAL_KM.length),
  threshold: n,
  unit: 'km',
  ruleVersion: 1,
  criteria: { modality: ['corrida', 'esteira'], periodType: 'week_closed' },
  sortOrder: i,
  active: true,
}));

// ---------------------------------------------------------------------------------------------
// 5. Sustentação de volume semanal — família própria: patamar × nº de semanas CONSECUTIVAS.
// Uma semana de 43km conta pras sequências de 20/30/40km ao mesmo tempo (múltiplos patamares
// avaliados independentemente sobre a MESMA série semanal), mas nunca pra 50km.
// ---------------------------------------------------------------------------------------------
const SUSTENTACAO_PATAMARES = [20, 30, 40, 50, 75, 100];
const SUSTENTACAO_SEMANAS = [2, 4, 6, 8, 10];
const sustentacaoVolumeMedals: MedalDefinition[] = SUSTENTACAO_PATAMARES.flatMap((patamar, pIdx) =>
  SUSTENTACAO_SEMANAS.map((semanas, sIdx) => ({
    code: `sustentacao_volume_corrida_${km(patamar)}km_${semanas}_semanas`,
    category: 'sustentacao_volume' as const,
    name: `${patamar}km/semana por ${semanas} semanas`,
    description: `Pelo menos ${patamar}km efetivamente realizados em corrida/esteira por ${semanas} semanas consecutivas.`,
    grau: tierGrau(pIdx * SUSTENTACAO_SEMANAS.length + sIdx, SUSTENTACAO_PATAMARES.length * SUSTENTACAO_SEMANAS.length),
    threshold: semanas,
    unit: 'semanas',
    ruleVersion: 1,
    criteria: { modality: ['corrida', 'esteira'], weeklyKmThreshold: patamar, consecutiveWeeks: semanas },
    sortOrder: pIdx * SUSTENTACAO_SEMANAS.length + sIdx,
    active: true,
  })),
);

// ---------------------------------------------------------------------------------------------
// 6. Volume mensal de corrida — km EFETIVAMENTE REALIZADOS, mês-calendário completo.
// ---------------------------------------------------------------------------------------------
const VOLUME_MENSAL_KM = [25, 50, 75, 100, 125, 150, 175, 200, 250, 300, 400, 500, 750];
const volumeMensalMedals: MedalDefinition[] = VOLUME_MENSAL_KM.map((n, i) => ({
  code: `volume_mensal_corrida_${km(n)}km`,
  category: 'volume_mensal',
  name: `${n}km no mês`,
  description: `Mês-calendário completo com ${n}km efetivamente realizados em corrida/esteira.`,
  grau: tierGrau(i, VOLUME_MENSAL_KM.length),
  threshold: n,
  unit: 'km',
  ruleVersion: 1,
  // recommendedAsNextGoal=false pros patamares muito altos — nunca vira "próximo objetivo"
  // sugerido pra quem está longe disso (ver seção 16 da spec), mesmo existindo no catálogo.
  criteria: { modality: ['corrida', 'esteira'], periodType: 'month_calendar', recommendedAsNextGoal: n <= 200 },
  sortOrder: i,
  active: true,
}));

// ---------------------------------------------------------------------------------------------
// 7. Distância em uma única corrida — distância EFETIVAMENTE REALIZADA naquela sessão.
// ---------------------------------------------------------------------------------------------
const DISTANCIA_UNICA_KM: Array<{ value: number; label?: string }> = [
  { value: 3 }, { value: 5 }, { value: 8 }, { value: 10 }, { value: 12 }, { value: 15 },
  { value: 18 }, { value: 21.1, label: 'Meia distância' }, { value: 25 }, { value: 30 },
  { value: 35 }, { value: 42.195, label: 'Maratona' }, { value: 50, label: 'Ultramaratona' },
];
const distanciaUnicaMedals: MedalDefinition[] = DISTANCIA_UNICA_KM.map(({ value, label }, i) => ({
  code: `distancia_unica_corrida_${km(value)}km`,
  category: 'distancia_unica',
  name: label ?? `${value}km numa corrida`,
  description: `Primeira sessão com ${value}km efetivamente realizados em corrida/esteira${label ? ` (${label})` : ''}.`,
  grau: tierGrau(i, DISTANCIA_UNICA_KM.length),
  threshold: value,
  unit: 'km',
  ruleVersion: 1,
  // Para o Panzeri Run, ultramaratona começa em 50km — nunca "qualquer coisa acima da maratona".
  criteria: { modality: ['corrida', 'esteira'], specialLabel: label ?? null },
  sortOrder: i,
  active: true,
}));

// ---------------------------------------------------------------------------------------------
// 8. Quilometragem acumulada — soma de toda distância EFETIVAMENTE REALIZADA, all-time.
// ---------------------------------------------------------------------------------------------
const ACUMULADO_KM = [100, 250, 500, 1000, 2500, 5000, 10000];
const acumuladoMedals: MedalDefinition[] = ACUMULADO_KM.map((n, i) => ({
  code: `acumulado_corrida_${km(n)}km`,
  category: 'acumulado',
  name: `${n}km acumulados`,
  description: `${n}km efetivamente realizados em corrida/esteira, somados desde o início do acompanhamento.`,
  grau: tierGrau(i, ACUMULADO_KM.length),
  threshold: n,
  unit: 'km',
  ruleVersion: 1,
  criteria: { modality: ['corrida', 'esteira'], periodType: 'all_time' },
  sortOrder: i,
  active: true,
}));

// ---------------------------------------------------------------------------------------------
// 9. Feedbacks pós-treino — premia FORNECER a resposta, nunca o conteúdo dela.
// ---------------------------------------------------------------------------------------------
const FEEDBACKS_N = [1, 5, 10, 25, 50, 100, 200, 365];
const feedbacksMedals: MedalDefinition[] = FEEDBACKS_N.map((n, i) => ({
  code: `feedbacks_${n}`,
  category: 'feedbacks',
  name: `${n} feedback${n > 1 ? 's' : ''} pós-treino`,
  description: `${n} feedbacks de treino efetivamente enviados (qualquer conteúdo vale igual), acumulado.`,
  grau: tierGrau(i, FEEDBACKS_N.length),
  threshold: n,
  unit: 'feedbacks',
  ruleVersion: 1,
  criteria: { totalWorkoutCompletionsWithFeedback: n },
  sortOrder: i,
  active: true,
}));

// ---------------------------------------------------------------------------------------------
// 10. Check-ins semanais — questionário semanal do Panzeri Run (não é o feedback pós-treino).
// ---------------------------------------------------------------------------------------------
const CHECKINS_N = [4, 12, 24, 52];
const checkinsMedals: MedalDefinition[] = CHECKINS_N.map((n, i) => ({
  code: `checkins_${n}`,
  category: 'checkins',
  name: `${n} check-ins semanais`,
  description: `${n} check-ins semanais efetivamente respondidos (não pulados), acumulado.`,
  grau: tierGrau(i, CHECKINS_N.length),
  threshold: n,
  unit: 'checkins',
  ruleVersion: 1,
  criteria: { totalRealCheckins: n },
  sortOrder: i,
  active: true,
}));

// ---------------------------------------------------------------------------------------------
// 11. Reavaliações — só reavaliações periódicas LEGÍTIMAS (Reassessment.completedAt).
// ---------------------------------------------------------------------------------------------
const REAVALIACOES_N = [1, 2, 4, 6, 8];
const reavaliacoesMedals: MedalDefinition[] = REAVALIACOES_N.map((n, i) => ({
  code: `reavaliacoes_${n}`,
  category: 'reavaliacoes',
  name: n === 1 ? '1ª reavaliação' : `${n} reavaliações`,
  description: `${n} reavaliação(ões) periódica(s) efetivamente concluída(s).`,
  grau: tierGrau(i, REAVALIACOES_N.length),
  threshold: n,
  unit: 'reavaliacoes',
  ruleVersion: 1,
  criteria: { totalCompletedReassessments: n },
  sortOrder: i,
  active: true,
}));

// ---------------------------------------------------------------------------------------------
// 12. Provas e grandes marcos — DOCUMENTADAS, avaliação DESLIGADA (active=false) enquanto
// TargetRace.status='concluida' (autodeclarado, sem verificação cruzada) for a única evidência
// disponível — ver SISTEMA_DE_MEDALHAS.md, "ativação adiada".
// ---------------------------------------------------------------------------------------------
const PROVAS: Array<{ code: string; name: string; minKm?: number; maxKm?: number }> = [
  { code: 'primeira_prova', name: 'Primeira prova' },
  { code: 'primeira_prova_5km', name: 'Primeira prova de 5km', minKm: 4.5, maxKm: 5.5 },
  { code: 'primeira_prova_10km', name: 'Primeira prova de 10km', minKm: 9.5, maxKm: 10.5 },
  { code: 'primeira_prova_15km', name: 'Primeira prova de 15km', minKm: 14.5, maxKm: 15.5 },
  { code: 'primeira_meia_maratona', name: 'Primeira meia maratona', minKm: 20.5, maxKm: 21.5 },
  { code: 'primeira_maratona', name: 'Primeira maratona', minKm: 41.5, maxKm: 42.5 },
  { code: 'primeira_ultramaratona', name: 'Primeira ultramaratona', minKm: 50 },
];
const provasMedals: MedalDefinition[] = PROVAS.map((p, i) => ({
  code: `provas_${p.code}`,
  category: 'provas',
  name: p.name,
  description: `${p.name} — conclusão comprovada/registrada (agendar não conta).`,
  grau: tierGrau(i, PROVAS.length),
  threshold: null,
  unit: null,
  ruleVersion: 1,
  criteria: { minKm: p.minKm ?? null, maxKm: p.maxKm ?? null, requiresConfirmedCompletion: true },
  sortOrder: i,
  active: false, // ver nota acima — ativação adiada
}));

// ---------------------------------------------------------------------------------------------
// 13. Retomada — gap ≥14 dias (GAP_RETURN_THRESHOLD_DAYS já existe em context-events) + retorno.
// ---------------------------------------------------------------------------------------------
const retomadaMedals: MedalDefinition[] = [
  {
    code: 'retomada_voltei',
    category: 'retomada',
    name: 'Voltei',
    description: 'Primeiro treino efetivamente concluído após uma pausa de 14 dias ou mais.',
    grau: 'bronze',
    threshold: null,
    unit: null,
    ruleVersion: 1,
    criteria: { gapDays: 14, milestone: 'first_session_back' },
    sortOrder: 0,
    active: true,
  },
  {
    code: 'retomada_2_semanas',
    category: 'retomada',
    name: '2 semanas de volta',
    description: '2 semanas consecutivas de participação após o retorno de uma pausa.',
    grau: 'prata',
    threshold: 2,
    unit: 'semanas',
    ruleVersion: 1,
    criteria: { gapDays: 14, consecutiveWeeksAfterReturn: 2 },
    sortOrder: 1,
    active: true,
  },
  {
    code: 'retomada_4_semanas',
    category: 'retomada',
    name: '4 semanas de volta',
    description: '4 semanas consecutivas de participação após o retorno de uma pausa — encerra o episódio de retomada.',
    grau: 'ouro',
    threshold: 4,
    unit: 'semanas',
    ruleVersion: 1,
    criteria: { gapDays: 14, consecutiveWeeksAfterReturn: 4 },
    sortOrder: 2,
    active: true,
  },
];

export const MEDAL_CATALOG: MedalDefinition[] = [
  ...constanciaMedals,
  ...aderenciaMedals,
  ...treinosConcluidosMedals,
  ...volumeSemanalMedals,
  ...sustentacaoVolumeMedals,
  ...volumeMensalMedals,
  ...distanciaUnicaMedals,
  ...acumuladoMedals,
  ...feedbacksMedals,
  ...checkinsMedals,
  ...reavaliacoesMedals,
  ...provasMedals,
  ...retomadaMedals,
];

export function getMedalCategoryCatalog(category: MedalCategory): MedalDefinition[] {
  return MEDAL_CATALOG.filter((m) => m.category === category).sort((a, b) => a.sortOrder - b.sortOrder);
}
