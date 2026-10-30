// Referência operacional (Testes físicos, Lote 4, 30/10/2026). Funções PURAS: montam a visão que os agentes de IA recebem e validam propostas de
// ajuste. Nada aqui decide treino: a referência é DADO rotulado; quem prescreve é a IA, que pode se afastar dela com justificativa.
import { formatPaceSeconds, kmhToPaceSeconds, zonesFrom, type Zone } from './physiology-models';
import { INDICATOR_UNITS, METHOD_LABELS, parsePerformedAt, type CanonicalKey } from './physiology-input';

export const ADJUSTABLE_KEYS = ['vvo2max_kmh', 'hrmax_bpm', 'l1_speed_kmh', 'l1_hr_bpm', 'l2_speed_kmh', 'l2_hr_bpm'] as const;
export type AdjustableKey = (typeof ADJUSTABLE_KEYS)[number];

// Salvaguarda de PROCESSO para alterar a referência (30/10/2026, decisão de Elton): mínimo de observações em datas diferentes para a IA PODER propor.
// Não há cobertura mínima de dias nem intervalo entre ajustes: a qualidade, a consistência e a comparabilidade das observações são avaliadas pela IA.
// Único freio entre ajustes sucessivos: uma nova proposta precisa trazer ao menos uma observação posterior ao ajuste anterior (evidência nova, nunca a mesma reaproveitada).
export const MIN_EVIDENCE_ITEMS = 3;

export interface PayloadIndicator {
  key: string; value: number; unit: string; origin: string; confidence: string; rangeLow?: number | null; rangeHigh?: number | null;
  pace?: string; paceSecondsPerKm?: number; from?: { assessmentId?: string; method: string; performedAt: string; fromReference?: boolean };
  adjustment?: { previousValue: number };
}
export interface ReferencePayload {
  reference?: { assessmentId: string; method: string; methodLabel?: string; performedAt: string; reason?: string; gapDays?: number | null; label?: string };
  indicators: PayloadIndicator[]; zones: Zone[] | null; limitations?: string[]; modelVersion?: string; signature?: string;
  adjustment?: { proposedBy: string; evidencias: Array<{ data: string; descricao: string }>; justificativa: string; changes: Array<{ key: string; from: number; to: number }>; basedOnVersion: number };
}
export interface ReferenceRow { version: number; source: string; createdAt: Date; justification: string; payload: ReferencePayload }

const LABELS: Record<string, string> = {
  vo2max: 'VO₂máx estimado ou medido', vvo2max_kmh: 'Velocidade no VO₂máx', hrmax_bpm: 'FC máxima', l1_speed_kmh: 'Velocidade no L1', l1_hr_bpm: 'FC no L1', l1_vo2: 'VO₂ no L1',
  l2_speed_kmh: 'Velocidade no L2', l2_hr_bpm: 'FC no L2', l2_vo2: 'VO₂ no L2',
};
const ORIGIN_PT: Record<string, string> = { measured: 'medido', reported: 'informado pelo aluno', estimated: 'estimado por modelo', adjusted: 'ajustado pela analise dos treinos' };
const dateKey = (d: Date) => d.toISOString().slice(0, 10);
const daysBetween = (a: Date, b: Date) => Math.floor((Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()) - Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate())) / 86_400_000);

export const REFERENCE_USE_NOTICE =
  'Estas sao REFERENCIAS fisiologicas rotuladas (origem, confianca e faixa), nao limites e nao ordens. Sao estimativas de FAIXAS onde ocorrem alteracoes fisiologicas que nao acontecem todas juntas (ventilatoria, lactato, FC), e podem estar super ou subestimadas; temperatura, umidade, inclinacao, estado do aluno e fadiga as deslocam dentro da sessao. Pese-as junto com os ritmos realmente executados, a FC nos treinos (so para avaliar como o treino repercutiu, nunca para prescrever), a percepcao de esforco, a recuperacao, o historico e a evolucao. Se os treinos recentes mostrarem que o aluno esta acima ou abaixo da referencia, siga os treinos e, havendo evidencia consistente, proponha o ajuste em ajusteDeReferenciaFisiologica. Valor "estimado" de limiar tem incerteza; "medido" (ergoespirometria, lactato) merece mais peso; nunca trate um numero isolado como diagnostico.';

export interface AgentReferenceView {
  fonte: 'referencia_operacional' | 'teste_de_3km_recalculado_na_leitura';
  versao: number | null;
  origemDaVersao: 'avaliacoes' | 'ajuste_da_ia' | 'ajuste_do_treinador' | 'legado';
  avaliacaoDeReferencia: { metodo: string; data: string; diasDesdeAAvaliacao: number; motivoDaEscolha: string | null } | null;
  indicadores: Array<{ indicador: string; rotulo: string; valor: number; unidade: string; pace?: string; origem: string; confianca: string; faixa?: [number, number]; valorOriginalDaAvaliacao?: number; vindoDe?: { metodo: string; data: string } }>;
  zonas: Array<{ zona: string; descricao: string; ritmoMaisRapido: string; ritmoMaisLento: string | null; fcMinima?: number; fcMaxima?: number }> | null;
  limitacoes: string[];
  ajustesDaIADesdeAUltimaAvaliacao: Array<{ data: string; propostoPor: string; justificativa: string; mudancas: Array<{ indicador: string; de: number; para: number }> }>;
  aviso: string;
}

