'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

// Calendario do aluno (aba "Semanas anteriores"), 20/10/2026. So' LEITURA: busca GET /coach/students/:id/calendar e desenha tres visoes — Mes (padrao), Semana e
// Lista. O cartao de cada treino e' desenhado por quem usa este componente (renderSessionCard), para ficar IDENTICO ao da aba Treinos; aqui ficam so' a grade,
// a navegacao, as cores de status e o painel do dia. Nada e' calculado de treino: totais e status vem prontos do servidor.

export interface CalendarExecution {
  activityLogId: string;
  provider: string;
  distanceKm: number | null;
  durationMin: number | null;
  avgPaceSecondsKm: number | null;
  avgHeartRateBpm: number | null;
}

export type CalendarStatus = 'feito' | 'ajustado' | 'nao_feito' | 'sem_registro' | 'futuro';

// Mesmo formato de uma sessao do historico (campos de prescricao e de resposta da aluna) + os campos do calendario.
export interface CalendarSession {
  id: string;
  planId: string;
  dateIso: string;
  weekday: number;
  title: string;
  modality: string;
  durationMin?: number | null;
  distanceKm?: number | null;
  zone?: string | null;
  structure?: Record<string, unknown> | null;
  notes?: string | null;
  routineMismatchNote?: string | null;
  origin: string | null;
  kind: 'prescrito' | 'extra_relogio' | 'extra_aluno';
  status: CalendarStatus;
  executedByDevice: boolean;
  hasFeedback: boolean;
  execution: CalendarExecution | null;
  completionStatus: string;
  completedAt?: string | null;
  completedDurationMin?: number | null;
  completedDistanceKm?: number | null;
  completedPaceSecondsKm?: number | null;
  perceivedEffort?: number | null;
  satisfactionElaboracao?: string | null;
  satisfaction?: string | null;
  satisfactionCapacidade?: string | null;
  satisfactionCarga?: string | null;
  feedback?: string | null;
  walkingReasons?: string[] | null;
  preSleepQuality?: number | null;
  prePhysicalFatigue?: number | null;
  preStressLevel?: number | null;
  preMotivation?: number | null;
  postWorkoutFeeling?: number | null;
  postWorkoutMood?: number | null;
  sleepDurationCategory?: string | null;
  sleepScheduleIrregularity?: number | null;
  sleepInterruption?: number | null;
  sleepDifficulty?: number | null;
  preMentalFatigue?: number | null;
  executionVsPrescribed?: number | null;
  postPhysicalFatigue?: number | null;
  postMentalFatigue?: number | null;
  emotionalExperienceDuring?: number | null;
  mentalStateChangePrePost?: number | null;
  painFlag?: string | null;
  painTiming?: string | null;
  feedbackVersion?: number | null;
}

export interface CalendarActivity {
  id: string;
  provider: string;
  dateIso: string;
  modality: string;
  durationMin: number | null;
  distanceKm: number | null;
  avgHeartRateBpm: number | null;
  classification: 'alternative' | 'ambiguous' | null;
}

interface CalendarWeekSummary {
  prescribedSessions: number;
  eligibleSessions: number;
  completedSessions: number;
  missedSessions: number;
  unregisteredSessions: number;
  prescribedKm: number;
  completedKm: number;
  adherencePercent: number | null;
}

interface CalendarResponse {
  from: string;
  to: string;
  today: string;
  sessions: CalendarSession[];
  activities: CalendarActivity[];
  weeks: Array<{ weekStart: string; planId: string; summary: CalendarWeekSummary }>;
}

type Mode = 'mes' | 'semana' | 'lista';

// Marco do historico esportivo valido (o servidor tambem corta aqui).
const CUTOFF = '2026-08-01';
const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const WEEKDAYS_FULL = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const STATUS_LABEL: Record<CalendarStatus, string> = { feito: 'feito', ajustado: 'ajustado', nao_feito: 'não feito', sem_registro: 'sem registro', futuro: 'a fazer' };

