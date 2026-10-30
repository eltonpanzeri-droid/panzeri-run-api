import { canonicalModality } from './canonical-modality';
import { weekStartOf } from '../common/weekly-volume';
import { activityLocalDate, OPERATIONAL_TIME_ZONE } from '../common/local-date';

// TOTAIS REALIZADOS DA SEMANA (lote 1 — 26/10/2026). Funcao PURA (sem banco, sem rede, sem IA): separa, para uma semana, tres conjuntos que nunca se misturam
//   1. prescricao: sessoes previstas, cumpridas e o volume executado NAS sessoes prescritas (o cumprimento e' calculado so' sobre elas);
//   2. extras: execucoes sem prescricao correspondente (registro manual do aluno, atividade materializada no calendario ou atividade que so' existe em ActivityLog);
//   3. total realizado: uniao deduplicada por EVENTO FISICO de (1) e (2).
// Uma atividade extra NAO vira sessao prevista e nao altera o cumprimento. Nenhuma formula de carga: so' contagens, km e minutos medidos.
// Quem chama entrega UMA observacao por evento fisico (a canonica, como em pickCanonicalPerEvent) e ja' aplica as restricoes de provedor (aiActivityWhere) quando a
// visao e' a da IA; este modulo nao conhece provedores bloqueados.

export const WEEKLY_REALIZED_TOTALS_VERSION = 1;
export const TOTALS_FALLBACK_TIME_ZONE = OPERATIONAL_TIME_ZONE;

export type ExtraOrigin = 'student_extra' | 'device_extra' | 'somente_atividade';
export type TotalsActivityClassification = 'corresponding' | 'alternative' | 'ambiguous' | null;
export type TotalsSessionStatus = 'performed' | 'not_performed' | 'no_record';

export interface TotalsSessionInput {
  sessionId: string;
  // dia agendado 'YYYY-MM-DD' (as datas programadas sao guardadas a meia-noite UTC)
  scheduledDate: string;
  modality: string;
  // 'device_extra' | 'student_extra' = extra; qualquer outro = prescrita
  origin: string | null;
  status: TotalsSessionStatus;
  plannedDistanceKm?: number | null;
  // dados da conclusao manual (WorkoutCompletion), quando existe
  completionDistanceKm?: number | null;
  completionDurationMin?: number | null;
  perceivedEffort?: number | null;
  completionAvgHeartRate?: number | null;
  completionMaxHeartRate?: number | null;
  // ActivityLog (qualquer observacao do evento) vinculados a esta sessao
  linkedActivityLogIds?: string[];
  // Sessao sintetica do aparelho (device_extra): o elo com a atividade NAO e' um SessionExecutionLink e sim structure.activityLogId (materializeExtraActivity). E' o mesmo
  // evento fisico: conta uma vez, pela atividade, e a sessao so' empresta feedback/esforco.
  materializedActivityLogId?: string | null;
  materializedProvider?: string | null;
  // quem criou cada vinculo ativo: 'automatic' (reconciliador) | 'student' | 'coach'. Um vinculo automatico e' decisao do algoritmo (dia + modalidade), nao confirmacao humana.
  linkOrigins?: Record<string, string>;
}

export interface TotalsActivityInput {
  // observacao canonica do evento fisico
  activityLogId: string;
  // todas as observacoes lidas do mesmo evento (inclui a canonica) — usado para casar vinculos feitos a uma observacao nao-canonica
  memberIds?: string[];
  physicalEventId?: string | null;
  startedAt: Date;
  utcOffsetMinutes?: number | null;
  sport: string | null;
  distanceKm?: number | null;
  durationMin?: number | null;
  classification: TotalsActivityClassification;
  provider: string;
  // medidas do aparelho, quando existem (nunca inventadas; null = sem dado)
  avgHeartRateBpm?: number | null;
  maxHeartRateBpm?: number | null;
  powerAvgWatts?: number | null;
  elevationGainMeters?: number | null;
  caloriesKcal?: number | null;
  cadenceAvg?: number | null;
  // rotulo dado pelo aluno ('daily' = rotina cotidiana, ex.: caminhada). Conta como exercicio extra (carga); so' informa a leitura contextual.
  studentLabel?: string | null;
}

