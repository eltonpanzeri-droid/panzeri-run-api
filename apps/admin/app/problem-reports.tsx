'use client';

import React, { useCallback, useEffect, useState } from 'react';

// Relatos de problema enviados pelas alunas ("Relatar problema" no Panzeri Run, 13/11/2026). O treinador também é avisado no Telegram. Aqui: lista, imagens, situação e anotação.
interface Report {
  id: string; type: string; typeLabel: string; message: string; status: 'open' | 'in_progress' | 'resolved'; coachNote: string | null;
  appVersion: string | null; platform: string | null; osVersion: string | null; deviceModel: string | null; createdAt: string; resolvedAt: string | null;
  user: { id: string; name: string | null }; studentCode: string; images: Array<{ id: string; byteSize: number }>;
}
const STATUS_LABEL: Record<Report['status'], string> = { open: 'Aberto', in_progress: 'Em andamento', resolved: 'Resolvido' };

export default function ProblemReports({ apiUrl, token }: { apiUrl: string; token: string }) {
  const [rows, setRows] = useState<Report[] | null>(null);
  const [filter, setFilter] = useState<'all' | Report['status']>('open');
  const [error, setError] = useState('');
  const [images, setImages] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setError('');
    try {
      const response = await fetch(`${apiUrl}/coach/problem-reports${filter === 'all' ? '' : `?status=${filter}`}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error('falhou');
      setRows((await response.json()) as Report[]);
    } catch {
      setRows([]);
      setError('Não consegui carregar os relatos agora.');
    }
  }, [apiUrl, token, filter]);
  useEffect(() => { void load(); }, [load]);

  async function patch(id: string, body: { status?: Report['status']; coachNote?: string }) {
    setError('');
    try {
      const response = await fetch(`${apiUrl}/coach/problem-reports/${id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error('falhou');
      await load();
    } catch {
      setError('Não consegui salvar agora.');
    }
  }

  async function showImage(reportId: string, imageId: string) {
    if (images[imageId]) { setImages((current) => { const next = { ...current }; delete next[imageId]; return next; }); return; }
    try {
      const response = await fetch(`${apiUrl}/coach/problem-reports/${reportId}/images/${imageId}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error('falhou');
      const data = (await response.json()) as { dataUri: string };
      setImages((current) => ({ ...current, [imageId]: data.dataUri }));
    } catch {
      setError('Não consegui abrir a imagem.');
    }
  }

  return (
    <section className="workArea">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {(['open', 'in_progress', 'resolved', 'all'] as const).map((value) => (
          <button key={value} type="button" onClick={() => setFilter(value)} style={{ fontWeight: filter === value ? 700 : 400 }}>{value === 'all' ? 'Todos' : STATUS_LABEL[value]}</button>
        ))}
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {rows === null ? <p>Carregando...</p> : rows.length === 0 ? <p>Nenhum relato {filter === 'all' ? '' : `com situação "${STATUS_LABEL[filter]}"`}.</p> : rows.map((row) => (
        <article key={row.id} style={{ border: '1px solid rgba(127,127,127,0.3)', borderRadius: 10, padding: 14, marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <strong>{row.typeLabel} · {row.user.name ?? 'sem nome'} (Cod. {row.studentCode})</strong>
            <span>{STATUS_LABEL[row.status]} · {new Date(row.createdAt).toLocaleString('pt-BR')}</span>
          </div>
          <p style={{ whiteSpace: 'pre-wrap' }}>{row.message}</p>
          <p style={{ opacity: 0.75, fontSize: 13 }}>{[row.platform, row.osVersion, row.deviceModel].filter(Boolean).join(' · ') || 'aparelho não informado'} · app {row.appVersion ?? '?'}</p>
          {row.images.length > 0 ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {row.images.map((image, index) => (
                <div key={image.id}>
                  <button type="button" onClick={() => void showImage(row.id, image.id)}>{images[image.id] ? 'Fechar' : 'Ver'} imagem {index + 1}</button>
                  {images[image.id] ? <div><img src={images[image.id]} alt={`Imagem ${index + 1} do relato`} style={{ maxWidth: 260, marginTop: 6, borderRadius: 8 }} /></div> : null}
                </div>
              ))}
            </div>
          ) : null}
          <label style={{ display: 'block', marginTop: 10 }}>Anotação do treinador
            <textarea rows={2} maxLength={1000} value={notes[row.id] ?? row.coachNote ?? ''} onChange={(event) => setNotes((current) => ({ ...current, [row.id]: event.target.value }))} />
          </label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <button type="button" onClick={() => void patch(row.id, { coachNote: notes[row.id] ?? row.coachNote ?? '' })}>Salvar anotação</button>
            {row.status !== 'in_progress' ? <button type="button" onClick={() => void patch(row.id, { status: 'in_progress' })}>Marcar em andamento</button> : null}
            {row.status !== 'resolved' ? <button type="button" onClick={() => void patch(row.id, { status: 'resolved' })}>Marcar resolvido</button> : null}
            {row.status !== 'open' ? <button type="button" onClick={() => void patch(row.id, { status: 'open' })}>Reabrir</button> : null}
          </div>
        </article>
      ))}
    </section>
  );
}
