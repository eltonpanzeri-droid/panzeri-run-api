import { createContext, useContext, useEffect, useState } from 'react';
import { fetchJsonAuth } from './homeApi';

// Leitura da Evolução por regra (GET /me/evolution/summary), compartilhada por TODAS as telas da Evolução (14/11/2026): o carrossel de cards e a frase "O seu caso" sob cada gráfico leem a MESMA
// resposta do servidor (uma chamada, guardada por um minuto). Nenhuma conta ou texto é feito aqui. O token vem do contexto que o EvolutionHub fornece; fora dele (telas antigas) nada é buscado.
export type ReadingAreaId = 'training' | 'load' | 'sleep' | 'wellbeing' | 'adherence';

export interface IndicatorDto {
  variableId: string; name: string; status: 'ok' | 'insufficient'; bucket: 'good' | 'steady' | 'attention' | 'tracked' | 'insufficient';
  texts: { whatItMeasures: string; habitual: string; trend: string | null; meaning: string | null };
}
export interface AreaDto { id: ReadingAreaId; title: string; text: string; meaning: string | null; counts: { evaluated: number }; indicators: IndicatorDto[] }
export interface SummaryDto { areas: AreaDto[] }

export const EvolutionReadingContext = createContext<string | null>(null);

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; promise: Promise<SummaryDto | null> }>();

export function loadEvolutionSummary(accessToken: string): Promise<SummaryDto | null> {
  const hit = cache.get(accessToken);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;
  const promise = fetchJsonAuth<SummaryDto>('/me/evolution/summary', accessToken).then((summary) => {
    if (!summary) cache.delete(accessToken); // erro: a próxima tela tenta de novo
    return summary;
  });
  cache.set(accessToken, { at: Date.now(), promise });
  return promise;
}

/** undefined = carregando; null = sem leitura (erro ou sem token). */
export function useEvolutionSummary(accessToken: string | null): SummaryDto | null | undefined {
  const [data, setData] = useState<SummaryDto | null | undefined>(accessToken ? undefined : null);
  useEffect(() => {
    if (!accessToken) { setData(null); return undefined; }
    let alive = true;
    loadEvolutionSummary(accessToken).then((summary) => { if (alive) setData(summary); });
    return () => { alive = false; };
  }, [accessToken]);
  return data;
}

// Ids dos textos "O que isso representa" que não são ids de variável.
const MEANING_TO_VARIABLE: Record<string, string> = { 'training.volume': 'training.volumeCompletedTotalKm' };

export function findIndicator(summary: SummaryDto | null | undefined, id: string | null | undefined): IndicatorDto | null {
  if (!summary || !id) return null;
  const variableId = MEANING_TO_VARIABLE[id] ?? id;
  for (const area of summary.areas) {
    const found = area.indicators.find((indicator) => indicator.variableId === variableId);
    if (found) return found;
  }
  return null;
}

export function useIndicatorReading(id: string | null | undefined): IndicatorDto | null {
  const token = useContext(EvolutionReadingContext);
  const summary = useEvolutionSummary(token);
  return findIndicator(summary, id);
}

/** Qual indicador de volume comenta o gráfico, conforme as séries marcadas (realizado/prescrito/extras). */
export function volumeReadingId(series: Iterable<'percorrido' | 'prescrito' | 'extras'>): string | null {
  const set = new Set(series);
  if (set.has('percorrido') && set.has('prescrito')) return 'training.volumeRatioCompletedPrescribed';
  if (set.has('prescrito')) return 'training.volumePrescribedKm';
  if (set.has('percorrido')) return 'training.volumeCompletedTotalKm';
  if (set.has('extras')) return 'training.volumeExtraKm';
  return null;
}