export interface TotalsEvent {
  eventKey: string;
  date: string;
  modality: string;
  distanceKm: number | null;
  durationMin: number | null;
  providers: string[];
  activityLogId: string | null;
  sessionId: string | null;
  // so' em eventos da prescricao: 'automatic' | 'student' | 'coach' (vinculo) ou null (registro manual sem atividade)
  linkOrigin: string | null;
}

// Medidas objetivas da atividade, preservadas para a leitura contextual (o modulo nao as interpreta nem as converte em carga).
export interface TotalsMeasures {
  avgHeartRateBpm: number | null;
  maxHeartRateBpm: number | null;
  powerAvgWatts: number | null;
  elevationGainMeters: number | null;
  caloriesKcal: number | null;
  cadenceAvg: number | null;
}

// Atividade valida que aguarda a resposta do aluno (pertence a prescricao ou e' extra?). Conta UMA vez no total realizado; nao e' cumprimento nem extra ate' a resposta.
export interface TotalsPendingEvent extends TotalsEvent {
  measures: TotalsMeasures;
}

export interface TotalsExtraEvent extends TotalsEvent {
  origin: ExtraOrigin;
  perceivedEffort: number | null;
  measures: TotalsMeasures;
  // o aluno marcou como rotina cotidiana (ex.: caminhada); continua extra e conta na carga
  routine?: boolean;
}

export interface ModalityTotals { events: number; minutes: number; km: number | null }

export interface WeeklyRealizedTotals {
  version: number;
  weekStartDate: string;
  weekEndDate: string;
  prescription: {
    prescribedSessions: number;
    performedSessions: number;
    notPerformedSessions: number;
    noRecordSessions: number;
    plannedRunKm: number | null;
    executedRunKm: number | null;
    executedEvents: TotalsEvent[];
    // proveniencia da correspondencia: vinculo automatico (algoritmo) x confirmado por aluno/treinador x registro manual sem atividade
    provenance: { automaticLink: number; humanConfirmedLink: number; manualRecord: number; classifiedWithoutLoadedSession: number };
  };
  extras: {
    events: TotalsExtraEvent[];
    byModality: Record<string, ModalityTotals>;
  };
  // Aguardando confirmacao do aluno: contam no total, ficam fora do cumprimento e dos extras ate' a resposta.
  pendingConfirmation: { events: TotalsPendingEvent[] };
  total: {
    events: number;
    byModality: Record<string, ModalityTotals>;
    run: { events: number; km: number | null; minutes: number };
    eventKeys: string[];
    activityLogIds: string[];
    providers: string[];
  };
  completeness: { excludedUnclassified: number; runEventsWithoutDistance: number; eventsWithoutDuration: number; notes: string[] };
}

const RUN_FAMILY = new Set(['corrida', 'esteira']);
const EXTRA_ORIGINS = new Set(['device_extra', 'student_extra']);
const round1 = (value: number) => Math.round(value * 10) / 10;
const sum = (values: Array<number | null | undefined>): number | null => {
  const known = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return known.length === 0 ? null : known.reduce((a, b) => a + b, 0);
};

// Dia local de uma atividade: REGRA UNICA em common/local-date.ts (offset do aparelho preservado; sem offset, America/Sao_Paulo). Reexportada para compatibilidade.
export { activityLocalDate };

