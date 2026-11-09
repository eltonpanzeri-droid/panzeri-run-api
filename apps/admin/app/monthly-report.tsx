'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';

// Aluno > Evolução > "Relatório mensal" (09/11/2026). O envio automático (dia 1, 9h) só liga com MONTHLY_REPORT_ENABLED=true. Aqui o treinador vê a PRÉVIA do e-mail de uma aluna e manda um TESTE
// para o PRÓPRIO e-mail dele (nunca para a aluna). Nada aqui envia para a aluna.
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function lastMonths(count: number): Array<{ key: string; label: string }> {
  const now = new Date(Date.now() - 3 * 3600_000);
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth(); // 0-11: mes atual
  const out: Array<{ key: string; label: string }> = [];
  for (let i = 0; i < count; i++) {
    month -= 1;
    if (month < 0) { month = 11; year -= 1; }
    out.push({ key: `${year}-${String(month + 1).padStart(2, '0')}`, label: `${MONTHS[month]} de ${year}` });
  }
  return out;
}

export default function MonthlyReport({ studentId, accessToken, apiUrl }: { studentId: string; accessToken: string; apiUrl: string }) {
  const months = useMemo(() => lastMonths(6), []);
  const [month, setMonth] = useState(months[0].key);
  const [preview, setPreview] = useState<{ hasActivity: boolean; subject: string; html: string } | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    setMessage('');
    try {
      const response = await fetch(`${apiUrl}/coach/students/${studentId}/monthly-report/preview?month=${month}`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!response.ok) throw new Error('falhou');
      setPreview((await response.json()) as { hasActivity: boolean; subject: string; html: string });
      setState('idle');
    } catch {
      setPreview(null);
      setState('error');
    }
  }, [apiUrl, studentId, accessToken, month]);
  useEffect(() => { void load(); }, [load]);

  async function sendTest() {
    setSending(true);
    setMessage('');
    try {
      const response = await fetch(`${apiUrl}/coach/students/${studentId}/monthly-report/test`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ month }) });
      const body = (await response.json().catch(() => ({}))) as { to?: string; message?: string | string[] };
      if (!response.ok) setMessage(Array.isArray(body.message) ? body.message.join(' ') : (body.message ?? 'Não foi possível enviar o teste agora.'));
      else setMessage(`Teste enviado para ${body.to ?? 'o seu e-mail'}. Confira a caixa de entrada (e o spam).`);
    } catch {
      setMessage('Não foi possível enviar o teste agora.');
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="bm" aria-label="Relatório mensal por e-mail">
      <header className="bm-hero">
        <div>
          <span className="bm-kicker">RELATÓRIO MENSAL</span>
          <h3>E-mail mensal da aluna</h3>
          <p>Prévia do e-mail que ela recebe no dia 1, às 9h, quando treinou no mês anterior.</p>
        </div>
      </header>
      <div className="mr-split">
        <div className="bm-card mr-preview">
          {state === 'loading' ? <p className="bm-muted">Carregando a prévia...</p> : null}
          {state === 'error' ? <p role="alert">Não foi possível montar a prévia agora.</p> : null}
          {preview && !preview.hasActivity ? <p className="bm-muted">Esta aluna não treinou nesse mês: o e-mail real não seria enviado a ela. A prévia abaixo é só para ver o modelo.</p> : null}
          {preview ? <iframe title="Prévia do relatório mensal" srcDoc={preview.html} className="mr-frame" onLoad={(event) => { const doc = event.currentTarget.contentDocument; if (doc) event.currentTarget.style.height = `${doc.documentElement.scrollHeight + 8}px`; }} /> : null}
        </div>
        <aside className="bm-card mr-side">
          <h4>Teste e envio</h4>
          <label className="mr-field">Mês do relatório
            <select value={month} onChange={(event) => setMonth(event.target.value)}>{months.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select>
          </label>
          <button type="button" className="mr-send" onClick={() => void sendTest()} disabled={sending || !preview?.hasActivity}>{sending ? 'Enviando...' : 'Enviar teste para o meu e-mail'}</button>
          {message ? <p role="status" className="mr-msg">{message}</p> : null}
          <ul className="mr-facts">
            <li><strong>Quando:</strong> todo dia 1, às 9h (Brasília).</li>
            <li><strong>Quem recebe:</strong> alunas ativas, pagantes e cortesia, que treinaram no mês. Quem não treinou não recebe nada.</li>
            <li><strong>Teste:</strong> vai só para o seu e-mail, nunca para a aluna.</li>
            <li><strong>Envio automático:</strong> só liga com a variável MONTHLY_REPORT_ENABLED=true.</li>
            <li><strong>Descadastro:</strong> link no rodapé do e-mail; a aluna desliga com um clique.</li>
          </ul>
        </aside>
      </div>
    </section>
  );
}
