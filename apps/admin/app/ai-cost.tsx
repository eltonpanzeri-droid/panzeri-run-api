'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Area, Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

// Financeiro > "Custo por prescrição" (01/11/2026). SOMENTE LEITURA: GET /coach/ai-costs. Os valores chegam em DÓLAR (como a Anthropic cobra) e a tela mostra em dólar por padrão;
// o botão "Real" converte com a cotação digitada aqui (guardada só neste navegador). A tela DESCREVE o custo real de cada chamada de IA; não decide nem limita nada.
// A série da prescrição semanal usa a mesma matemática da carga interna: médias móveis de 7 e 21 prescrições ANTERIORES e faixa habitual (percentis 10 a 90 das anteriores).

type Signal = 'above' | 'below' | 'within' | 'no_reference';
type Parts = { inputUsd: number; cacheWriteUsd: number; cacheReadUsd: number; outputUsd: number };
type Overview = {
  generatedAt: string; periodDays: number; truncated: boolean;
  totals: { calls: number; totalUsd: number; monthToDateUsd: number; monthToDateCalls: number };
  weeklyPrescription: { calls: number; meanUsd: number | null; medianUsd: number | null; lastUsd: number | null };
  agents: Array<{ agent: string; calls: number; totalUsd: number; meanUsd: number | null; medianUsd: number | null; parts: Parts }>;
  series: { unit: string; bandPolicy: { individualMin: number; limitedMin: number }; points: Array<{ timestamp: string; costUsd: number; mm7: number | null; mm21: number | null; bandLower: number | null; bandUpper: number | null; bandBasis: 'individual' | 'limited' | 'none'; signal: Signal; studentCode: number | null }> };
  byDay: Array<{ day: string; costUsd: number; calls: number }>;
  mostExpensive: Array<{ at: string; studentCode: number | null; studentName: string | null; effort: string | null; costUsd: number; inputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; outputTokens: number; durationMs: number; biggestPromptField: { field: string; chars: number } | null; notVisibleOutputTokensEstimate: number | null }>;
  byStudent: Array<{ studentCode: number | null; studentName: string | null; costUsd: number; calls: number }>;
};

type Currency = 'USD' | 'BRL';
const AGENT_LABEL: Record<string, string> = {
  treinador_semana: 'Treinador · semana', treinador_dia_corrida: 'Treinador · dia de corrida', treinador_dia_forca: 'Treinador · dia de força',
  gerente_tecnico: 'Gerente técnico', prontuario: 'Prontuário · evolução', prontuario_condensacao: 'Prontuário · condensação', relator: 'Relator',
};
const PERIODS = [30, 90, 180, 365];
const RATE_KEY = 'panzeri.aiCost.usdBrl';
const CURRENCY_KEY = 'panzeri.aiCost.currency';
const COLORS = { cost: '#7aa8ff', mm7: '#e0a72d', mm21: '#1a7f5a', band: '#94a3b8', above: '#d9822b' };

