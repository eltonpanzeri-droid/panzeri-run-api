'use client';

import React, { useEffect, useState } from 'react';
import { Watch } from 'lucide-react';

// Aluno > Treino da semana (17/11/2026): resumo, por integracao conectada, de quem recebe treino no relogio e o que a aluna ja' devolveu ao Panzeri Run. So' LEITURA: GET /coach/students/:id/watch-summary.
interface Device { provider: string; name: string; receivesWorkouts: boolean; sent: number | null; failures7d: number; text: string; explain: string }
interface Result { weekRuns: number; devices: Device[]; headline: string }

export default function WatchSummary({ studentId, accessToken, apiUrl }: { studentId: string; accessToken: string; apiUrl: string }) {
  const [data, setData] = useState<Result | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setFailed(false);
    void fetch(`${apiUrl}/coach/students/${studentId}/watch-summary`, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then((response) => { if (!response.ok) throw new Error('falhou'); return response.json() as Promise<Result>; })
      .then((result) => { if (!cancelled) setData(result); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [apiUrl, studentId, accessToken]);

  if (failed) return <p className="hrNotice warn" role="status"><span>Não foi possível carregar o resumo do relógio agora.</span></p>;
  if (!data) return null;
  return (
    <section className="miniSection" aria-label="Relógio e integrações da aluna">
      <p className="eyebrow"><Watch size={14} /> Relógio e integrações</p>
      <p>{data.headline}</p>
      {data.devices.length > 0 ? <ul>{data.devices.map((device) => <li key={device.provider}>{device.text}<br /><small>{device.explain}</small></li>)}</ul> : null}
    </section>
  );
}
