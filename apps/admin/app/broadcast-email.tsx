'use client';

import React, { useCallback, useState } from 'react';

// Ferramentas > "Comunicado por e-mail" (11/11/2026). Escreve o e-mail, ve quantas alunas vao receber, manda um TESTE para o e-mail do treinador e so' entao envia para todas.
// O envio exige digitar a contagem mostrada (trava contra clique sem querer) e nao repete para quem ja recebeu (a "chave" identifica o comunicado).
const DEFAULT_SUBJECT = 'Panzeri Run 1.0.4: atualize seu aplicativo';
const DEFAULT_MESSAGE = `Olá, {nome}!

Temos novidades no Panzeri Run. A versão 1.0.4 já está disponível.

Pedimos que você:

1. Atualize o aplicativo na Play Store ou na App Store. Quem usa o iPhone pelo ícone na tela de início recebe a atualização ao abrir o aplicativo.
2. Confira a conexão com o seu relógio em Dispositivos e integrações, para que seus treinos cheguem certinhos ao Panzeri Run.
3. Revise as permissões de uso dos dados, escolhendo o que você autoriza.

O Panzeri Run trabalha incansavelmente para que você tenha a melhor experiência e obtenha os melhores resultados, sempre com segurança e alegria em correr conosco.

Um abraço,
Equipe Panzeri Run`;

interface Status { key: string; eligible: number; alreadySent: number; failed: number; pending: number; running: boolean }
type Preview = Status & { sampleText: string; sampleName: string };

export default function BroadcastEmail({ apiUrl, token }: { apiUrl: string; token: string }) {
  const [key, setKey] = useState('versao-1-0-4');
  const [subject, setSubject] = useState(DEFAULT_SUBJECT);
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [confirm, setConfirm] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  const call = useCallback(async (path: string, body?: unknown) => {
    const response = await fetch(`${apiUrl}/coach/broadcast-email/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown> & { message?: string | string[] };
    if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join(' ') : (data.message ?? 'Não foi possível concluir agora.'));
    return data;
  }, [apiUrl, token]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setInfo('');
    try { await action(); } catch (error) { setInfo((error as Error).message); } finally { setBusy(false); }
  }

  const loadPreview = () => run(async () => { setPreview((await call('preview', { key, subject, message })) as unknown as Preview); setConfirm(''); });
  const sendTest = () => run(async () => { await call('test', { key, subject, message }); setInfo('Teste enviado para o seu e-mail. Confira a caixa de entrada (e o spam).'); });
  const send = () => run(async () => {
    const data = (await call('send', { key, subject, message, confirmCount: Number(confirm) })) as { total?: number };
    setInfo(`Envio iniciado para ${data.total ?? 0} alunas. Leva alguns minutos; use "Atualizar andamento".`);
    setConfirm('');
    setStatus((await call(`status?key=${encodeURIComponent(key)}`)) as unknown as Status);
  });
  const refresh = () => run(async () => { setStatus((await call(`status?key=${encodeURIComponent(key)}`)) as unknown as Status); });

  const canSend = preview !== null && preview.pending > 0 && Number(confirm) === preview.pending && !busy;

  return (
    <section className="workArea" style={{ marginTop: 24 }}>
      <h2>Comunicado por e-mail para as alunas</h2>
      <p>Vai para as alunas com acesso ativo (não vai para prospectos, ex-alunas nem contas de teste). Use <b>{'{nome}'}</b> para colocar o primeiro nome da aluna.</p>
      <label>Chave do comunicado (evita enviar duas vezes o mesmo)
        <input value={key} onChange={(event) => { setKey(event.target.value.trim().toLowerCase()); setPreview(null); }} />
      </label>
      <label>Assunto
        <input value={subject} onChange={(event) => { setSubject(event.target.value); setPreview(null); }} maxLength={150} />
      </label>
      <label>Mensagem
        <textarea value={message} onChange={(event) => { setMessage(event.target.value); setPreview(null); }} rows={14} maxLength={5000} />
      </label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
        <button type="button" disabled={busy} onClick={() => void loadPreview()}>1. Ver quantas alunas vão receber</button>
        <button type="button" disabled={busy} onClick={() => void sendTest()}>2. Enviar teste para o meu e-mail</button>
        <button type="button" disabled={busy} onClick={() => void refresh()}>Atualizar andamento</button>
      </div>
      {preview ? (
        <div style={{ marginTop: 16 }}>
          <p><b>{preview.pending}</b> alunas vão receber ({preview.alreadySent} já receberam este comunicado, de {preview.eligible} com acesso).</p>
          <p>Como a primeira aluna{preview.sampleName ? ` (${preview.sampleName})` : ''} vai ver:</p>
          <pre style={{ whiteSpace: 'pre-wrap', background: 'rgba(127,127,127,0.12)', padding: 12, borderRadius: 8 }}>{preview.sampleText}</pre>
          {preview.pending > 0 ? (
            <>
              <label>3. Para liberar o envio, digite o número de alunas ({preview.pending})
                <input value={confirm} inputMode="numeric" onChange={(event) => setConfirm(event.target.value.replace(/\D/g, ''))} />
              </label>
              <button type="button" disabled={!canSend} onClick={() => void send()} style={{ marginTop: 8 }}>Enviar para {preview.pending} alunas agora</button>
            </>
          ) : <p>Todas as alunas já receberam este comunicado.</p>}
        </div>
      ) : null}
      {status ? <p style={{ marginTop: 16 }}>Andamento: {status.alreadySent} enviadas, {status.pending} faltando{status.failed ? `, ${status.failed} com falha (reenviar: clique em ver quantas e envie de novo, só vai para quem falta)` : ''}{status.running ? ' — enviando agora…' : ''}.</p> : null}
      {info ? <p role="status" style={{ marginTop: 12 }}>{info}</p> : null}
    </section>
  );
}
