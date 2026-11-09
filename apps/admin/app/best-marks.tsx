'use client';

import React, { useCallback, useEffect, useState } from 'react';

// Aluno > Evolução > "Melhores marcas" (09/11/2026). Só LEITURA: GET /coach/students/:id/best-marks (mesma conta da tela da aluna). Mostra, por distância, a melhor marca registrada e a origem do tempo
// (relógio, registro manual, teste de 3 km; trecho de corrida maior; tempo sem série). O relato da entrevista fica em tabela à parte e nunca se mistura com as marcas registradas.
type Mark = { distanceId: string; seconds: number; paceSecondsKm: number; activityId: string; startedAt: string; source: 'device' | 'manual' | 'test'; provider: string | null; method: 'whole' | 'segment'; timeBasis: 'series_clock' | 'duration' };
type DistanceMarks = { distanceId: string; label: string; meters: number; best: Mark | null; ranking: Mark[] };
type SelfReported = { rank: 1 | 2 | 3; distanceKm: number | null; distanceRaw: string | null; timesRun: number | null; timeSeconds: number | null };
type Result = { marks: DistanceMarks[]; selfReported: SelfReported[]; notes: string[] };

const two = (n: number) => String(n).padStart(2, '0');
const time = (total: number) => { const s = Math.round(total); const h = Math.floor(s / 3600); return h > 0 ? `${h}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}` : `${Math.floor(s / 60)}:${two(s % 60)}`; };
const pace = (s: number) => `${Math.floor(s / 60)}:${two(Math.round(s) % 60)} /km`;
const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const origin = (m: Mark) => [m.source === 'manual' ? 'registro manual' : m.source === 'test' ? 'teste de 3 km' : `relógio${m.provider ? ` (${m.provider})` : ''}`, m.method === 'segment' ? 'trecho de corrida maior' : null, m.source === 'device' && m.timeBasis === 'duration' ? 'tempo informado, sem série para conferir paradas' : null].filter(Boolean).join(' · ');

export default function BestMarks({ studentId, accessToken, apiUrl }: { studentId: string; accessToken: string; apiUrl: string }) {
  const [data, setData] = useState<Result | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = useCallback(async () => {
    setState('loading');
    try {
      const response = await fetch(`${apiUrl}/coach/students/${studentId}/best-marks`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!response.ok) throw new Error('falhou');
      setData((await response.json()) as Result);
      setState('ready');
    } catch {
      setState('error');
    }
  }, [apiUrl, studentId, accessToken]);
  useEffect(() => { void load(); }, [load]);

  if (state === 'loading' && !data) return <section className="integrationsWrap"><p>Carregando as melhores marcas...</p></section>;
  if (state === 'error' || !data) return <section className="integrationsWrap"><p role="alert">Não foi possível carregar as melhores marcas agora.</p></section>;
  const withMark = data.marks.filter((entry) => entry.best);
  return (
    <section className="integrationsWrap" aria-label="Melhores marcas">
      <header className="integrationsHeader"><div><h3>Melhores marcas</h3><p>Somente o que o Panzeri Run registrou. Somente leitura.</p></div></header>
      {withMark.length === 0 ? <p>Nenhuma marca registrada ainda.</p> : (
        <div className="extTableWrap">
          <table className="dataTable">
            <thead><tr><th>Distância</th><th>Melhor tempo</th><th>Pace</th><th>Data</th><th>Origem</th><th>Marcas registradas</th></tr></thead>
            <tbody>{withMark.map((entry) => { const best = entry.best as Mark; return (
              <tr key={entry.distanceId}><td>{entry.label}</td><td>{time(best.seconds)}</td><td>{pace(best.paceSecondsKm)}</td><td>{dmy(best.startedAt)}</td><td>{origin(best)}</td><td>{entry.ranking.length}</td></tr>
            ); })}</tbody>
          </table>
        </div>
      )}
      <p className="eqFine">{data.notes.slice(0, 2).join(' ')}</p>
      <h4>Relato da entrevista (não comprovado)</h4>
      {data.selfReported.length === 0 ? <p>Sem distâncias informadas na entrevista.</p> : (
        <div className="extTableWrap">
          <table className="dataTable">
            <thead><tr><th>Posição</th><th>Distância relatada</th><th>Vezes (6 meses)</th><th>Tempo relatado</th></tr></thead>
            <tbody>{data.selfReported.map((run) => (
              <tr key={run.rank}><td>{run.rank}ª maior</td><td>{run.distanceKm !== null ? `${String(run.distanceKm).replace('.', ',')} km` : (run.distanceRaw ?? '—')}</td><td>{run.timesRun ?? 'não informado'}</td><td>{run.timeSeconds !== null ? time(run.timeSeconds) : 'não informado'}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <p className="integrationsFooter"><button type="button" onClick={() => void load()}>Atualizar</button></p>
    </section>
  );
}
