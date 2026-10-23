'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Calculator, FlaskConical, Lightbulb } from 'lucide-react';

// Aluna > Carga (própria) (23/10/2026, v2). MÉTRICA NOVA, EM AVALIAÇÃO: esforço percebido × minutos (sRPE). SOMENTE LEITURA: GET /coach/students/:id/training-load. A conta inteira vem pronta do servidor e é
// MOSTRADA aqui (como foi calculada, cada treino que entrou — com a ORIGEM da data e da duração —, cada treino que ficou de fora e o motivo), para o treinador julgar a métrica.
// Não é recomendação, não tem faixa de risco e o Atlas não usa.

type Group = 'corrida' | 'forca' | 'outras';
type View = 'geral' | Group;
type DateSource = 'atividade_vinculada' | 'programada' | 'registro';
type Note = 'vinculo_distante' | 'atividade_ja_usada' | null;
type Session = {
  id: string; date: string; dateSource: DateSource; scheduledDate: string | null; shiftDays: number | null; dateZoneAssumed: boolean; activityNote: Note; modality: string | null; group: Group; title: string | null; isExtra: boolean; adjusted: boolean;
  rpe: number; minutes: number; durationSource: 'informada' | 'atividade_importada'; durationProvider: string | null; load: number;
};
type Excluded = { id: string; date: string; dateSource: DateSource; scheduledDate: string | null; shiftDays: number | null; dateZoneAssumed: boolean; activityNote: Note; modality: string | null; group: Group; title: string | null; isExtra: boolean; reason: 'sem_esforco' | 'sem_duracao' | 'sem_esforco_e_duracao'; rpe: number | null; minutes: number | null };
type Window = { asOf: string; acuteLoad: number; chronicLoad: number; chronicWeeklyAverage: number; ratio: number | null; chronicDaysCovered: number; excludedInWindow: number; note: string | null };
type Week = { weekStart: string; weekEnd: string; inProgress: boolean; clipped: boolean; load: number; sessions: number; excluded: number; window: Window };
type ViewResult = { weeks: Week[]; current: Window; totals: { sessions: number; excluded: number; load: number } };
type Result = {
  method: { version: string; formula: string; steps: string[]; leftOut: string[]; generalViewNote: string };
  period: { from: string; to: string }; sessions: Session[]; excluded: Excluded[]; views: Record<View, ViewResult>;
  sources: { dateReal: number; dateProgrammedOnly: number; dateRegisteredOnly: number; durationInformed: number; durationImported: number };
  example: { date: string; rpe: number; minutes: number; load: number } | null;
};

const REASON: Record<Excluded['reason'], string> = { sem_esforco: 'sem esforço percebido', sem_duracao: 'sem duração (nem informada, nem de atividade vinculada)', sem_esforco_e_duracao: 'sem esforço percebido e sem duração' };
const MODALITY: Record<string, string> = { corrida: 'Corrida', esteira: 'Esteira', forca: 'Força', fortalecimento_corredores: 'Fortalecimento', caminhada: 'Caminhada' };
const PROVIDER: Record<string, string> = { polar: 'Polar', zepp: 'Zepp', health_connect: 'Health Connect', apple_health: 'Apple Saúde', wahoo: 'Wahoo' };
const VIEW_LABEL: Record<View, string> = { geral: 'Geral (soma)', corrida: 'Corrida', forca: 'Força', outras: 'Outras' };