const METHOD_PT = (m: string) => METHOD_LABELS[m] ?? m;
// Versões gravadas antes das 6 zonas (30/10/2026) trazem 3 zonas: as zonas são DERIVADAS dos indicadores, então são recalculadas na leitura (nada gravado é alterado).
export function withCurrentZones(payload: ReferencePayload): ReferencePayload {
  if (!payload.zones || payload.zones.length !== 3) return payload;
  const val = (k: string) => payload.indicators.find((i) => i.key === k)?.value ?? null;
  const l1 = val('l1_speed_kmh'), l2 = val('l2_speed_kmh'), top = val('vvo2max_kmh');
  return l1 != null && l2 != null && top != null ? { ...payload, zones: zonesFrom({ l1, l2, vvo2: top, l1Hr: val('l1_hr_bpm'), l2Hr: val('l2_hr_bpm'), hrMax: val('hrmax_bpm') }) } : payload;
}

const toZones = (zones: Zone[] | null): AgentReferenceView['zonas'] =>
  zones ? zones.map((z) => ({ zona: z.id, descricao: z.label, ritmoMaisRapido: z.open === 'fast' ? 'sem limite' : formatPaceSeconds(z.paceSecondsPerKm[0]) + '/km', ritmoMaisLento: z.open === 'fast' ? formatPaceSeconds(z.paceSecondsPerKm[0]) + '/km' : z.paceSecondsPerKm[1] === null ? null : formatPaceSeconds(z.paceSecondsPerKm[1]) + '/km', ...(z.heartRate ? { fcMinima: z.heartRate[0], fcMaxima: z.heartRate[1] } : {}) })) : null;

// Visão compacta para os agentes. `adjustments` = linhas de ajuste POSTERIORES à versão de avaliações vigente (as anteriores ficam só no histórico).
export function buildAgentView(row: ReferenceRow, adjustments: ReferenceRow[], now: Date): AgentReferenceView {
  const p = withCurrentZones(row.payload);
  const origem: AgentReferenceView['origemDaVersao'] = row.source === 'ai_adjustment' ? 'ajuste_da_ia' : row.source === 'coach_adjustment' ? 'ajuste_do_treinador' : 'avaliacoes';
  const ref = p.reference;
  return {
    fonte: 'referencia_operacional', versao: row.version, origemDaVersao: origem,
    avaliacaoDeReferencia: ref ? { metodo: ref.methodLabel ?? METHOD_PT(ref.method), data: ref.performedAt, diasDesdeAAvaliacao: Math.max(0, daysBetween(new Date(`${ref.performedAt}T00:00:00Z`), now)), motivoDaEscolha: ref.reason ?? null } : null,
    indicadores: p.indicators.map((i) => ({
      indicador: i.key, rotulo: LABELS[i.key] ?? i.key, valor: i.value, unidade: i.unit,
      ...(i.pace ? { pace: i.pace } : {}), origem: ORIGIN_PT[i.origin] ?? i.origin, confianca: i.confidence,
      ...(i.rangeLow != null && i.rangeHigh != null ? { faixa: [i.rangeLow, i.rangeHigh] as [number, number] } : {}),
      ...(i.adjustment ? { valorOriginalDaAvaliacao: i.adjustment.previousValue } : {}),
      ...(i.from && i.from.fromReference === false ? { vindoDe: { metodo: METHOD_PT(i.from.method), data: i.from.performedAt } } : {}),
    })),
    zonas: toZones(p.zones), limitacoes: p.limitations ?? [],
    ajustesDaIADesdeAUltimaAvaliacao: adjustments.map((a) => ({
      data: dateKey(a.createdAt), propostoPor: a.payload.adjustment?.proposedBy ?? a.source, justificativa: a.justification,
      mudancas: (a.payload.adjustment?.changes ?? []).map((c) => ({ indicador: c.key, de: c.from, para: c.to })),
    })),
    aviso: REFERENCE_USE_NOTICE,
  };
}

// ---- validação de proposta de ajuste ----
export interface AdjustmentProposal {
  indicadores: Array<{ chave: string; novoValor: number }>;
  evidencias: Array<{ data: string; descricao: string }>;
  justificativa: string;
  proposedBy: string;
  coachInitiated?: boolean;
}
export interface ValidationOutcome { ok: boolean; reasons: string[]; merged?: PayloadIndicator[]; changes?: Array<{ key: string; from: number; to: number }>; zones?: Zone[] | null }

