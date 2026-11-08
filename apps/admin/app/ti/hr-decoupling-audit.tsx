'use client';
import * as React from 'react';
import { API_URL, dateLabel } from './data';

// Auditoria do desacoplamento da frequência cardíaca por corrida (03/11/2026): todas as corridas consideradas pelo servidor, a última elegível de cada faixa de duração e, para cada corrida,
// elegibilidade, motivo de exclusão, fonte, data, duração, velocidade, FC e cobertura dos registros. Só leitura (GET /coach/students/:id/hr-decoupling/audit); nada é calculado aqui.

interface AuditEntry {
  activityLogId: string; startedAt: string; provider: string; sport: string | null; durationSec: number | null; distanceMeters: number | null;
  eligible: boolean; category: string | null; exclusionReason: string | null; exclusionText: string | null;
  decouplingPct: number | null; speedCvPct: number | null; halfDiffPct: number | null;
  meanSpeed1: number | null; meanSpeed2: number | null; meanHr1: number | null; meanHr2: number | null; movingSec: number | null;
  coverageHr1: number | null; coverageHr2: number | null; coverageSpeed1: number | null; coverageSpeed2: number | null;
  validHrSamples: number; validSpeedSamples: number; discardedHrSamples: number; discardedSpeedSamples: number; gapCount: number;
  qualityStatus: string | null; transientEventCount: number | null; transientEventSec: number | null; excludedSec: number | null; excludedPct: number | null; sustainedEventCount: number | null;
}

const CATEGORY_LABELS: Record<string, string> = { d30: '30 a 60 min', d60: '60 a 90 min', d90: '90 a 120 min', d120: '120 a 150 min', d150: 'mais de 150 min' };
const num = (value: number | null, digits = 1, suffix = '') => (value == null ? '—' : `${value.toFixed(digits).replace('.', ',')}${suffix}`);
const cover = (a: number | null, b: number | null) => (a == null || b == null ? '—' : `${Math.round(a * 100)}% / ${Math.round(b * 100)}%`);
const minutes = (seconds: number | null) => (seconds == null ? '—' : `${Math.round(seconds / 60)} min`);

export default function HrDecouplingAudit({ studentId, token }: { studentId: string; token: string }) {
  const [rows, setRows] = React.useState<AuditEntry[] | null>(null);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    const controller = new AbortController();
    setRows(null);
    (async () => {
      try {
        const response = await fetch(`${API_URL}/coach/students/${encodeURIComponent(studentId)}/hr-decoupling/audit`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
        if (!response.ok) throw new Error(`Não foi possível carregar a auditoria (HTTP ${response.status}).`);
        const data = await response.json() as AuditEntry[];
        if (!controller.signal.aborted) { setRows(Array.isArray(data) ? data : []); setError(''); }
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar a auditoria.'); }
    })();
    return () => controller.abort();
  }, [studentId, token]);

  if (error) return <p role="alert" className="evx-error">{error}</p>;
  if (!rows) return <p role="status" className="evx-empty">Carregando auditoria do desacoplamento…</p>;

  const eligible = rows.filter((row) => row.eligible);
  const latestByCategory = Object.keys(CATEGORY_LABELS).map((id) => ({ id, entry: eligible.find((row) => row.category === id) }));

  return <section className="evx-audit" aria-label="Auditoria do desacoplamento">
    <h4>Auditoria do desacoplamento · {eligible.length} de {rows.length} corridas elegíveis</h4>
    <p className="evx-caution">Elegível = pelo menos 30 min em movimento, CV da velocidade ≤ 10%, diferença entre as metades ≤ 5% e ao menos 80% do tempo coberto por registros válidos de velocidade e FC em cada metade. Sem filtro por zona. O valor é guardado mesmo nas corridas não elegíveis, só para auditoria.</p>
    <div className="evx-summary">
      {latestByCategory.map(({ id, entry }) => <div className="evx-card" key={id}>
        <span>Última elegível · {CATEGORY_LABELS[id]}</span>
        <strong>{entry ? num(entry.decouplingPct, 1, '%') : '—'}</strong>
        <small>{entry ? dateLabel(entry.startedAt, true) : 'Nenhuma corrida elegível nesta faixa'}</small>
      </div>)}
    </div>
    {rows.length === 0 ? <p className="evx-empty">Nenhuma corrida considerada para este indicador.</p> : <div className="evx-audit-scroll">
      <table className="evx-audit-table">
        <thead><tr>
          <th>Data</th><th>Fonte</th><th>Duração (mov.)</th><th>Faixa</th><th>Situação</th><th>Desacopl.</th><th>CV vel.</th><th>Dif. metades</th>
          <th>Vel. 1ª / 2ª (km/h)</th><th>FC 1ª / 2ª (bpm)</th><th>Cobertura FC 1ª / 2ª</th><th>Cobertura vel. 1ª / 2ª</th><th>Amostras FC (válidas / descartadas)</th><th>Amostras vel. (válidas / descartadas)</th><th>Lacunas</th>
        </tr></thead>
        <tbody>{rows.map((row) => <tr key={row.activityLogId} className={row.eligible ? '' : 'excluded'}>
          <td>{dateLabel(row.startedAt, true)}</td>
          <td>{row.provider}</td>
          <td>{minutes(row.movingSec ?? row.durationSec)}</td>
          <td>{row.category ? CATEGORY_LABELS[row.category] : '—'}</td>
          <td>{row.eligible ? (row.qualityStatus === 'valid_with_caveats' ? `Válido com ressalvas: ${row.transientEventCount ?? 0} oscilação(ões) transitória(s) de velocidade (${num(row.transientEventSec, 0)} s) e ${num(row.excludedSec, 0)} s (${num(row.excludedPct, 1)}%) excluídos do cálculo` : 'Válido') : row.exclusionText ?? 'Inconclusivo'}</td>
          <td>{num(row.decouplingPct, 2, '%')}</td>
          <td>{num(row.speedCvPct, 1, '%')}</td>
          <td>{num(row.halfDiffPct, 1, '%')}</td>
          <td>{num(row.meanSpeed1, 2)} / {num(row.meanSpeed2, 2)}</td>
          <td>{num(row.meanHr1, 0)} / {num(row.meanHr2, 0)}</td>
          <td>{cover(row.coverageHr1, row.coverageHr2)}</td>
          <td>{cover(row.coverageSpeed1, row.coverageSpeed2)}</td>
          <td>{row.validHrSamples} / {row.discardedHrSamples}</td>
          <td>{row.validSpeedSamples} / {row.discardedSpeedSamples}</td>
          <td>{row.gapCount}</td>
        </tr>)}</tbody>
      </table>
    </div>}
  </section>;
}