const agentLabel = (agent: string) => AGENT_LABEL[agent] ?? agent;
const dmy = (iso: string) => { const d = new Date(iso); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`; };
const dmyFull = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

function readStored(key: string): string {
  try { return window.localStorage.getItem(key) ?? ''; } catch { return ''; }
}
function writeStored(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* sem armazenamento: a tela funciona igual, so' nao lembra a escolha */ }
}

export default function AiCostSection({ accessToken, apiUrl, priceCents }: { accessToken: string; apiUrl: string; priceCents: number }) {
  const [days, setDays] = useState(90);
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [currency, setCurrency] = useState<Currency>('USD');
  const [rateText, setRateText] = useState('');
  const seq = useRef(0);

  useEffect(() => {
    setRateText(readStored(RATE_KEY));
    setCurrency(readStored(CURRENCY_KEY) === 'BRL' ? 'BRL' : 'USD');
  }, []);

  const rate = Number(rateText.replace(',', '.'));
  const rateOk = Number.isFinite(rate) && rate > 0;
  const showBrl = currency === 'BRL' && rateOk;

  const money = (usd: number | null | undefined, digits = 3): string => {
    if (usd == null) return '—';
    if (showBrl) return `R$ ${(usd * rate).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: Math.max(2, digits - 1) })}`;
    return `US$ ${usd.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: digits })}`;
  };
  // Os valores dos graficos ja estao na moeda mostrada (ver conv): o eixo so' formata.
  const tick = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  const unitLabel = showBrl ? 'R$' : 'US$';
  const conv = (usd: number | null) => (usd == null ? null : showBrl ? usd * rate : usd);

  function chooseCurrency(next: Currency) {
    setCurrency(next);
    writeStored(CURRENCY_KEY, next);
  }
  function changeRate(text: string) {
    setRateText(text);
    writeStored(RATE_KEY, text);
  }

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true); setError(null);
    try {
      const response = await fetch(`${apiUrl}/coach/ai-costs?days=${days}`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (mine !== seq.current) return;
      if (!response.ok) { setData(null); setError(response.status === 401 ? 'Sua sessão expirou. Atualize a página e entre de novo.' : 'Não foi possível carregar agora.'); setLoading(false); return; }
      setData((await response.json()) as Overview);
    } catch { if (mine === seq.current) { setData(null); setError('Não foi possível carregar agora.'); } }
    if (mine === seq.current) setLoading(false);
  }, [apiUrl, accessToken, days]);

  useEffect(() => { void load(); }, [load]);

  const weekly = data?.weeklyPrescription;
  const empty = data != null && data.totals.calls === 0;
  const sharePercent = showBrl && weekly?.meanUsd != null && priceCents > 0 ? (weekly.meanUsd * rate) / (priceCents / 100) * 100 : null;

  const seriesRows = (data?.series.points ?? []).map((point, index) => ({
    n: index + 1,
    label: dmy(point.timestamp),
    custo: conv(point.costUsd),
    mm7: conv(point.mm7),
    mm21: conv(point.mm21),
    faixa: point.bandLower != null && point.bandUpper != null ? [conv(point.bandLower), conv(point.bandUpper)] : null,
    acima: point.signal === 'above',
    aluna: point.studentCode,
    base: point.bandBasis,
  }));
  const partsRows = (data?.agents ?? []).map((agent) => ({
    agente: agentLabel(agent.agent),
    entrada: conv(agent.parts.inputUsd), gravacaoCache: conv(agent.parts.cacheWriteUsd), leituraCache: conv(agent.parts.cacheReadUsd), saida: conv(agent.parts.outputUsd),
  }));
  const dayRows = (data?.byDay ?? []).map((day) => ({ label: `${day.day.slice(8, 10)}/${day.day.slice(5, 7)}`, custo: conv(day.costUsd), chamadas: day.calls }));

  return (
    <section className="chartCard" aria-label="Custo por prescrição">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <p className="eyebrow" style={{ margin: 0 }}>Financeiro</p>
          <h3 style={{ margin: 0 }}>Custo por prescrição</h3>
          <p className="formHintText" style={{ margin: '4px 0 0' }}>Quanto a IA custou de verdade em cada chamada. Em dólar por padrão, como a Anthropic cobra.</p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <div role="group" aria-label="Moeda" style={{ display: 'inline-flex', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
            {(['USD', 'BRL'] as Currency[]).map((option) => (
              <button key={option} type="button" className={currency === option ? 'primaryButton' : 'secondaryButton'} style={{ borderRadius: 0, padding: '6px 12px' }} onClick={() => chooseCurrency(option)} aria-pressed={currency === option}>
                {option === 'USD' ? 'Dólar' : 'Real'}
              </button>
            ))}
          </div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)' }}>
            Cotação (R$ por US$)
            <input inputMode="decimal" value={rateText} onChange={(event) => changeRate(event.target.value)} placeholder="ex.: 5,50" aria-label="Cotação do dólar em reais" style={{ width: 84, padding: '6px 8px', border: '1px solid var(--line)', borderRadius: 6 }} />
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)' }}>
            Período
            <select value={days} onChange={(event) => setDays(Number(event.target.value))} style={{ padding: '6px 8px', border: '1px solid var(--line)', borderRadius: 6 }}>
              {PERIODS.map((p) => <option key={p} value={p}>{p} dias</option>)}
            </select>
          </label>
          <button className="secondaryButton" type="button" onClick={() => void load()} disabled={loading}>{loading ? 'Carregando…' : 'Atualizar'}</button>
        </div>
      </div>

      {currency === 'BRL' && !rateOk ? <p className="formHintText" role="note">Informe a cotação do dólar (por exemplo 5,50) para ver os valores em real. Enquanto isso, a tela mostra em dólar.</p> : null}
      {error ? <p className="formHintText" role="alert">{error}</p> : null}
      {!data && !error ? <p className="formHintText">Carregando custos…</p> : null}

      {empty ? (
        <p className="formHintText">Ainda não há custos gravados neste período. A gravação começa na primeira chamada de IA depois da atualização do servidor; gerações anteriores só existem no log do servidor.</p>
      ) : null}

      {data && !empty ? (
        <>
          <section className="stats" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
            <div className="stat"><span>Custo médio da prescrição semanal</span><strong>{money(weekly?.meanUsd)}</strong><small>{weekly?.calls ?? 0} prescrição(ões) no período · mediana {money(weekly?.medianUsd)}</small></div>
            <div className="stat"><span>Última prescrição semanal</span><strong>{money(weekly?.lastUsd)}</strong><small>chamada mais recente do Treinador da semana</small></div>
            <div className="stat"><span>Gasto de IA no mês</span><strong>{money(data.totals.monthToDateUsd, 2)}</strong><small>{data.totals.monthToDateCalls} chamada(s), todos os agentes</small></div>
            <div className="stat"><span>Média da prescrição ÷ mensalidade</span><strong>{sharePercent != null ? `${sharePercent.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%` : '—'}</strong><small>{showBrl ? `mensalidade de ${(priceCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` : 'informe a cotação e escolha Real'}</small></div>
          </section>

          <h4 style={{ marginBottom: 4 }}>Cada prescrição semanal, comparada ao histórico anterior</h4>
          <p className="formHintText" style={{ marginTop: 0 }}>
            Cada ponto é uma prescrição semanal ({unitLabel}). As linhas são a média das 7 e das 21 prescrições <strong>anteriores</strong>; a faixa cinza é a faixa habitual (percentis 10 a 90 das anteriores).
            Ponto laranja = custo acima da faixa habitual <strong>desta série</strong>; isso descreve, não é erro nem alarme. Com menos de {data.series.bandPolicy.limitedMin} prescrições anteriores não há faixa (ausência de faixa não significa “normal”); de {data.series.bandPolicy.limitedMin} a {data.series.bandPolicy.individualMin - 1} a faixa é limitada.
          </p>
          {seriesRows.length ? (
            <div style={{ width: '100%', height: 300 }}>
              <ResponsiveContainer>
                <ComposedChart data={seriesRows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" fontSize={12} />
                  <YAxis fontSize={12} tickFormatter={tick} width={52} />
                  <Tooltip formatter={(value: unknown) => (Array.isArray(value) ? `${unitLabel} ${Number(value[0]).toFixed(3)} a ${Number(value[1]).toFixed(3)}` : `${unitLabel} ${Number(value).toFixed(3)}`)} labelFormatter={(label: unknown, payload: ReadonlyArray<{ payload?: { n: number; aluna: number | null; base: string } }>) => { const p = payload?.[0]?.payload; return `${String(label)} · prescrição ${p?.n ?? ''}${p?.aluna ? ` · aluna ${p.aluna}` : ''}`; }} />
                  <Legend />
                  <Area dataKey="faixa" name="Faixa habitual (P10–P90)" stroke="none" fill={COLORS.band} fillOpacity={0.22} isAnimationActive={false} connectNulls />
                  <Line dataKey="mm7" name="Média das 7 anteriores" stroke={COLORS.mm7} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                  <Line dataKey="mm21" name="Média das 21 anteriores" stroke={COLORS.mm21} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                  <Line
                    dataKey="custo" name="Custo da prescrição" stroke={COLORS.cost} strokeWidth={1.5} strokeOpacity={0.5} isAnimationActive={false}
                    dot={(props: { cx?: number; cy?: number; payload?: { acima: boolean }; index?: number }) => (
                      <circle key={`d-${props.index}`} cx={props.cx} cy={props.cy} r={props.payload?.acima ? 5 : 3.5} fill={props.payload?.acima ? COLORS.above : COLORS.cost} stroke="none" />
                    )}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : <p className="formHintText">Ainda não há prescrição semanal gravada neste período.</p>}

          <h4 style={{ marginBottom: 4 }}>De onde vem o custo, por agente</h4>
          <p className="formHintText" style={{ marginTop: 0 }}>Entrada normal (o que a IA lê), gravação e leitura do cache do prompt fixo, e saída (o que a IA escreve, incluindo o raciocínio). Saída custa 5 vezes mais por token que entrada.</p>
          <div style={{ width: '100%', height: Math.max(180, 56 * partsRows.length + 60) }}>
            <ResponsiveContainer>
              <ComposedChart data={partsRows} layout="vertical" margin={{ top: 4, right: 12, left: 12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" fontSize={12} tickFormatter={tick} />
                <YAxis type="category" dataKey="agente" fontSize={12} width={170} />
                <Tooltip formatter={(value: unknown) => `${unitLabel} ${Number(value).toFixed(3)}`} />
                <Legend />
                <Bar dataKey="entrada" name="Entrada normal" stackId="c" fill="#7aa8ff" isAnimationActive={false} />
                <Bar dataKey="gravacaoCache" name="Gravação de cache" stackId="c" fill="#b7a6ff" isAnimationActive={false} />
                <Bar dataKey="leituraCache" name="Leitura de cache" stackId="c" fill="#94a3b8" isAnimationActive={false} />
                <Bar dataKey="saida" name="Saída (escrita + raciocínio)" stackId="c" fill="#e0a72d" isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--muted)' }}><th>Agente</th><th>Chamadas</th><th>Total</th><th>Média</th><th>Mediana</th></tr></thead>
              <tbody>{data.agents.map((agent) => (
                <tr key={agent.agent} style={{ borderTop: '1px solid var(--line)' }}><td>{agentLabel(agent.agent)}</td><td>{agent.calls}</td><td>{money(agent.totalUsd)}</td><td>{money(agent.meanUsd)}</td><td>{money(agent.medianUsd)}</td></tr>
              ))}</tbody>
            </table>
          </div>

          <h4 style={{ marginBottom: 4 }}>Gasto de IA por dia</h4>
          <div style={{ width: '100%', height: 220 }}>
            <ResponsiveContainer>
              <ComposedChart data={dayRows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={tick} width={52} />
                <Tooltip formatter={(value: unknown, name: unknown) => (name === 'chamadas' ? String(value) : `${unitLabel} ${Number(value).toFixed(3)}`)} />
                <Bar dataKey="custo" name="Custo do dia" fill="#7aa8ff" isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <h4 style={{ marginBottom: 4 }}>Prescrições semanais mais caras do período</h4>
          <p className="formHintText" style={{ marginTop: 0 }}>“Maior bloco do prompt” é o campo que mais ocupou espaço na entrada daquela chamada; “saída não visível” estima os tokens cobrados que não viraram texto devolvido (raciocínio).</p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--muted)' }}><th>Quando</th><th>Aluna</th><th>Esforço</th><th>Custo</th><th>Entrada</th><th>Cache gravado</th><th>Saída</th><th>Saída não visível</th><th>Maior bloco do prompt</th><th>Tempo</th></tr></thead>
              <tbody>{data.mostExpensive.map((row) => (
                <tr key={`${row.at}-${row.studentCode ?? 'x'}`} style={{ borderTop: '1px solid var(--line)' }}>
                  <td>{dmyFull(row.at)}</td>
                  <td>{row.studentCode ? `${row.studentCode} · ` : ''}{row.studentName ?? '—'}</td>
                  <td>{row.effort ?? '—'}</td>
                  <td><strong>{money(row.costUsd)}</strong></td>
                  <td>{row.inputTokens.toLocaleString('pt-BR')}</td>
                  <td>{row.cacheCreationTokens.toLocaleString('pt-BR')}</td>
                  <td>{row.outputTokens.toLocaleString('pt-BR')}</td>
                  <td>{row.notVisibleOutputTokensEstimate != null ? `~${row.notVisibleOutputTokensEstimate.toLocaleString('pt-BR')}` : '—'}</td>
                  <td>{row.biggestPromptField ? `${row.biggestPromptField.field} (${row.biggestPromptField.chars.toLocaleString('pt-BR')} car.)` : '—'}</td>
                  <td>{Math.round(row.durationMs / 1000)} s</td>
                </tr>
              ))}</tbody>
            </table>
          </div>

          <h4 style={{ marginBottom: 4 }}>Quem mais consumiu no período</h4>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--muted)' }}><th>Aluna</th><th>Chamadas de IA</th><th>Custo total</th></tr></thead>
              <tbody>{data.byStudent.map((row, index) => (
                <tr key={`${row.studentCode ?? 'x'}-${index}`} style={{ borderTop: '1px solid var(--line)' }}><td>{row.studentCode ? `${row.studentCode} · ` : ''}{row.studentName ?? '—'}</td><td>{row.calls}</td><td>{money(row.costUsd)}</td></tr>
              ))}</tbody>
            </table>
          </div>

          <p className="formHintText" style={{ marginTop: 12 }}>
            Valores calculados pelo sistema com a tabela de tarifas da Anthropic (conferida com o painel da Anthropic em 01/11/2026: a prescrição da Duane bateu em US$ 0,43). Só aparecem chamadas gravadas depois da atualização do servidor;
            agentes sem aluna associada ficam fora da tabela “quem mais consumiu”. {data.truncated ? 'O período tem mais chamadas do que a tela carrega: reduza o período para ver tudo.' : ''}
          </p>
        </>
      ) : null}
    </section>
  );
}