const RANGE: Record<AdjustableKey, [number, number]> = { vvo2max_kmh: [3, 30], hrmax_bpm: [30, 230], l1_speed_kmh: [3, 30], l1_hr_bpm: [30, 230], l2_speed_kmh: [3, 30], l2_hr_bpm: [30, 230] };

export function validateAdjustment(base: ReferencePayload, proposal: AdjustmentProposal, lastAiAdjustmentAt: Date | null, now: Date): ValidationOutcome {
  const reasons: string[] = [];
  if ((proposal.justificativa ?? '').trim().length < 10) reasons.push('justificativa ausente ou curta demais');
  if (!Array.isArray(proposal.indicadores) || proposal.indicadores.length === 0 || proposal.indicadores.length > 8) reasons.push('informe de 1 a 8 indicadores');
  const next = new Map<string, PayloadIndicator>(base.indicators.map((i) => [i.key, { ...i }]));
  const changes: Array<{ key: string; from: number; to: number }> = [];
  const seen = new Set<string>();
  for (const item of proposal.indicadores ?? []) {
    const key = item.chave as AdjustableKey;
    if (!ADJUSTABLE_KEYS.includes(key)) { reasons.push(`indicador nao ajustavel: ${String(item.chave)}`); continue; }
    if (seen.has(key)) { reasons.push(`indicador repetido: ${key}`); continue; }
    seen.add(key);
    if (typeof item.novoValor !== 'number' || !Number.isFinite(item.novoValor)) { reasons.push(`${key}: valor invalido`); continue; }
    const [lo, hi] = RANGE[key];
    if (item.novoValor < lo || item.novoValor > hi) { reasons.push(`${key}: fora do intervalo possivel (${lo} a ${hi})`); continue; }
    const current = next.get(key);
    if (!current) { reasons.push(`${key}: nao existe na referencia atual (nada e inventado)`); continue; }
    if (current.value === item.novoValor) { reasons.push(`${key}: sem mudanca de valor`); continue; }
    const value = key.endsWith('_bpm') ? Math.round(item.novoValor) : Math.round(item.novoValor * 100) / 100;
    changes.push({ key, from: current.value, to: value });
    const isSpeed = key.endsWith('speed_kmh') || key === 'vvo2max_kmh';
    next.set(key, {
      ...current, value, origin: 'adjusted', rangeLow: null, rangeHigh: null, adjustment: { previousValue: current.adjustment?.previousValue ?? current.value },
      ...(isSpeed ? { paceSecondsPerKm: Math.round(kmhToPaceSeconds(value)), pace: `${formatPaceSeconds(kmhToPaceSeconds(value))}/km` } : {}),
    });
  }
  // estados impossíveis (estrutura): L1 < L2 < VO₂máx na velocidade; L1 < L2 < FCmáx na frequência
  const v = (k: string) => next.get(k)?.value;
  const order = (a: string, b: string, text: string) => { if (v(a) !== undefined && v(b) !== undefined && v(a)! >= v(b)!) reasons.push(text); };
  order('l1_speed_kmh', 'l2_speed_kmh', 'L1 precisa ficar abaixo de L2 (velocidade)');
  order('l2_speed_kmh', 'vvo2max_kmh', 'L2 precisa ficar abaixo da velocidade no VO2max');
  order('l1_hr_bpm', 'l2_hr_bpm', 'L1 precisa ficar abaixo de L2 (FC)');
  order('l2_hr_bpm', 'hrmax_bpm', 'L2 precisa ficar abaixo da FC maxima');

  if (!proposal.coachInitiated) {
    const valid = (proposal.evidencias ?? []).filter((e) => e && typeof e.descricao === 'string' && e.descricao.trim().length > 0 && parsePerformedAt(e.data, now));
    const dates = [...new Set(valid.map((e) => e.data))].sort();
    if (valid.length < MIN_EVIDENCE_ITEMS || dates.length < MIN_EVIDENCE_ITEMS) reasons.push(`evidencia insuficiente: sao necessarias ao menos ${MIN_EVIDENCE_ITEMS} observacoes dos treinos em datas diferentes (recebidas: ${dates.length})`);
    if (lastAiAdjustmentAt && !dates.some((d) => d > dateKey(lastAiAdjustmentAt))) reasons.push('evidencia ja usada: depois de um ajuste anterior, a nova proposta precisa de ao menos uma observacao posterior a ele');
  }
  if (reasons.length > 0) return { ok: false, reasons };
  const merged = [...next.values()];
  const val = (k: string) => merged.find((i) => i.key === k)?.value ?? null;
  const l1 = val('l1_speed_kmh'), l2 = val('l2_speed_kmh'), top = val('vvo2max_kmh');
  const zones = l1 != null && l2 != null && top != null ? zonesFrom({ l1, l2, vvo2: top, l1Hr: val('l1_hr_bpm'), l2Hr: val('l2_hr_bpm'), hrMax: val('hrmax_bpm') }) : null;
  return { ok: true, reasons: [], merged, changes, zones };
}

export const knownUnit = (key: string) => INDICATOR_UNITS[key as CanonicalKey] ?? '';
