'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Area, Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Calculator, Info } from 'lucide-react';

// Aluna > Evolução > Explorar > Treinos > "Carga acumulada e semanas" (01/11/2026). CARGA INTERNA PERCEBIDA = PSE (1 a 10) × duração em minutos, em UA. SOMENTE LEITURA: GET /coach/students/:id/training-load.
// A conta inteira vem pronta do servidor e é MOSTRADA aqui (como foi calculada, cada treino que entrou — com a ORIGEM da data e da duração —, cada treino que ficou de fora e o motivo). É a MESMA fonte que alimenta
// o Explorar (variável "Carga interna percebida da sessão") e o contexto dos agentes de IA: o painel nunca recalcula a métrica. Descreve o que a aluna fez: não é recomendação nem faixa de risco, e a IA a interpreta
// junto com as demais evidências (sono, dor, fadiga, satisfação...). Três visões: Sessões (principal), Carga acumulada (7 e 28 dias) e Semanas.

type Group = 'corrida' | 'forca' | 'outras';
type View = 'geral' | Group;
type Mode = 'sessoes' | 'acumulada' | 'semanas';
type DateSource = 'atividade_vinculada' | 'programada' | 'registro';
type Note = 'vinculo_distante' | 'vinculo_confirmado' | 'atividade_ja_usada' | null;
type Session = {
  id: string; sessionId: string | null; activityLogId: string | null; date: string; dateSource: DateSource; scheduledDate: string | null; shiftDays: number | null; dateZoneAssumed: boolean; activityNote: Note; modality: string | null; group: Group; title: string | null; isExtra: boolean; adjusted: boolean;
  informedMinutes: number | null; rpe: number; minutes: number; durationSource: 'informada' | 'atividade_importada'; durationProvider: string | null; load: number;
};
type Excluded = { id: string; date: string; dateSource: DateSource; scheduledDate: string | null; shiftDays: number | null; dateZoneAssumed: boolean; activityNote: Note; modality: string | null; group: Group; title: string | null; isExtra: boolean; reason: 'sem_esforco' | 'sem_duracao' | 'sem_esforco_e_duracao'; rpe: number | null; minutes: number | null };
type Window = { asOf: string; acuteLoad: number; chronicLoad: number; chronicWeeklyAverage: number; ratio: number | null; chronicDaysCovered: number; sessionsInWindow: number; minSessions: number; excludedInWindow: number; note: string | null };
type Week = { weekStart: string; weekEnd: string; inProgress: boolean; clipped: boolean; load: number; sessions: number; excluded: number; window: Window };
type ViewResult = { weeks: Week[]; current: Window; totals: { sessions: number; excluded: number; load: number } };
type Diff = { absolute: number; percent: number | null } | null;
type Signal = 'above' | 'below' | 'within' | 'no_reference';
type Comparison = {
  id: string; sessionId: string | null; date: string; modality: string | null; title: string | null; rpe: number; minutes: number; load: number; durationSource: 'informada' | 'atividade_importada'; durationProvider: string | null;
  priorN: number; historicalMean: { value: number | null; n: number };
  movingAverages: Array<{ key: string; label: string; value: number | null; n: number; partial: boolean }>;
  band: { lower: number | null; upper: number | null; median: number | null; n: number; basis: 'individual' | 'limited' | 'none' };
  signal: Signal; outsideBy: number | null; vsHistoricalMean: Diff; vsMoving7: Diff; sufficient: boolean;
};
type RefView = {
  group: Group; modalities: string[]; eligibleSessions: number; unit: string; windows: Array<{ key: string; label: string }>;
  bandPolicy: { method: string; windowSize: number; individualMin: number; limitedMin: number };
  last: Comparison | null;
  points: Array<{ date: string; load: number; rpe: number | null; minutes: number | null; mm7: number | null; lower: number | null; upper: number | null; signal: Signal }>;
};
type Result = {
  method: { version: string; formula: string; steps: string[]; leftOut: string[]; generalViewNote: string };
  period: { from: string; to: string }; sessions: Session[]; excluded: Excluded[]; views: Record<View, ViewResult>;
  sources: { dateReal: number; dateProgrammedOnly: number; dateRegisteredOnly: number; durationInformed: number; durationImported: number };
  example: { date: string; rpe: number; minutes: number; load: number } | null;
  references?: Partial<Record<Group, RefView>>;
};