const MODALITY_LABEL: Record<string, string> = {
  corrida: 'Corrida', esteira: 'Esteira', forca: 'Musculação', fortalecimento_corredores: 'Fortalecimento', caminhada: 'Caminhada', natacao: 'Natação', bike: 'Bike', funcional: 'Funcional', outra: 'Outra',
};
const modalityName = (modality: string) => MODALITY_LABEL[modality] ?? modality;

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function mondayOf(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return addDays(iso, -((date.getUTCDay() + 6) % 7));
}
const monthOf = (iso: string) => iso.slice(0, 7);
function monthGrid(month: string): { start: string; end: string; weeks: string[][] } {
  const first = `${month}-01`;
  const last = addDays(`${new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString().slice(0, 7)}-01`, -1);
  const start = mondayOf(first);
  const end = addDays(mondayOf(last), 6);
  const weeks: string[][] = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 7)) weeks.push(Array.from({ length: 7 }, (_, i) => addDays(cursor, i)));
  return { start, end, weeks };
}
const shiftMonth = (month: string, delta: number) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + delta, 1)).toISOString().slice(0, 7);
const dayNumber = (iso: string) => String(Number(iso.slice(8, 10)));
const dateBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const km = (value: number | null | undefined) => (value == null ? null : `${Number.isInteger(value) ? value : value.toFixed(1).replace('.', ',')} km`);
const minutes = (value: number | null | undefined) => (value == null ? null : `${Math.round(value)} min`);
const paceText = (seconds: number | null | undefined) => (seconds ? `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}/km` : null);

function chipText(session: CalendarSession): string {
  const planned = km(session.distanceKm) ?? minutes(session.durationMin) ?? '';
  const done = session.execution?.distanceKm ?? session.completedDistanceKm;
  const doneText = (session.status === 'feito' || session.status === 'ajustado') && done != null && session.distanceKm != null && Math.abs(done - session.distanceKm) >= 0.1 ? ` · feito ${km(done)}` : '';
  return `${modalityName(session.modality)} ${planned}${doneText}`.trim();
}
function chipTitle(session: CalendarSession): string {
  const parts = [`${modalityName(session.modality)} — ${STATUS_LABEL[session.status]}`];
  if (session.kind === 'extra_relogio') parts.push('extra registrado pelo relógio');
  if (session.kind === 'extra_aluno') parts.push('extra registrado pela aluna');
  if (session.executedByDevice && !session.hasFeedback) parts.push('executado (relógio), sem feedback da aluna');
  if (session.perceivedEffort) parts.push(`PSE ${session.perceivedEffort}/10`);
  if (session.routineMismatchNote) parts.push(session.routineMismatchNote);
  return parts.join(' · ');
}