const localToday = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; };
const addDays = (date: string, days: number) => new Date(new Date(`${date}T12:00:00.000Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
const dmy = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
const dm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
const ua = (value: number) => `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} UA`;
const mod = (m: string | null) => (m ? MODALITY[m] ?? m : '—');
const min2 = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

const OPEN_QUESTIONS = [
  'Esforço percebido × minutos é a medida certa para a metodologia da Panzeri? (é a mais simples, mas depende de a aluna informar o esforço.)',
  'A janela de 7 dias (aguda) contra 28 dias (crônica) faz sentido, ou prefere outra janela?',
  'Quando a aluna não informa a duração, usamos a da atividade importada confirmada para aquele treino. Esse uso está bom, ou prefere que o treino fique sempre de fora?',
  'A visão geral soma corrida e força (esforço × tempo). Ela é útil para você, ou prefere olhar só por modalidade?',
  'O Atlas deve enxergar esta carga (só como descrição, nunca como regra) ou fica só no painel?',
  'Nas alunas que usam Polar, a Polar já guarda uma carga por treino (Training Load Pro, em aparelhos compatíveis). Quer comparar a sua carga com a dela?',
];

const NOTE_LABEL: Record<NonNullable<Note>, { text: string; title: string }> = {
  vinculo_distante: { text: 'vínculo distante ignorado', title: 'A atividade vinculada fica a mais de 6 dias do dia programado: não foi usada (vale a data programada).' },
  atividade_ja_usada: { text: 'atividade já usada por outro treino', title: 'A mesma atividade estava vinculada a dois treinos: ficou com o de dia programado mais próximo.' },
};

function DateCell({ item }: { item: Session | Excluded }) {
  return (
    <>
      {dmy(item.date)} <DateTag source={item.dateSource} zoneAssumed={item.dateZoneAssumed} />
      {item.dateSource === 'atividade_vinculada' && item.scheduledDate && item.shiftDays ? <div className="tlShift">programado {dmy(item.scheduledDate)} · executado {item.shiftDays > 0 ? '+' : ''}{item.shiftDays} dia(s)</div> : null}
      {item.activityNote ? <div><span className="tlTag prog" title={NOTE_LABEL[item.activityNote].title}>{NOTE_LABEL[item.activityNote].text}</span></div> : null}
    </>
  );
}

function DateTag({ source, zoneAssumed }: { source: DateSource; zoneAssumed: boolean }) {
  return source === 'atividade_vinculada'
    ? <span className="tlTag real" title={zoneAssumed ? 'Dia em que o treino foi executado, segundo a atividade vinculada; a fonte não informou o fuso, então o dia foi calculado no horário de São Paulo' : 'Dia em que o treino foi executado, segundo a atividade importada vinculada'}>{zoneAssumed ? 'data real · fuso presumido (SP)' : 'data real'}</span>
    : source === 'programada'
      ? <span className="tlTag prog" title="Não há atividade vinculada: vale a data programada do treino">só programada</span>
      : <span className="tlTag prog" title="Não há atividade vinculada nem sessão programada: vale o dia em que a aluna registrou">só registro</span>;
}

export default function StudentTrainingLoad({ studentId, accessToken, apiUrl }: { studentId: string; accessToken: string; apiUrl: string }) {
  const today = localToday();
  const [from, setFrom] = useState(addDays(today, -83));
  const [to, setTo] = useState(today);
  const [view, setView] = useState<View>('geral');
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const rangeProblem = from > to ? 'A data inicial não pode ser depois da data final.' : null;

  const load = useCallback(async () => {
    if (rangeProblem) return;
    const mine = ++seq.current;
    setLoading(true); setError(null);
    try {
      const response = await fetch(`${apiUrl}/coach/students/${studentId}/training-load?from=${from}&to=${to}`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (mine !== seq.current) return;
      if (!response.ok) { setData(null); setError(response.status === 400 ? 'Confira as datas escolhidas.' : 'Não foi possível carregar agora.'); setLoading(false); return; }
      setData((await response.json()) as Result);
    } catch { if (mine === seq.current) { setData(null); setError('Não foi possível carregar agora.'); } }
    if (mine === seq.current) setLoading(false);
  }, [apiUrl, studentId, accessToken, from, to, rangeProblem]);

  useEffect(() => { const t = setTimeout(() => void load(), 250); return () => clearTimeout(t); }, [load]);
  useEffect(() => { seq.current += 1; setData(null); setError(null); setLoading(false); setView('geral'); }, [studentId]);

  const current = data?.views[view];
  const inView = <T extends { group: Group }>(list: T[]) => (view === 'geral' ? list : list.filter((s) => s.group === view));
  const sessions = data ? inView(data.sessions) : [];
  const excluded = data ? inView(data.excluded) : [];
  const chart = (current?.weeks ?? []).map((w) => ({ label: dm(w.weekStart), load: w.load, ratio: w.window.ratio, week: w }));
  // So' mostra o filtro de uma modalidade se ela tem algum treino (entrou ou ficou de fora) no periodo.
  const available = (v: View) => v === 'geral' || (data ? data.sessions.some((s) => s.group === v) || data.excluded.some((s) => s.group === v) : false);
  useEffect(() => { if (data && view !== 'geral' && !available(view)) setView('geral'); }); // a modalidade escolhida sumiu com o novo periodo: volta ao geral

  return (
    <div className="tlTab">
      <div className="tlBanner" role="note">
        <FlaskConical size={20} />
        <div>
          <strong>MÉTRICA NOVA — EM AVALIAÇÃO (criada em 23/10/2026)</strong>
          <p>É a carga de treino do próprio Panzeri Run: esforço percebido × minutos. Está aqui para você olhar, criticar e decidir se vale. Ela <strong>descreve o que a aluna fez</strong>; não é recomendação, <strong>não tem faixa de risco</strong> e o <strong>Atlas ainda não usa</strong>. Tudo o que entrou na conta aparece abaixo, com a origem da data e da duração.</p>
        </div>
      </div>

      <section className="tlMethod" aria-label="Como foi calculada">
        <h3><Calculator size={17} /> Como foi calculada</h3>
        <p className="tlFormula">{data?.method.formula ?? 'Carga da sessão (UA) = esforço percebido (1 a 10) × minutos. Razão = carga dos últimos 7 dias ÷ média semanal dos últimos 28 dias.'}</p>
        <ol>{(data?.method.steps ?? []).map((step) => <li key={step}>{step}</li>)}</ol>
        {data?.example ? <p className="tlExample">Exemplo com o treino mais recente que entrou: {dmy(data.example.date)} — esforço {data.example.rpe} × {min2(data.example.minutes)} min = <strong>{ua(data.example.load)}</strong>.</p> : null}
        <h4>O que fica de fora</h4>
        <ul>{(data?.method.leftOut ?? []).map((item) => <li key={item}>{item}</li>)}</ul>
        {data ? <p className="tlVersion">Versão do cálculo: {data.method.version}</p> : null}
      </section>

      <div className="tlControls">
        <div className="hrField"><label htmlFor="tl-from">De</label><input id="tl-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="hrField"><label htmlFor="tl-to">Até</label><input id="tl-to" type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} /></div>
        <div className="hrShortcuts" role="group" aria-label="Atalhos de período">
          {[28, 84, 180, 365].map((d) => <button key={d} type="button" onClick={() => { setTo(today); setFrom(addDays(today, -(d - 1))); }}>{d === 28 ? '4 semanas' : d === 84 ? '12 semanas' : d === 180 ? '6 meses' : '1 ano'}</button>)}
        </div>
        {loading ? <span className="hrFootnote">Atualizando…</span> : null}
      </div>
      {rangeProblem ? <p className="hrNotice bad"><span>{rangeProblem}</span></p> : null}
      {error ? <p className="hrNotice bad"><span>{error} <button type="button" className="hrLink" onClick={() => void load()}>Tentar de novo</button></span></p> : null}
      {!data && !error ? <p className="hrEmpty">Carregando…</p> : null}

      {data && current ? (
        <>
          <div className="tlViews" role="group" aria-label="Modalidade">
            {(['geral', 'corrida', 'forca', 'outras'] as View[]).filter(available).map((v) => (
              <button key={v} type="button" className={view === v ? 'active' : ''} aria-pressed={view === v} onClick={() => setView(v)}>{VIEW_LABEL[v]}</button>
            ))}
          </div>
          {view === 'geral' ? <p className="hrNotice warn"><span><strong>Visão geral:</strong> {data.method.generalViewNote}</span></p> : <p className="hrFootnote">Visão só de {VIEW_LABEL[view].toLowerCase()}: a razão e as barras usam apenas os treinos dessa modalidade.</p>}

          <div className="tlSummary">
            <div><small>Carga nos últimos 7 dias</small><strong>{ua(current.current.acuteLoad)}</strong><em>até {dmy(current.current.asOf)}</em></div>
            <div><small>Média semanal dos últimos 28 dias</small><strong>{ua(current.current.chronicWeeklyAverage)}</strong><em>soma de 28 dias: {ua(current.current.chronicLoad)}</em></div>
            <div className="tlRatio"><small>Razão (aguda ÷ crônica)</small><strong>{current.current.ratio == null ? '—' : current.current.ratio.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong><em>{current.current.ratio == null ? 'ainda não existe' : '1,00 = igual ao hábito dos 28 dias'}</em></div>
            <div><small>Treinos no período</small><strong>{current.totals.sessions} entraram</strong><em>{current.totals.excluded} ficaram de fora</em></div>
          </div>
          {current.current.note ? <p className="hrNotice warn"><span>{current.current.note}</span></p> : null}
          <p className="hrFootnote">
            Origem dos {sessions.length} treinos que entraram {view === 'geral' ? 'no período' : `na visão de ${VIEW_LABEL[view].toLowerCase()}`}: <strong>{sessions.filter((s) => s.dateSource === 'atividade_vinculada').length}</strong> com data real (atividade vinculada), <strong>{sessions.filter((s) => s.dateSource === 'programada').length}</strong> só com a data programada
            {sessions.some((s) => s.dateSource === 'registro') ? <> e <strong>{sessions.filter((s) => s.dateSource === 'registro').length}</strong> só com o dia do registro</> : null};
            duração <strong>informada pela aluna</strong> em {sessions.filter((s) => s.durationSource === 'informada').length} e <strong>da atividade importada</strong> em {sessions.filter((s) => s.durationSource === 'atividade_importada').length}.
          </p>

          {current.weeks.length === 0 || current.totals.sessions + current.totals.excluded === 0 ? (
            <p className="hrEmpty">Nenhum treino {view === 'geral' ? '' : `de ${VIEW_LABEL[view].toLowerCase()} `}feito neste período para calcular.</p>
          ) : (
            <div className="hrChart" role="img" aria-label="Carga semanal e razão aguda por crônica">
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                  <XAxis dataKey="label" fontSize={11} interval="preserveStartEnd" />
                  <YAxis yAxisId="ua" fontSize={11} />
                  <YAxis yAxisId="ratio" orientation="right" fontSize={11} domain={[0, 'auto']} />
                  <Tooltip content={<WeekTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar yAxisId="ua" dataKey="load" name={view === 'geral' ? 'Carga da semana (UA, soma de modalidades)' : `Carga da semana (UA, ${VIEW_LABEL[view].toLowerCase()})`} fill="#0f766e" isAnimationActive={false} />
                  <Line yAxisId="ratio" type="monotone" dataKey="ratio" name="Razão aguda ÷ crônica" stroke="#7c3aed" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
                  <ReferenceLine yAxisId="ratio" y={1} stroke="#64748b" strokeDasharray="5 4" label={{ value: '1,0 = igual ao hábito', fontSize: 11, fill: '#64748b', position: 'insideTopRight' }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
          <p className="hrFootnote">Semana em andamento (ou cortada pelo período) aparece incompleta. A linha roxa só existe a partir de 28 dias de histórico. Não há faixa de “bom”, “ruim” ou de risco de propósito: a métrica descreve, quem interpreta é você.</p>

          <h3 className="tlH">Treinos que entraram na conta ({sessions.length})</h3>
          {sessions.length === 0 ? <p className="hrEmpty">Nenhum treino com esforço percebido e duração neste período{view === 'geral' ? '' : ' nesta modalidade'}.</p> : (
            <div className="hrSessionsWrap">
              <table className="hrSessions">
                <thead><tr><th>Dia</th><th>Modalidade</th><th>Treino</th><th>Esforço</th><th>Minutos (origem)</th><th>Carga</th></tr></thead>
                <tbody>
                  {[...sessions].reverse().map((s) => (
                    <tr key={s.id}>
                      <td><DateCell item={s} /></td>
                      <td>{mod(s.modality)}{s.isExtra ? ' · extra' : ''}{s.adjusted ? ' · com ajustes' : ''}</td><td>{s.title ?? '—'}</td>
                      <td>{s.rpe}</td>
                      <td>{min2(s.minutes)} <span className={`tlTag ${s.durationSource === 'informada' ? 'prog' : 'real'}`}>{s.durationSource === 'informada' ? 'informada pela aluna' : `atividade ${s.durationProvider ? PROVIDER[s.durationProvider] ?? s.durationProvider : 'importada'}`}</span></td>
                      <td><strong>{s.rpe} × {min2(s.minutes)} = {ua(s.load)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3 className="tlH">Ficaram de fora ({excluded.length})</h3>
          {excluded.length === 0 ? <p className="hrEmpty">Nenhum treino ficou de fora neste período{view === 'geral' ? '' : ' nesta modalidade'}.</p> : (
            <div className="hrSessionsWrap">
              <table className="hrSessions">
                <thead><tr><th>Dia</th><th>Modalidade</th><th>Treino</th><th>Esforço</th><th>Minutos</th><th>Motivo</th></tr></thead>
                <tbody>
                  {[...excluded].reverse().map((s) => (
                    <tr key={s.id}><td><DateCell item={s} /></td><td>{mod(s.modality)}{s.isExtra ? ' · extra' : ''}</td><td>{s.title ?? '—'}</td><td>{s.rpe ?? '—'}</td><td>{s.minutes != null ? min2(s.minutes) : '—'}</td><td>{REASON[s.reason]}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <section className="tlQuestions" aria-label="Para você pensar">
            <h3><Lightbulb size={17} /> Para você pensar e decidir</h3>
            <ol>{OPEN_QUESTIONS.map((q) => <li key={q}>{q}</li>)}</ol>
          </section>
        </>
      ) : null}
    </div>
  );
}

function WeekTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { week: Week } }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const w = payload[0].payload.week;
  return (
    <div className="hrTooltip">
      <strong>Semana de {dmy(w.weekStart)} a {dmy(w.weekEnd)}{w.inProgress ? ' (em andamento)' : ''}</strong>
      {w.clipped ? <div className="hrTipLimit">Semana recortada pelo período escolhido: a barra soma só os dias dentro do período.</div> : null}
      <div>Carga da semana: <b>{ua(w.load)}</b> em {w.sessions} treino(s){w.excluded > 0 ? ` (+${w.excluded} de fora)` : ''}</div>
      <div>Aguda (7 dias): {ua(w.window.acuteLoad)}</div>
      <div>Crônica (média semanal de 28 dias): {ua(w.window.chronicWeeklyAverage)}</div>
      <div>Razão: <b>{w.window.ratio == null ? 'ainda não existe' : w.window.ratio.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</b></div>
      {w.window.note ? <div className="hrTipLimit">{w.window.note}</div> : null}
    </div>
  );
}