const REASON: Record<Excluded['reason'], string> = { sem_esforco: 'sem esforço percebido (PSE)', sem_duracao: 'sem duração (nem informada, nem de atividade vinculada)', sem_esforco_e_duracao: 'sem esforço percebido e sem duração' };
const MODALITY: Record<string, string> = { corrida: 'Corrida', esteira: 'Esteira', forca: 'Força', fortalecimento_corredores: 'Fortalecimento', caminhada: 'Caminhada' };
const PROVIDER: Record<string, string> = { polar: 'Polar', zepp: 'Zepp', health_connect: 'Health Connect', apple_health: 'Apple Saúde', wahoo: 'Wahoo', coros: 'COROS' };
const VIEW_LABEL: Record<View, string> = { geral: 'Geral (soma)', corrida: 'Corrida', forca: 'Força', outras: 'Outras' };
const MODE_LABEL: Record<Mode, string> = { sessoes: 'Sessões', acumulada: 'Carga acumulada', semanas: 'Semanas' };
const SIGNAL_TEXT: Record<Signal, string> = { above: 'acima da faixa habitual dela', below: 'abaixo da faixa habitual dela', within: 'dentro da faixa habitual dela', no_reference: 'sem referência suficiente' };
const BASIS_TEXT: Record<Comparison['band']['basis'], string> = { individual: 'faixa individual (12 ou mais sessões anteriores)', limited: 'faixa LIMITADA: poucas sessões anteriores (de 4 a 11), leia com cautela', none: 'SEM faixa: menos de 4 sessões anteriores da modalidade (amostra insuficiente; isso não significa “normal”)' };

