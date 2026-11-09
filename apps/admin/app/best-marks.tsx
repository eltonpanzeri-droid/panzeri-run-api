'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BestMarksResult, ChartPoint, DistanceMarks, Mark, RANK_LABEL, chartPoints, fmtDate, fmtPace, fmtTime, howCollected, markKey, markTags, selfDistance, selfLine, summaryOf } from './best-marks-lib';

// Aluno > Evolução > "Melhores marcas" (09/11/2026). Só LEITURA: GET /coach/students/:id/best-marks (mesma conta da tela da aluna). Distâncias em cartões; clicar escolhe a distância; o gráfico de
// evolução e a lista das 10 melhores são clicáveis e mostram "como esta marca foi coletada". O relato da entrevista fica em cartões à parte e nunca se mistura com as marcas registradas.

const W = 640;
const H = 230;
const PAD = { left: 56, right: 16, top: 16, bottom: 28 };
const dayLabel = (day: number) => { const iso = new Date(day * 86_400_000).toISOString(); return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`; };

function EvolutionChart({ points, selectedKey, onSelect }: { points: ChartPoint[]; selectedKey: string | null; onSelect: (key: string) => void }) {
  const scale = useMemo(() => {
    let xMin = Math.min(...points.map((p) => p.day));
    let xMax = Math.max(...points.map((p) => p.day));
    if (xMax === xMin) { xMin -= 3; xMax += 3; }
    let yMin = Math.min(...points.map((p) => p.seconds));
    let yMax = Math.max(...points.map((p) => p.seconds));
    if (yMax === yMin) { yMin -= 30; yMax += 30; }
    const pad = (yMax - yMin) * 0.12;
    return { xMin, xMax, yMin: yMin - pad, yMax: yMax + pad };
  }, [points]);
  const sx = (day: number) => PAD.left + ((day - scale.xMin) / (scale.xMax - scale.xMin)) * (W - PAD.left - PAD.right);
  const sy = (seconds: number) => PAD.top + ((seconds - scale.yMin) / (scale.yMax - scale.yMin)) * (H - PAD.top - PAD.bottom);
  const records = points.filter((p) => p.isRecord);
  let stairs = '';
  records.forEach((p, i) => { stairs += i === 0 ? `M ${sx(p.day)} ${sy(p.seconds)}` : ` L ${sx(p.day)} ${sy(records[i - 1].seconds)} L ${sx(p.day)} ${sy(p.seconds)}`; });
  if (records.length > 0) stairs += ` L ${W - PAD.right} ${sy(records[records.length - 1].seconds)}`;
  const yTicks = [scale.yMin, (scale.yMin + scale.yMax) / 2, scale.yMax];
  const xTicks = [scale.xMin, (scale.xMin + scale.xMax) / 2, scale.xMax];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="bm-chart" role="img" aria-label="Evolução das marcas na distância escolhida">
      {yTicks.map((tick, i) => (<g key={i}><line x1={PAD.left} x2={W - PAD.right} y1={sy(tick)} y2={sy(tick)} stroke="#e5eaf0" /><text x={PAD.left - 8} y={sy(tick) + 4} fontSize="11" fill="#8b96a5" textAnchor="end">{fmtTime(tick)}</text></g>))}
      {xTicks.map((tick, i) => (<text key={i} x={sx(tick)} y={H - 8} fontSize="11" fill="#8b96a5" textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}>{dayLabel(Math.round(tick))}</text>))}
      {stairs ? <path d={stairs} fill="none" stroke="#2186d4" strokeWidth="2.5" opacity="0.5" /> : null}
      {points.map((p) => (
        <g key={p.key} onClick={() => onSelect(p.key)} style={{ cursor: 'pointer' }}>
          <title>{`${fmtDate(p.mark.localDate)} · ${fmtTime(p.seconds)}${p.isRecord ? ' · marca batida' : ''}`}</title>
          <circle cx={sx(p.day)} cy={sy(p.seconds)} r="14" fill="transparent" />
          {p.isRecord ? <circle cx={sx(p.day)} cy={sy(p.seconds)} r="7" fill="#1769aa" stroke="#fff" strokeWidth="2" /> : <circle cx={sx(p.day)} cy={sy(p.seconds)} r="4.5" fill="#fff" stroke="#8b96a5" strokeWidth="1.8" />}
          {p.key === selectedKey ? <circle cx={sx(p.day)} cy={sy(p.seconds)} r="12" fill="none" stroke="#123b67" strokeWidth="2" /> : null}
        </g>
      ))}
    </svg>
  );
}

export default function BestMarks({ studentId, accessToken, apiUrl }: { studentId: string; accessToken: string; apiUrl: string }) {
  const [data, setData] = useState<BestMarksResult | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [distanceId, setDistanceId] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const response = await fetch(`${apiUrl}/coach/students/${studentId}/best-marks`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!response.ok) throw new Error('falhou');
      setData((await response.json()) as BestMarksResult);
      setState('ready');
    } catch {
      setState('error');
    }
  }, [apiUrl, studentId, accessToken]);
  useEffect(() => { void load(); }, [load]);

  const summary = useMemo(() => (data ? summaryOf(data.marks) : null), [data]);
  const current: DistanceMarks | null = useMemo(() => (data ? (data.marks.find((entry) => entry.distanceId === distanceId) ?? data.marks.find((entry) => entry.best) ?? data.marks[0] ?? null) : null), [data, distanceId]);
  const points = useMemo(() => (current ? chartPoints(current.ranking) : []), [current]);
  const selected: Mark | null = useMemo(() => (current ? (current.ranking.find((mark) => markKey(mark) === selectedKey) ?? current.best) : null), [current, selectedKey]);

  if (state === 'loading' && !data) return <section className="bm"><p>Carregando as melhores marcas...</p></section>;
  if (state === 'error' || !data || !current) return <section className="bm"><p role="alert">Não foi possível carregar as melhores marcas agora.</p></section>;

  return (
    <section className="bm" aria-label="Melhores marcas">
      <header className="bm-hero">
        <div>
          <span className="bm-kicker">MELHORES MARCAS</span>
          <h3>Melhores tempos da aluna</h3>
          <p>Somente o que o Panzeri Run registrou. Somente leitura.</p>
        </div>
        <div className="bm-hero-stats">
          <div><strong>{summary?.withMark ?? 0}<small> de {summary?.total ?? 0}</small></strong><span>distâncias com marca</span></div>
          <div><strong>{summary?.latest ? summary.latest.label : '—'}</strong><span>{summary?.latest ? `marca mais recente · ${fmtDate(summary.latest.localDate)}` : 'sem marcas ainda'}</span></div>
        </div>
      </header>

      <div className="bm-grid" role="tablist" aria-label="Distâncias">
        {data.marks.map((entry) => {
          const active = entry.distanceId === current.distanceId;
          return (
            <button key={entry.distanceId} type="button" role="tab" aria-selected={active} className={`bm-dist${active ? ' active' : ''}${entry.best ? '' : ' empty'}`} onClick={() => { setDistanceId(entry.distanceId); setSelectedKey(null); }}>
              <span className="bm-dist-label">{entry.label}</span>
              <span className="bm-dist-time">{entry.best ? fmtTime(entry.best.seconds) : '—'}</span>
            </button>
          );
        })}
      </div>

      {!current.best || !selected ? (
        <div className="bm-card bm-empty"><strong>{current.label}</strong><p>Sem marca registrada nesta distância.</p></div>
      ) : (
        <>
          <div className="bm-split">
            <div className="bm-card bm-big">
              <span className="bm-card-kicker">{current.label} · {selected === current.best ? 'melhor marca' : 'marca selecionada'}</span>
              <div className="bm-time">{fmtTime(selected.seconds)}</div>
              <div className="bm-sub">{fmtPace(selected.paceSecondsKm)} · {fmtDate(selected.localDate)}</div>
              <div className="bm-tags">{markTags(selected).map((tag) => <span key={tag} className="bm-tag">{tag}</span>)}</div>
              <h4>Como esta marca foi coletada</h4>
              <ul className="bm-how">{howCollected(selected, current.label).map((line, index) => <li key={index}>{line}</li>)}</ul>
            </div>
            <div className="bm-card">
              <h4>Evolução em {current.label}</h4>
              <EvolutionChart points={points} selectedKey={selected ? markKey(selected) : null} onSelect={setSelectedKey} />
              <div className="bm-legend"><span><i className="rec" />marca batida</span><span><i className="oth" />outro treino na distância</span><span>clique num ponto ou numa linha da lista</span></div>
            </div>
          </div>

          <div className="bm-card">
            <h4>{current.ranking.length === 1 ? 'Única marca registrada' : `As ${Math.min(current.ranking.length, 10)} melhores marcas`}</h4>
            <table className="bm-table">
              <thead><tr><th>#</th><th>Tempo</th><th>Pace</th><th>Data</th><th>Origem</th></tr></thead>
              <tbody>{current.ranking.slice(0, 10).map((mark, index) => (
                <tr key={markKey(mark)} className={markKey(mark) === markKey(selected) ? 'active' : ''} onClick={() => setSelectedKey(markKey(mark))}>
                  <td>{index + 1}º</td><td><strong>{fmtTime(mark.seconds)}</strong></td><td>{fmtPace(mark.paceSecondsKm)}</td><td>{fmtDate(mark.localDate)}</td><td>{markTags(mark).join(' · ')}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}

      <div className="bm-card bm-self">
        <h4>Relato da entrevista <small>(não comprovado, fora das marcas registradas)</small></h4>
        {data.selfReported.length === 0 ? <p className="bm-muted">Sem distâncias informadas na entrevista.</p> : (
          <div className="bm-self-grid">{data.selfReported.map((run) => (
            <div key={run.rank} className="bm-self-item"><span className="bm-card-kicker">{RANK_LABEL[run.rank]}</span><strong>{selfDistance(run)}</strong><span>{selfLine(run)}</span></div>
          ))}</div>
        )}
      </div>
      <p className="bm-foot">{data.notes.slice(0, 2).join(' ')} <button type="button" onClick={() => void load()}>Atualizar</button></p>
    </section>
  );
}
