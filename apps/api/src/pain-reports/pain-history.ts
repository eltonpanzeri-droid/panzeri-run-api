import { activityLocalDate } from '../common/local-date';

// Historico de dor POR TREINO para o grafico da aluna (02/11/2026). So' classifica o que ja' existe; nenhuma formula, media ou faixa.
//
// Regra de Elton (02/11/2026): todo treino REGISTRADO e que conta nas nossas contas vale zero de dor quando a aluna nao relatou dor. Como a resposta de dor e' obrigatoria
// no feedback, "nenhuma" (respondida) e' um zero afirmado; treino registrado sem resposta de dor (so' o relogio, feedback nao aberto) e' zero ASSUMIDO por inferencia — e a
// diferenca fica marcada em `answered`, para a tela mostrar os dois de forma diferente. Nada e' gravado no banco em nome da aluna: a inferencia existe so' na leitura.
// Valor de dor que este codigo nao reconhece NAO vira zero (nem qualquer outro nivel): o treino fica de fora, em vez de adivinhar.

export type PainLevel = 'none' | 'leve' | 'moderado' | 'forte';
const LEVELS: ReadonlySet<string> = new Set<PainLevel>(['none', 'leve', 'moderado', 'forte']);

export interface PainHistorySessionRow {
  id: string;
  modality: string | null;
  scheduledDate: Date;
  origin: string | null;
  hasActiveLink: boolean;
  completion: { status: string | null; painFlag: string | null; painTiming: string | null } | null;
}

export interface PainHistoryActivityRow {
  id: string;
  sport: string | null;
  startedAt: Date;
  utcOffsetMinutes: number | null;
}

export interface PainHistoryEntry {
  id: string;
  /** Dia local AAAA-MM-DD. */
  date: string;
  modality: string;
  level: PainLevel;
  /** true = a aluna respondeu a dor deste treino; false = zero assumido (treino registrado, sem resposta). */
  answered: boolean;
  timing: string | null;
  origin: 'prescrita' | 'extra' | 'relogio';
}

function originOf(origin: string | null): PainHistoryEntry['origin'] {
  if (origin === 'device_extra') return 'relogio';
  if (origin === 'student_extra') return 'extra';
  return 'prescrita';
}

export function buildPainHistory(input: { sessions: PainHistorySessionRow[]; unlinkedActivities: PainHistoryActivityRow[] }): PainHistoryEntry[] {
  const entries: PainHistoryEntry[] = [];

  for (const session of input.sessions) {
    const status = session.completion?.status ?? null;
    // "Nao feito" explicito nunca e' treino registrado (mesmo com atividade ao lado: ambiguo, nao se infere nada).
    if (status === 'missed') continue;
    const registered = status === 'done' || status === 'adjusted' || (session.completion == null && session.hasActiveLink);
    if (!registered) continue;

    const flag = session.completion?.painFlag?.trim() || null;
    if (flag != null && !LEVELS.has(flag)) continue;
    entries.push({
      id: session.id,
      date: session.scheduledDate.toISOString().slice(0, 10),
      modality: session.modality ?? 'outra',
      level: (flag as PainLevel | null) ?? 'none',
      answered: flag != null,
      timing: flag != null && flag !== 'none' ? session.completion?.painTiming ?? null : null,
      origin: originOf(session.origin),
    });
  }

  for (const activity of input.unlinkedActivities) {
    entries.push({
      id: `act:${activity.id}`,
      date: activityLocalDate(activity.startedAt, activity.utcOffsetMinutes),
      modality: activity.sport ?? 'outra',
      level: 'none',
      answered: false,
      timing: null,
      origin: 'relogio',
    });
  }

  return entries.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