export default function StudentCalendar({ apiUrl, token, studentId, focusDate, focusNonce, renderSessionCard, renderSessionDetail }: {
  apiUrl: string;
  token: string;
  studentId: string;
  // Quando muda (focusNonce), vai para a semana desta data (usado pelo clique no calendario de bolinhas da aba Evolucao).
  focusDate?: string | null;
  focusNonce?: number;
  renderSessionCard: (session: CalendarSession) => ReactNode;
  // Painel completo do dia (sub-abas Prescrito x Realizado / Resposta / Analise / Relogio). Se ausente, o dia mostra o mesmo cartao das outras visoes.
  renderSessionDetail?: (session: CalendarSession) => ReactNode;
}) {
  const todayGuess = new Date().toISOString().slice(0, 10);
  const [mode, setMode] = useState<Mode>('mes');
  const [month, setMonth] = useState(monthOf(todayGuess));
  const [weekStart, setWeekStart] = useState(mondayOf(todayGuess));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const cache = useRef(new Map<string, CalendarResponse>());

  // Troca de aluno: cache e selecao zerados.
  useEffect(() => { cache.current.clear(); setData(null); setSelectedDay(null); }, [studentId]);

  useEffect(() => {
    if (!focusDate || !focusNonce) return;
    setWeekStart(mondayOf(focusDate));
    setMonth(monthOf(focusDate));
    setMode('semana');
    setSelectedDay(null);
  }, [focusDate, focusNonce]);

  const grid = useMemo(() => monthGrid(month), [month]);
  const range = mode === 'semana' ? { from: weekStart, to: addDays(weekStart, 6) } : { from: grid.start, to: grid.end };

  const load = useCallback(async (from: string, to: string, force: boolean) => {
    const key = `${studentId}|${from}|${to}`;
    if (!force && cache.current.has(key)) { setData(cache.current.get(key)!); setError(''); return; }
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/coach/students/${studentId}/calendar?from=${from}&to=${to}`, { headers: { Authorization: `Bearer ${token}` } });
      if (response.status === 401) { setError('Sessão expirada. Entre novamente no painel.'); return; }
      if (!response.ok) { setError('Não consegui carregar o calendário.'); return; }
      const body = (await response.json()) as CalendarResponse;
      cache.current.set(key, body);
      setData(body);
    } catch {
      setError('Não consegui falar com a API.');
    } finally {
      setLoading(false);
    }
  }, [apiUrl, studentId, token]);

  useEffect(() => { void load(range.from, range.to, false); }, [load, range.from, range.to]);

  const sessionsByDay = useMemo(() => {
    const map = new Map<string, CalendarSession[]>();
    for (const session of data?.sessions ?? []) map.set(session.dateIso, [...(map.get(session.dateIso) ?? []), session]);
    return map;
  }, [data]);
  const activitiesByDay = useMemo(() => {
    const map = new Map<string, CalendarActivity[]>();
    for (const activity of data?.activities ?? []) map.set(activity.dateIso, [...(map.get(activity.dateIso) ?? []), activity]);
    return map;
  }, [data]);
  const weekSummary = (start: string) => data?.weeks.find((week) => week.weekStart === start)?.summary ?? null;
  const today = data?.today ?? todayGuess;

  const minMonth = monthOf(CUTOFF);
  const maxMonth = shiftMonth(monthOf(todayGuess), 1);
  const minWeek = mondayOf(CUTOFF);
  const maxWeek = addDays(mondayOf(todayGuess), 7);

  const goPrev = () => { if (mode === 'semana') setWeekStart((w) => (addDays(w, -7) < minWeek ? w : addDays(w, -7))); else setMonth((m) => (shiftMonth(m, -1) < minMonth ? m : shiftMonth(m, -1))); };
  const goNext = () => { if (mode === 'semana') setWeekStart((w) => (addDays(w, 7) > maxWeek ? w : addDays(w, 7))); else setMonth((m) => (shiftMonth(m, 1) > maxMonth ? m : shiftMonth(m, 1))); };
  const goToday = () => { setMonth(monthOf(todayGuess)); setWeekStart(mondayOf(todayGuess)); };
  const prevDisabled = mode === 'semana' ? addDays(weekStart, -7) < minWeek : shiftMonth(month, -1) < minMonth;
  const nextDisabled = mode === 'semana' ? addDays(weekStart, 7) > maxWeek : shiftMonth(month, 1) > maxMonth;
  const title = mode === 'semana' ? `Semana de ${dateBr(weekStart)} a ${dateBr(addDays(weekStart, 6))}` : `${MONTHS[Number(month.slice(5, 7)) - 1]} de ${month.slice(0, 4)}`;

  const renderActivity = (activity: CalendarActivity) => (
    <div key={activity.id} className={`calActivity ${activity.classification === 'alternative' ? 'calActivityExtra' : 'calActivityPending'}`}>
      <strong>{modalityName(activity.modality)}</strong> {[km(activity.distanceKm), minutes(activity.durationMin), activity.avgHeartRateBpm ? `${activity.avgHeartRateBpm} bpm` : null].filter(Boolean).join(' · ')}
      <small>{activity.classification === 'alternative' ? 'Atividade fora do programa' : 'A confirmar (ainda sem decisão)'} · {activity.provider}</small>
    </div>
  );

  const summaryText = (start: string) => {
    const summary = weekSummary(start);
    if (!summary) return null;
    return (
      <div className="calWeekSummary">
        <span><strong>{summary.completedSessions}/{summary.eligibleSessions}</strong> treinos</span>
        <span>{km(summary.completedKm) ?? '0 km'} / {km(summary.prescribedKm) ?? '0 km'}</span>
        <span>{summary.adherencePercent != null ? `${summary.adherencePercent}% aderência` : 'sem dado de aderência'}</span>
      </div>
    );
  };

  const dayDetail = selectedDay ? (
    <div className="calOverlay" role="dialog" aria-modal="true" aria-label={`Treinos de ${selectedDay}`} onClick={() => setSelectedDay(null)}>
      <div className="calDialog" onClick={(event) => event.stopPropagation()}>
        <div className="calDialogHeader">
          <h3>{WEEKDAYS_FULL[new Date(`${selectedDay}T00:00:00Z`).getUTCDay()]}, {dateBr(selectedDay)}/{selectedDay.slice(0, 4)}</h3>
          <button className="secondaryButton" type="button" onClick={() => setSelectedDay(null)}>Fechar</button>
        </div>
        {(sessionsByDay.get(selectedDay) ?? []).length === 0 && (activitiesByDay.get(selectedDay) ?? []).length === 0 ? <p className="formHintText">Nada neste dia.</p> : null}
        <div className="calDialogBody">
          {(sessionsByDay.get(selectedDay) ?? []).map((session) => <div key={session.id}>{(renderSessionDetail ?? renderSessionCard)(session)}</div>)}
          {(activitiesByDay.get(selectedDay) ?? []).length > 0 ? (
            <div className="calActivityBlock">
              <h4>Atividades do relógio fora do programa</h4>
              {(activitiesByDay.get(selectedDay) ?? []).map(renderActivity)}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <section className="miniSection calendarTab">
      <div className="calToolbar">
        <div className="calModes" role="tablist" aria-label="Visão">
          {(['mes', 'semana', 'lista'] as Mode[]).map((value) => (
            <button key={value} type="button" role="tab" aria-selected={mode === value} className={mode === value ? 'active' : ''} onClick={() => setMode(value)}>
              {value === 'mes' ? 'Mês' : value === 'semana' ? 'Semana' : 'Lista'}
            </button>
          ))}
        </div>
        <div className="calNav">
          <button type="button" className="secondaryButton" onClick={goPrev} disabled={prevDisabled} aria-label="Anterior">‹</button>
          <strong>{title}</strong>
          <button type="button" className="secondaryButton" onClick={goNext} disabled={nextDisabled} aria-label="Próximo">›</button>
          <button type="button" className="secondaryButton" onClick={goToday}>Hoje</button>
          <button type="button" className="secondaryButton" onClick={() => { cache.current.clear(); void load(range.from, range.to, true); }} disabled={loading}>{loading ? 'Carregando…' : 'Atualizar'}</button>
        </div>
      </div>
      <div className="calLegend" aria-hidden="true">
        {(['feito', 'ajustado', 'nao_feito', 'sem_registro', 'futuro'] as CalendarStatus[]).map((status) => <span key={status} className={`calChip status-${status}`}>{STATUS_LABEL[status]}</span>)}
        <span className="calChip kind-extra">extra</span>
        <span className="calChip kind-pending">a confirmar</span>
      </div>
      {error ? <p className="zeppAlert" role="alert">{error}</p> : null}

      {mode === 'mes' ? (
        <div className="calMonth">
          <div className="calMonthHead">{[...WEEKDAYS, 'Resumo'].map((name) => <div key={name}>{name}</div>)}</div>
          {grid.weeks.map((week) => (
            <div className="calMonthRow" key={week[0]}>
              {week.map((day) => {
                const sessions = sessionsByDay.get(day) ?? [];
                const activities = activitiesByDay.get(day) ?? [];
                const outside = monthOf(day) !== month || day < CUTOFF;
                return (
                  <div key={day} className={`calDay ${outside ? 'calDayOutside' : ''} ${day === today ? 'calDayToday' : ''}`} onClick={() => !outside || sessions.length || activities.length ? setSelectedDay(day) : undefined}>
                    <span className="calDayNumber">{dayNumber(day)}</span>
                    {sessions.map((session) => (
                      <button key={session.id} type="button" title={chipTitle(session)} className={`calChip status-${session.status} ${session.kind !== 'prescrito' ? 'kind-extra' : ''}`} onClick={(event) => { event.stopPropagation(); setSelectedDay(day); }}>
                        {chipText(session)}
                      </button>
                    ))}
                    {activities.map((activity) => (
                      <button key={activity.id} type="button" title={`${modalityName(activity.modality)} fora do programa (${activity.provider})`} className={`calChip ${activity.classification === 'alternative' ? 'kind-extra' : 'kind-pending'}`} onClick={(event) => { event.stopPropagation(); setSelectedDay(day); }}>
                        {modalityName(activity.modality)} {km(activity.distanceKm) ?? minutes(activity.durationMin) ?? ''}
                      </button>
                    ))}
                  </div>
                );
              })}
              <div className="calDay calSummaryCell">{summaryText(week[0])}</div>
            </div>
          ))}
        </div>
      ) : null}

      {mode === 'semana' ? (
        <div className="calWeekWrap">
          {summaryText(weekStart)}
          <div className="calWeekBoard">
            {Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((day, i) => (
              <div key={day} className={`calWeekColumn ${day === today ? 'calDayToday' : ''}`}>
                <div className="calWeekColumnHead"><strong>{WEEKDAYS[i]}</strong><span>{dateBr(day)}</span></div>
                {day < CUTOFF ? <p className="formHintText">Antes do histórico válido.</p> : null}
                {(sessionsByDay.get(day) ?? []).length === 0 && (activitiesByDay.get(day) ?? []).length === 0 && day >= CUTOFF ? <p className="formHintText">Sem treino</p> : null}
                {(sessionsByDay.get(day) ?? []).map((session) => <div key={session.id}>{renderSessionCard(session)}</div>)}
                {(activitiesByDay.get(day) ?? []).map(renderActivity)}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {mode === 'lista' ? (
        <div className="calList">
          {grid.weeks.map((week) => {
            const sessions = week.flatMap((day) => sessionsByDay.get(day) ?? []);
            const activities = week.flatMap((day) => activitiesByDay.get(day) ?? []);
            if (sessions.length === 0 && activities.length === 0) return null;
            return (
              <div className="calListWeek" key={week[0]}>
                <div className="calListWeekHead"><strong>Semana de {dateBr(week[0])} a {dateBr(week[6])}</strong>{summaryText(week[0])}</div>
                <div className="calListCards">
                  {sessions.map((session) => (
                    <div key={session.id}>
                      <p className="calListDay">{WEEKDAYS_FULL[new Date(`${session.dateIso}T00:00:00Z`).getUTCDay()]}, {dateBr(session.dateIso)}</p>
                      {renderSessionCard(session)}
                    </div>
                  ))}
                  {activities.map(renderActivity)}
                </div>
              </div>
            );
          })}
          {!loading && !error && (data?.sessions.length ?? 0) === 0 && (data?.activities.length ?? 0) === 0 ? <p className="formHintText">Nenhum treino neste mês.</p> : null}
        </div>
      ) : null}
      {dayDetail}
    </section>
  );
}