const localToday = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; };
const addDays = (date: string, days: number) => new Date(new Date(`${date}T12:00:00.000Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
const dmy = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
const dm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
const ua = (value: number) => `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} UA`;
const mod = (m: string | null) => (m ? MODALITY[m] ?? m : '—');
const min2 = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const diffText = (d: Diff) => (d == null ? '—' : `${d.absolute > 0 ? '+' : ''}${ua(d.absolute)}${d.percent != null ? ` (${d.percent > 0 ? '+' : ''}${d.percent.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%)` : ''}`);

const NOTE_LABEL: Record<NonNullable<Note>, { text: string; title: string }> = {
  vinculo_distante: { text: 'vínculo distante ignorado', title: 'A atividade vinculada fica longe demais do dia programado (mais de 3 dias se o vínculo foi automático; mais de 6 se foi confirmado por pessoa): não foi usada, vale a data programada.' },
  vinculo_confirmado: { text: 'vínculo confirmado por pessoa', title: 'A atividade fica a mais de 3 dias do dia programado, mas o vínculo foi confirmado pela aluna ou pelo treinador: foi usada.' },
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
  const [view, setView] = useState<View>('corrida');
  const [mode, setMode] = useState<Mode>('sessoes');
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
  useEffect(() => { seq.current += 1; setData(null); setError(null); setLoading(false); setView('corrida'); setMode('sessoes'); }, [studentId]);

  const current = data?.views[view];
  const inView = <T extends { group: Group }>(list: T[]) => (view === 'geral' ? list : list.filter((s) => s.group === view));
  const sessions = data ? inView(data.sessions) : [];
  const excluded = data ? inView(data.excluded) : [];
  // So' mostra o filtro de uma modalidade se ela tem algum treino (entrou ou ficou de fora) no periodo.
  const available = (v: View) => v === 'geral' || (data ? data.sessions.some((s) => s.group === v) || data.excluded.some((s) => s.group === v) : false);
  // A modalidade escolhida sumiu com o novo periodo: vai para a primeira disponivel (a visao geral e' so' a soma agregada).
  useEffect(() => { if (data && !available(view)) setView((['corrida', 'forca', 'outras'] as Group[]).find(available) ?? 'geral'); });
  const reference = view !== 'geral' ? data?.references?.[view] : undefined;
  const last = reference?.last ?? null;

  return (
    <div className="tlTab">
      <div className="tlBanner" role="note">
        <Info size={20} />
        <div>
          <strong>Carga interna percebida · PSE × minutos</strong>
          <p>É a exigência que cada sessão representou para a aluna: <strong>esforço percebido (PSE, 1 a 10) × duração em minutos</strong>, em UA (unidade arbitrária). PSE, duração e carga são sempre mostradas <strong>separadas</strong> — duas sessões podem ter a mesma carga com combinações muito diferentes de esforço e tempo. Ela <strong>descreve</strong> o que a aluna fez: não é recomendação, não tem faixa de risco e <strong>uma carga alta não significa experiência ruim, nem recuperação insuficiente</strong> (a sessão pode ter sido muito exigente e também prazerosa). A IA recebe esta mesma métrica, por modalidade, e a interpreta junto com sono, dor, fadiga, satisfação e demais dados.</p>
        </div>
      </div>

      <details className="tlMethod" aria-label="Como foi calculada">
        <summary><Calculator size={17} /> Como foi calculada (detalhes do método)</summary>
        <p className="tlFormula">{data?.method.formula ?? 'Carga da sessão (UA) = esforço percebido (1 a 10) × minutos. Razão = carga dos últimos 7 dias ÷ média semanal dos últimos 28 dias.'}</p>
        <ol>{(data?.method.steps ?? []).map((step) => <li key={step}>{step}</li>)}</ol>
        <h4>Comparação da sessão com o histórico</h4>
        <ul>
          <li>A sessão investigada <strong>nunca entra</strong> nas médias e na faixa usadas para compará-la: as referências usam só sessões <strong>anteriores</strong> da <strong>mesma modalidade</strong> (a mesma metodologia dos demais indicadores da Evolução).</li>
          <li>Média histórica = todas as sessões elegíveis anteriores. Médias móveis = últimas 7, 21, 60 e 200 sessões anteriores. Faixa habitual = percentis 10 a 90 das anteriores (até 200).</li>
          <li>Com 12 ou mais sessões anteriores a faixa é individual; de 4 a 11 é limitada (poucos dados); com menos de 4 não há faixa — e isso nunca é tratado como “normal”.</li>
          <li>Duas sessões da mesma modalidade no mesmo dia compartilham a mesma referência (nenhuma entra na referência da outra). O sinal só diz de que lado da faixa individual a carga ficou; não é melhora, piora, bom nem ruim.</li>
        </ul>
        {data?.example ? <p className="tlExample">Exemplo com o treino mais recente que entrou: {dmy(data.example.date)} — esforço {data.example.rpe} × {min2(data.example.minutes)} min = <strong>{ua(data.example.load)}</strong>.</p> : null}
        <h4>O que fica de fora</h4>
        <ul>{(data?.method.leftOut ?? []).map((item) => <li key={item}>{item}</li>)}</ul>
        {data ? <p className="tlVersion">Versão do cálculo: {data.method.version}</p> : null}
      </details>

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
          <div className="tlViews" role="group" aria-label="Visão">
            {(['sessoes', 'acumulada', 'semanas'] as Mode[]).map((m) => <button key={m} type="button" className={mode === m ? 'active' : ''} aria-pressed={mode === m} onClick={() => setMode(m)}>{MODE_LABEL[m]}</button>)}
          </div>
          <div className="tlViews" role="group" aria-label="Modalidade">
            {(['corrida', 'forca', 'outras', 'geral'] as View[]).filter(available).map((v) => (
              <button key={v} type="button" className={view === v ? 'active' : ''} aria-pressed={view === v} onClick={() => setView(v)}>{VIEW_LABEL[v]}</button>
            ))}
          </div>
          {view === 'geral' ? <p className="hrNotice warn"><span><strong>Visão agregada:</strong> {data.method.generalViewNote}</span></p> : <p className="hrFootnote">Modalidade: {VIEW_LABEL[view].toLowerCase()}. As referências, a razão e os gráficos usam apenas os treinos dessa modalidade.</p>}

          {mode === 'sessoes' ? (
            <>
              {view === 'geral' ? (
                <p className="hrNotice warn"><span>A comparação de cada sessão com o histórico é sempre <strong>por modalidade</strong>: escolha Corrida, Força ou Outras acima. Abaixo estão as sessões de todas as modalidades, em ordem cronológica.</span></p>
              ) : last ? (
                <>
                  <h3 className="tlH">Sessão mais recente de {VIEW_LABEL[view].toLowerCase()} · {dmy(last.date)}</h3>
                  <div className="tlSummary">
                    <div><small>PSE da sessão</small><strong>{last.rpe}</strong><em>esforço percebido (1 a 10)</em></div>
                    <div><small>Duração usada</small><strong>{min2(last.minutes)} min</strong><em>{last.durationSource === 'informada' ? 'informada pela aluna' : `atividade ${last.durationProvider ? PROVIDER[last.durationProvider] ?? last.durationProvider : 'importada'}`}</em></div>
                    <div><small>Carga interna percebida</small><strong>{ua(last.load)}</strong><em>{last.rpe} × {min2(last.minutes)}</em></div>
                    <div className="tlRatio"><small>Posição na faixa habitual</small><strong style={{ fontSize: 14 }}>{SIGNAL_TEXT[last.signal]}</strong><em>só vs. {last.priorN} sessão(ões) anterior(es)</em></div>
                  </div>
                  <div className="tlSummary" style={{ marginTop: 8 }}>
                    <div><small>Média histórica anterior</small><strong>{last.historicalMean.value != null ? ua(last.historicalMean.value) : '—'}</strong><em>{last.historicalMean.n} sessão(ões) · esta: {diffText(last.vsHistoricalMean)}</em></div>
                    {last.movingAverages.filter((m) => m.key === 'mm7' || m.key === 'mm21').map((m) => (
                      <div key={m.key}><small>{m.label.replace('registros', 'sessões')}</small><strong>{m.value != null ? ua(m.value) : '—'}</strong><em>{m.n} sessão(ões){m.partial ? ' · janela parcial' : ''}{m.key === 'mm7' ? ` · esta: ${diffText(last.vsMoving7)}` : ''}</em></div>
                    ))}
                    <div><small>Faixa habitual (P10–P90)</small><strong>{last.band.lower != null && last.band.upper != null ? `${min2(last.band.lower)} a ${min2(last.band.upper)}` : '—'}</strong><em>{last.band.n} sessão(ões) na base</em></div>
                  </div>
                  <p className={`hrNotice ${last.sufficient ? 'warn' : 'bad'}`}><span>{BASIS_TEXT[last.band.basis]}. {last.signal !== 'no_reference' && last.outsideBy != null ? `Fora da faixa por ${ua(Math.abs(last.outsideBy))}. ` : ''}O sinal é descritivo e neutro: não indica melhora, piora, risco nem recuperação.</span></p>
                  {reference && reference.points.length > 0 ? <SessionsChart ref_={reference} /> : null}
                  <p className="hrFootnote">Base de referência: {reference?.eligibleSessions} sessão(ões) elegível(is) de {reference?.modalities.map((m) => mod(m).toLowerCase()).join(' + ')}. A sessão mais recente fica fora da própria média e da própria faixa.</p>
                </>
              ) : (
                <p className="hrNotice warn"><span>Sem comparação com o histórico para {VIEW_LABEL[view].toLowerCase()} agora: não há sessão elegível (com PSE e duração) ou a camada de referências não respondeu. A lista de sessões abaixo continua válida.</span></p>
              )}
              <Origin sessions={sessions} view={view} />
              <SessionsTable sessions={sessions} />
              <ExcludedTable excluded={excluded} view={view} />
            </>
          ) : null}

          {mode === 'acumulada' ? (
            <>
              <h3 className="tlH">Carga acumulada · janelas móveis de 7 e 28 dias{view === 'geral' ? ' (visão agregada)' : ` · ${VIEW_LABEL[view].toLowerCase()}`}</h3>
              <div className="tlSummary">
                <div><small>Carga aguda (últimos 7 dias)</small><strong>{ua(current.current.acuteLoad)}</strong><em>até {dmy(current.current.asOf)}</em></div>
                <div><small>Carga crônica (média semanal de 28 dias)</small><strong>{ua(current.current.chronicWeeklyAverage)}</strong><em>soma de 28 dias: {ua(current.current.chronicLoad)}</em></div>
                <div className="tlRatio"><small>Razão aguda ÷ crônica</small><strong>{current.current.ratio == null ? '—' : current.current.ratio.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong><em>{current.current.ratio == null ? 'ainda não existe' : '1,00 = igual ao hábito dos 28 dias'} · {current.current.sessionsInWindow} de {current.current.minSessions} treinos mínimos nos 28 dias</em></div>
                <div><small>Treinos no período</small><strong>{current.totals.sessions} entraram</strong><em>{current.totals.excluded} ficaram de fora</em></div>
              </div>
              {current.current.note ? <p className="hrNotice warn"><span>{current.current.note}</span></p> : null}
              <AccumulatedChart weeks={current.weeks} view={view} />
              <p className="hrFootnote">As janelas são móveis (7 e 28 dias terminando em cada ponto) e atualizam a cada sessão, sem esperar o fim da semana do calendário. A sessão mais recente entra normalmente nas janelas. A razão é uma <strong>relação descritiva</strong> entre cargas acumuladas — não é diagnóstico de risco de lesão, fadiga ou prontidão — e só existe com 28 dias de histórico e pelo menos 10 treinos nos 28 dias.</p>
            </>
          ) : null}

          {mode === 'semanas' ? (
            <>
              <h3 className="tlH">Carga por semana{view === 'geral' ? ' (visão agregada)' : ` · ${VIEW_LABEL[view].toLowerCase()}`}</h3>
              <WeeksChart weeks={current.weeks} view={view} empty={current.totals.sessions + current.totals.excluded === 0} />
              <p className="hrFootnote">Semana em andamento (ou cortada pelo período) aparece incompleta. A linha roxa só existe com 28 dias de histórico e pelo menos 10 treinos nos últimos 28 dias. Não há faixa de “bom”, “ruim” ou de risco de propósito.</p>
              <Origin sessions={sessions} view={view} />
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function Origin({ sessions, view }: { sessions: Session[]; view: View }) {
  return (
    <p className="hrFootnote">
      Origem dos {sessions.length} treinos que entraram {view === 'geral' ? 'no período' : `na visão de ${VIEW_LABEL[view].toLowerCase()}`}: <strong>{sessions.filter((s) => s.dateSource === 'atividade_vinculada').length}</strong> com data real (atividade vinculada), <strong>{sessions.filter((s) => s.dateSource === 'programada').length}</strong> só com a data programada
      {sessions.some((s) => s.dateSource === 'registro') ? <> e <strong>{sessions.filter((s) => s.dateSource === 'registro').length}</strong> só com o dia do registro</> : null};
      duração <strong>informada pela aluna</strong> em {sessions.filter((s) => s.durationSource === 'informada').length} e <strong>da atividade importada</strong> em {sessions.filter((s) => s.durationSource === 'atividade_importada').length}.
    </p>
  );
}

function SessionsTable({ sessions }: { sessions: Session[] }) {
  return (
    <>
      <h3 className="tlH">Sessões que entraram na conta ({sessions.length})</h3>
      {sessions.length === 0 ? <p className="hrEmpty">Nenhuma sessão com esforço percebido e duração neste período.</p> : (
        <div className="hrSessionsWrap">
          <table className="hrSessions">
            <thead><tr><th>Dia</th><th>Modalidade</th><th>Treino</th><th>PSE</th><th>Minutos (origem)</th><th>Carga interna</th></tr></thead>
            <tbody>
              {[...sessions].reverse().map((s) => (
                <tr key={s.id}>
                  <td><DateCell item={s} /></td>
                  <td>{mod(s.modality)}{s.isExtra ? ' · extra' : ''}{s.adjusted ? ' · com ajustes' : ''}</td><td>{s.title ?? '—'}</td>
                  <td>{s.rpe}</td>
                  <td>{min2(s.minutes)} <span className={`tlTag ${s.durationSource === 'informada' ? 'prog' : 'real'}`}>{s.durationSource === 'informada' ? 'informada pela aluna' : `atividade ${s.durationProvider ? PROVIDER[s.durationProvider] ?? s.durationProvider : 'importada'}`}</span>{s.informedMinutes != null ? <div className="tlShift">a aluna informou {min2(s.informedMinutes)} min</div> : null}</td>
                  <td><strong>{s.rpe} × {min2(s.minutes)} = {ua(s.load)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function ExcludedTable({ excluded, view }: { excluded: Excluded[]; view: View }) {
  return (
    <>
      <h3 className="tlH">Ficaram de fora ({excluded.length})</h3>
      {excluded.length === 0 ? <p className="hrEmpty">Nenhum treino ficou de fora neste período{view === 'geral' ? '' : ' nesta modalidade'}.</p> : (
        <div className="hrSessionsWrap">
          <table className="hrSessions">
            <thead><tr><th>Dia</th><th>Modalidade</th><th>Treino</th><th>PSE</th><th>Minutos</th><th>Motivo da exclusão</th></tr></thead>
            <tbody>
              {[...excluded].reverse().map((s) => (
                <tr key={s.id}><td><DateCell item={s} /></td><td>{mod(s.modality)}{s.isExtra ? ' · extra' : ''}</td><td>{s.title ?? '—'}</td><td>{s.rpe ?? '—'}</td><td>{s.minutes != null ? min2(s.minutes) : '—'}</td><td>{REASON[s.reason]}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// Grafico por sessao: carga de cada sessao (barras), media movel das 7 sessoes ANTERIORES (linha) e faixa habitual (area). Tudo vem do servidor (reference-series): nada e' calculado aqui.
function SessionsChart({ ref_ }: { ref_: RefView }) {
  const pts = ref_.points.map((p, i) => ({ i, label: dm(p.date), date: p.date, load: p.load, rpe: p.rpe, minutes: p.minutes, mm7: p.mm7, band: p.lower != null && p.upper != null ? [p.lower, p.upper] : undefined, signal: p.signal }));
  return (
    <div className="hrChart" role="img" aria-label="Carga interna por sessão com média móvel e faixa habitual">
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={pts} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
          <XAxis dataKey="i" fontSize={11} interval="preserveStartEnd" tickFormatter={(i: number) => pts[i]?.label ?? ''} />
          <YAxis fontSize={11} />
          <Tooltip content={<SessionTooltip />} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Area dataKey="band" name="Faixa habitual (P10–P90 das sessões anteriores)" stroke="none" fill="#7c3aed" fillOpacity={0.14} isAnimationActive={false} connectNulls={false} />
          <Bar dataKey="load" name="Carga da sessão (UA)" fill="#0f766e" isAnimationActive={false} />
          <Line type="monotone" dataKey="mm7" name="Média móvel das 7 sessões anteriores" stroke="#7c3aed" strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function SessionTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { date: string; load: number; rpe: number | null; minutes: number | null; mm7: number | null; band?: number[]; signal: Signal } }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div className="hrTooltip">
      <strong>{dmy(p.date)}</strong>
      <div>Carga: <b>{ua(p.load)}</b>{p.rpe != null && p.minutes != null ? ` (PSE ${p.rpe} × ${min2(p.minutes)} min)` : ''}</div>
      <div>Média móvel das 7 anteriores: {p.mm7 != null ? ua(p.mm7) : '—'}</div>
      <div>Faixa habitual: {p.band ? `${min2(p.band[0])} a ${min2(p.band[1])}` : 'sem faixa (amostra insuficiente)'}</div>
      <div>{SIGNAL_TEXT[p.signal]}</div>
    </div>
  );
}

function AccumulatedChart({ weeks, view }: { weeks: Week[]; view: View }) {
  if (weeks.length === 0) return <p className="hrEmpty">Nenhum treino neste período para calcular.</p>;
  const chart = weeks.map((w) => ({ label: dm(w.window.asOf), acute: w.window.acuteLoad, chronic: w.window.chronicWeeklyAverage, ratio: w.window.ratio, week: w }));
  return (
    <div className="hrChart" role="img" aria-label="Carga aguda, carga crônica e razão ao longo do tempo">
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
          <XAxis dataKey="label" fontSize={11} interval="preserveStartEnd" />
          <YAxis yAxisId="ua" fontSize={11} />
          <YAxis yAxisId="ratio" orientation="right" fontSize={11} domain={[0, 'auto']} />
          <Tooltip content={<WeekTooltip />} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line yAxisId="ua" type="monotone" dataKey="acute" name={`Aguda: soma de 7 dias (UA${view === 'geral' ? ', agregada' : ''})`} stroke="#0f766e" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
          <Line yAxisId="ua" type="monotone" dataKey="chronic" name="Crônica: média semanal de 28 dias (UA)" stroke="#64748b" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
          <Line yAxisId="ratio" type="monotone" dataKey="ratio" name="Razão aguda ÷ crônica" stroke="#7c3aed" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
          <ReferenceLine yAxisId="ratio" y={1} stroke="#64748b" strokeDasharray="5 4" label={{ value: '1,0 = igual ao hábito', fontSize: 11, fill: '#64748b', position: 'insideTopRight' }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function WeeksChart({ weeks, view, empty }: { weeks: Week[]; view: View; empty: boolean }) {
  if (weeks.length === 0 || empty) return <p className="hrEmpty">Nenhum treino {view === 'geral' ? '' : `de ${VIEW_LABEL[view].toLowerCase()} `}feito neste período para calcular.</p>;
  const chart = weeks.map((w) => ({ label: dm(w.weekStart), load: w.load, ratio: w.window.ratio, week: w }));
  return (
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
      <div>Aguda (7 dias até {dmy(w.window.asOf)}): {ua(w.window.acuteLoad)}</div>
      <div>Crônica (média semanal de 28 dias): {ua(w.window.chronicWeeklyAverage)}</div>
      <div>Razão: <b>{w.window.ratio == null ? 'ainda não existe' : w.window.ratio.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</b></div>
      {w.window.note ? <div className="hrTipLimit">{w.window.note}</div> : null}
    </div>
  );
}