function addDays(isoDay: string, days: number): string {
  const d = new Date(`${isoDay}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function modalityOf(sport: string | null | undefined): string {
  return canonicalModality(sport) ?? 'outra';
}

function measuresOf(activity: TotalsActivityInput | null, session: TotalsSessionInput | null): TotalsMeasures {
  return {
    avgHeartRateBpm: activity?.avgHeartRateBpm ?? session?.completionAvgHeartRate ?? null,
    maxHeartRateBpm: activity?.maxHeartRateBpm ?? session?.completionMaxHeartRate ?? null,
    powerAvgWatts: activity?.powerAvgWatts ?? null,
    elevationGainMeters: activity?.elevationGainMeters ?? null,
    caloriesKcal: activity?.caloriesKcal ?? null,
    cadenceAvg: activity?.cadenceAvg ?? null,
  };
}

function activityEventKey(activity: TotalsActivityInput): string {
  return activity.physicalEventId ? `event:${activity.physicalEventId}` : `activity:${activity.activityLogId}`;
}

export function buildWeeklyRealizedTotals(input: { weekStartDate: string; sessions: TotalsSessionInput[]; activities: TotalsActivityInput[] }): WeeklyRealizedTotals {
  const weekStartDate = weekStartOf(input.weekStartDate);
  const weekEndDate = addDays(weekStartDate, 6);
  const inWeek = (day: string) => day >= weekStartDate && day <= weekEndDate;

  const sessions = input.sessions.filter((session) => inWeek(session.scheduledDate));
  const isExtraSession = (session: TotalsSessionInput) => EXTRA_ORIGINS.has(session.origin ?? '');
  const prescribed = sessions.filter((session) => !isExtraSession(session));

  // observacao -> evento. Ordenacao previa deixa o resultado independente da ordem de entrada.
  const activities = [...input.activities].sort((a, b) => (a.activityLogId < b.activityLogId ? -1 : 1));
  const eventByObservation = new Map<string, TotalsActivityInput>();
  for (const activity of activities) {
    eventByObservation.set(activity.activityLogId, activity);
    for (const member of activity.memberIds ?? []) eventByObservation.set(member, activity);
  }

  let excludedUnclassified = 0; // so' a atividade AINDA SEM classificacao (null): 'ambiguous' resolvida e' pendente de confirmacao e entra no total
  const eligible: TotalsActivityInput[] = [];
  // Eventos classificados cujo DIA LOCAL cai em outra semana: pertencem a' outra semana. Uma sessao desta semana vinculada a eles NAO os conta de novo pela conclusao manual.
  const otherWeekObservationIds = new Set<string>();
  for (const activity of activities) {
    if (activity.classification !== 'corresponding' && activity.classification !== 'alternative' && activity.classification !== 'ambiguous') { excludedUnclassified += 1; continue; }
    if (!inWeek(activityLocalDate(activity.startedAt, activity.utcOffsetMinutes))) {
      for (const id of [activity.activityLogId, ...(activity.memberIds ?? [])]) otherWeekObservationIds.add(id);
      continue;
    }
    eligible.push(activity);
  }
  // evento deduplicado por chave (defesa: o chamador ja' entrega 1 por evento)
  const eventsByKey = new Map<string, TotalsActivityInput>();
  for (const activity of eligible) {
    const key = activityEventKey(activity);
    const existing = eventsByKey.get(key);
    // se houver duas leituras do mesmo evento, a 'corresponding' prevalece (carrega o vinculo com a prescricao)
    if (!existing || (existing.classification !== 'corresponding' && activity.classification === 'corresponding')) eventsByKey.set(key, activity);
  }

  // sessao <-> evento: pelas observacoes vinculadas (qualquer membro do evento)
  const sessionByEventKey = new Map<string, TotalsSessionInput[]>();
  for (const session of sessions) {
    for (const logId of [...(session.linkedActivityLogIds ?? []), ...(session.materializedActivityLogId ? [session.materializedActivityLogId] : [])]) {
      const activity = eventByObservation.get(logId);
      if (!activity) continue;
      const key = activityEventKey(activity);
      const list = sessionByEventKey.get(key) ?? [];
      if (!list.includes(session)) list.push(session);
      sessionByEventKey.set(key, list);
    }
  }

  const toEvent = (key: string, activity: TotalsActivityInput | null, session: TotalsSessionInput | null): TotalsEvent => ({
    eventKey: key,
    date: activity ? activityLocalDate(activity.startedAt, activity.utcOffsetMinutes) : (session as TotalsSessionInput).scheduledDate,
    modality: modalityOf(activity ? activity.sport : session?.modality),
    distanceKm: activity?.distanceKm ?? session?.completionDistanceKm ?? null,
    durationMin: activity?.durationMin ?? session?.completionDurationMin ?? null,
    providers: activity ? [activity.provider] : session?.materializedProvider ? [session.materializedProvider] : [],
    activityLogId: activity?.activityLogId ?? null,
    sessionId: session?.sessionId ?? null,
    linkOrigin: null,
  });

  const prescriptionEvents: TotalsEvent[] = [];
  const extraEvents: TotalsExtraEvent[] = [];
  const pendingEvents: TotalsPendingEvent[] = [];
  const claimed = new Set<string>();

  // 1) eventos de atividade importada
  for (const [key, activity] of [...eventsByKey.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const linked = sessionByEventKey.get(key) ?? [];
    if (activity.classification === 'ambiguous') {
      // Pergunta pendente: nao presume vinculo (nao e' cumprimento) nem extra; so' conta no total, uma vez.
      pendingEvents.push({ ...toEvent(key, activity, null), measures: measuresOf(activity, null) });
      claimed.add(key);
      continue;
    }
    const prescribedLink = linked.find((session) => !isExtraSession(session) && session.status === 'performed') ?? linked.find((session) => !isExtraSession(session));
    const extraLink = linked.find((session) => isExtraSession(session)) ?? null;
    // Prescricao = vinculo com sessao PRESCRITA, ou 'corresponding' sem nenhuma sessao extra no vinculo (a sessao prescrita pode estar fora da selecao desta semana).
    // 'corresponding' vinculada SO' a uma sessao extra do aluno (o reconciliador liga a atividade importada ao registro manual do mesmo dia) e' o MESMO evento: extra, contado uma vez.
    if (prescribedLink || (activity.classification === 'corresponding' && !extraLink)) {
      const event = toEvent(key, activity, prescribedLink ?? null);
      event.linkOrigin = prescribedLink ? [activity.activityLogId, ...(activity.memberIds ?? [])].map((id) => prescribedLink.linkOrigins?.[id]).find((origin) => origin != null) ?? null : null;
      prescriptionEvents.push(event);
      claimed.add(key);
      for (const session of linked) claimed.add(`session:${session.sessionId}`);
      continue;
    }
    const origin: ExtraOrigin = extraLink?.origin === 'student_extra' ? 'student_extra' : extraLink ? 'device_extra' : 'somente_atividade';
    extraEvents.push({ ...toEvent(key, activity, extraLink), origin, perceivedEffort: extraLink?.perceivedEffort ?? null, measures: measuresOf(activity, extraLink), ...(activity?.studentLabel === 'daily' ? { routine: true } : {}) });
    claimed.add(key);
    for (const session of linked) claimed.add(`session:${session.sessionId}`);
  }

  // 2) sessoes realizadas sem atividade no evento (registro manual): prescritas contam pela conclusao; extras do aluno/materializadas sem atividade tambem
  for (const session of [...sessions].sort((a, b) => (a.sessionId < b.sessionId ? -1 : 1))) {
    if (session.status !== 'performed' || claimed.has(`session:${session.sessionId}`)) continue;
    if ([...(session.linkedActivityLogIds ?? []), ...(session.materializedActivityLogId ? [session.materializedActivityLogId] : [])].some((id) => otherWeekObservationIds.has(id))) continue;
    const key = `session:${session.sessionId}`;
    if (isExtraSession(session)) {
      extraEvents.push({ ...toEvent(key, null, session), origin: session.origin === 'student_extra' ? 'student_extra' : 'device_extra', perceivedEffort: session.perceivedEffort ?? null, measures: measuresOf(null, session) });
    } else {
      prescriptionEvents.push(toEvent(key, null, session));
    }
    claimed.add(key);
  }

  const byDateThenKey = (a: TotalsEvent, b: TotalsEvent) => (a.date === b.date ? (a.eventKey < b.eventKey ? -1 : 1) : a.date < b.date ? -1 : 1);
  prescriptionEvents.sort(byDateThenKey);
  extraEvents.sort(byDateThenKey);
  pendingEvents.sort(byDateThenKey);

  const allEvents: TotalsEvent[] = [...prescriptionEvents, ...extraEvents, ...pendingEvents];
  const aggregate = (events: TotalsEvent[]): Record<string, ModalityTotals> => {
    const out: Record<string, ModalityTotals> = {};
    for (const event of events) {
      const entry = (out[event.modality] ??= { events: 0, minutes: 0, km: null });
      entry.events += 1;
      entry.minutes += event.durationMin ?? 0;
      if (RUN_FAMILY.has(event.modality) && event.distanceKm != null) entry.km = (entry.km ?? 0) + event.distanceKm;
    }
    for (const entry of Object.values(out)) { entry.minutes = Math.round(entry.minutes); if (entry.km != null) entry.km = round1(entry.km); }
    return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
  };
  const runEvents = allEvents.filter((event) => RUN_FAMILY.has(event.modality));
  const runKm = sum(runEvents.map((event) => event.distanceKm));
  const prescribedRunExecuted = sum(prescriptionEvents.filter((event) => RUN_FAMILY.has(event.modality)).map((event) => event.distanceKm));
  const plannedRunKm = sum(prescribed.filter((session) => RUN_FAMILY.has(session.modality)).map((session) => session.plannedDistanceKm));

  const runEventsWithoutDistance = runEvents.filter((event) => event.distanceKm == null).length;
  const eventsWithoutDuration = allEvents.filter((event) => event.durationMin == null).length;
  const notes: string[] = [];
  if (excludedUnclassified > 0) notes.push(`${excludedUnclassified} atividade(s) ainda sem classificação definitiva ficaram fora dos totais.`);
  if (runEventsWithoutDistance > 0) notes.push(`${runEventsWithoutDistance} corrida(s) sem distância registrada contam como evento, mas não somam km.`);

  const providers = [...new Set(allEvents.flatMap((event) => event.providers))].sort();
  return {
    version: WEEKLY_REALIZED_TOTALS_VERSION,
    weekStartDate,
    weekEndDate,
    prescription: {
      provenance: {
        automaticLink: prescriptionEvents.filter((event) => event.linkOrigin === 'automatic').length,
        humanConfirmedLink: prescriptionEvents.filter((event) => event.linkOrigin === 'student' || event.linkOrigin === 'coach').length,
        manualRecord: prescriptionEvents.filter((event) => event.activityLogId == null).length,
        classifiedWithoutLoadedSession: prescriptionEvents.filter((event) => event.activityLogId != null && event.linkOrigin == null).length,
      },
      prescribedSessions: prescribed.length,
      performedSessions: prescribed.filter((session) => session.status === 'performed').length,
      notPerformedSessions: prescribed.filter((session) => session.status === 'not_performed').length,
      noRecordSessions: prescribed.filter((session) => session.status === 'no_record').length,
      plannedRunKm: plannedRunKm == null ? null : round1(plannedRunKm),
      executedRunKm: prescribedRunExecuted == null ? null : round1(prescribedRunExecuted),
      executedEvents: prescriptionEvents,
    },
    extras: { events: extraEvents, byModality: aggregate(extraEvents) },
    pendingConfirmation: { events: pendingEvents },
    total: {
      events: allEvents.length,
      byModality: aggregate(allEvents),
      run: { events: runEvents.length, km: runKm == null ? null : round1(runKm), minutes: Math.round(sum(runEvents.map((event) => event.durationMin)) ?? 0) },
      eventKeys: allEvents.map((event) => event.eventKey).sort(),
      activityLogIds: allEvents.map((event) => event.activityLogId).filter((id): id is string => id != null).sort(),
      providers,
    },
    completeness: { excludedUnclassified, runEventsWithoutDistance, eventsWithoutDuration, notes },
  };
}

// Invariantes que valem para QUALQUER resultado (usadas pelos testes e como defesa em quem consome).
export function totalsInvariantViolations(totals: WeeklyRealizedTotals): string[] {
  const violations: string[] = [];
  const keys = [...totals.prescription.executedEvents, ...totals.extras.events, ...totals.pendingConfirmation.events].map((event) => event.eventKey);
  if (new Set(keys).size !== keys.length) violations.push('evento contado em mais de um conjunto ou duas vezes');
  if (totals.total.events !== keys.length) violations.push('total de eventos diferente de prescricao + extras + pendentes');
  if (totals.prescription.performedSessions > totals.prescription.prescribedSessions) violations.push('mais sessoes cumpridas do que previstas');
  const modalityEvents = Object.values(totals.total.byModality).reduce((acc, entry) => acc + entry.events, 0);
  if (modalityEvents !== totals.total.events) violations.push('soma por modalidade diferente do total');
  return violations;
}

// REPRESENTACAO PARA A IA (lote 3): a mesma contagem dos totais, em chaves legiveis, SEM ids de fonte, SEM nomes de provedor e SEM texto do aluno. Quem chama entrega aqui
// o resultado ja' calculado na VISAO DE IA (dados de provedores bloqueados nao existem nela). Nao interpreta nada: so' apresenta o que foi medido, em tres blocos que nunca
// se misturam (cumprimento da prescricao x atividades extras x total realizado).
const LINK_LABEL: Record<string, string> = { automatic: 'automatico', student: 'confirmado_pelo_aluno', coach: 'confirmado_pelo_treinador' };
const nonNull = <T extends Record<string, unknown>>(value: T): Partial<T> => Object.fromEntries(Object.entries(value).filter(([, v]) => v != null)) as Partial<T>;

export function promptTotalsOf(totals: WeeklyRealizedTotals): Record<string, unknown> {
  const byModality = (source: Record<string, ModalityTotals>) => Object.fromEntries(Object.entries(source).map(([modality, v]) => [modality, nonNull({ atividades: v.events, minutos: v.minutes, km: v.km })]));
  return {
    semanaIniciadaEm: totals.weekStartDate,
    leitura: 'Tres blocos que NAO se misturam: cumprimento da prescricao (so sessoes prescritas), atividades extras (sem prescricao correspondente; exposicao adicional ao treinamento) e total realizado (todas as atividades da semana, cada evento fisico contado uma vez). Um evento esta em exatamente um dos dois primeiros (ou em aguardandoConfirmacaoDoAluno, enquanto o aluno nao responde se foi o treino previsto ou um extra) e sempre dentro do terceiro.',
    prescricao: {
      sessoesPrevistas: totals.prescription.prescribedSessions,
      sessoesCumpridas: totals.prescription.performedSessions,
      naoFeitas: totals.prescription.notPerformedSessions,
      semRegistro: totals.prescription.noRecordSessions,
      kmDeCorridaPrevistos: totals.prescription.plannedRunKm,
      kmDeCorridaExecutadosNasPrescritas: totals.prescription.executedRunKm,
      origemDoCumprimento: {
        vinculoAutomaticoDoSistema: totals.prescription.provenance.automaticLink,
        vinculoConfirmadoPorAlunoOuTreinador: totals.prescription.provenance.humanConfirmedLink,
        registroManualSemAtividade: totals.prescription.provenance.manualRecord,
        classificadaComoCorrespondenteSemSessaoNaSelecao: totals.prescription.provenance.classifiedWithoutLoadedSession,
      },
      avisoSobreVinculo: 'Vinculo automatico = o sistema associou a atividade a sessao pelo dia e pela modalidade, sem validar distancia, duracao, ritmo nem estrutura. NAO e prova de que a intensidade, a estrutura ou o objetivo do treino foram cumpridos; so confirmado_pelo_aluno/treinador e decisao humana.',
    },
    extras: {
      atividades: totals.extras.events.length,
      porModalidade: byModality(totals.extras.byModality),
      detalhe: totals.extras.events.map((event) => nonNull({
        data: event.date,
        modalidade: event.modality,
        origem: event.origin,
        distanciaKm: event.distanceKm != null ? round1(event.distanceKm) : null,
        duracaoMin: event.durationMin != null ? Math.round(event.durationMin) : null,
        fcMediaBpm: event.measures.avgHeartRateBpm,
        fcMaximaBpm: event.measures.maxHeartRateBpm,
        potenciaMediaW: event.measures.powerAvgWatts,
        ganhoDeElevacaoM: event.measures.elevationGainMeters != null ? Math.round(event.measures.elevationGainMeters) : null,
        cadenciaMedia: event.measures.cadenceAvg,
        caloriasKcal: event.measures.caloriesKcal,
        esforcoPercebido: event.perceivedEffort,
        rotinaCotidianaMarcadaPeloAluno: event.routine === true ? true : null,
      })),
    },
    aguardandoConfirmacaoDoAluno: {
      atividades: totals.pendingConfirmation.events.length,
      detalhe: totals.pendingConfirmation.events.map((event) => nonNull({
        data: event.date,
        modalidade: event.modality,
        distanciaKm: event.distanceKm != null ? round1(event.distanceKm) : null,
        duracaoMin: event.durationMin != null ? Math.round(event.durationMin) : null,
        fcMediaBpm: event.measures.avgHeartRateBpm,
        fcMaximaBpm: event.measures.maxHeartRateBpm,
        potenciaMediaW: event.measures.powerAvgWatts,
        ganhoDeElevacaoM: event.measures.elevationGainMeters != null ? Math.round(event.measures.elevationGainMeters) : null,
        cadenciaMedia: event.measures.cadenceAvg,
        caloriasKcal: event.measures.caloriesKcal,
      })),
    },
    totalRealizado: {
      atividades: totals.total.events,
      porModalidade: byModality(totals.total.byModality),
      corrida: nonNull({ atividades: totals.total.run.events, km: totals.total.run.km, minutos: totals.total.run.minutes }),
    },
    observacoes: totals.completeness.notes,
  };
}

// Rotulo do vinculo de um evento da prescricao, para quem monta texto/achados a partir dos totais.
export function linkLabelOf(origin: string | null): string {
  return origin ? LINK_LABEL[origin] ?? origin : 'registro_manual';
}
