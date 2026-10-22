'use client';

import React, { useEffect, useState } from 'react';

// Avatar do aluno no painel (21/10/2026). A foto e' UMA so' (UserProfilePhoto) e vem de GET /coach/students/:id/photo; o cache em memoria e' por aluno + versao, entao a listagem
// busca cada foto uma vez e so' busca de novo quando o aluno troca a imagem. Sem foto (ou falha) mostra as iniciais — nunca quebra a tela.
const cache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

function loadPhoto(apiUrl: string, studentId: string, accessToken: string, version: string): Promise<string | null> {
  const key = `${studentId}|${version}`;
  if (cache.has(key)) return Promise.resolve(cache.get(key) ?? null);
  const pending = inflight.get(key);
  if (pending) return pending;
  const request = fetch(`${apiUrl}/coach/students/${studentId}/photo`, { headers: { Authorization: `Bearer ${accessToken}` } })
    .then(async (response) => (response.ok ? (((await response.json()) as { dataUri: string | null }).dataUri ?? null) : null))
    .catch(() => null)
    .then((dataUri) => { cache.set(key, dataUri); inflight.delete(key); return dataUri; });
  inflight.set(key, request);
  return request;
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return ((parts[0][0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '')).toUpperCase();
}

// photoUpdatedAt: texto = tem foto (versao); null = sabidamente sem foto (nao busca); undefined = desconhecido (busca uma vez).
export default function StudentAvatar({ studentId, name, accessToken, apiUrl, photoUpdatedAt, size = 36 }: { studentId: string; name: string; accessToken: string; apiUrl: string; photoUpdatedAt?: string | null; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setSrc(null);
    if (photoUpdatedAt === null) return;
    void loadPhoto(apiUrl, studentId, accessToken, photoUpdatedAt ?? 'unknown').then((dataUri) => { if (alive) setSrc(dataUri); });
    return () => { alive = false; };
  }, [apiUrl, studentId, accessToken, photoUpdatedAt]);

  return (
    <span className="studentAvatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }} aria-hidden={src ? undefined : true}>
      {src ? <img src={src} alt={`Foto de ${name}`} width={size} height={size} /> : initialsOf(name)}
    </span>
  );
}
