// Formatacao de FATOS de execucao e de diretrizes para o contexto do Agente Treinador e para o
// Prontuario (05/10/2026, caso Eduarda). Puro texto a partir de dados que ja existem — nenhuma
// classificacao nova, nenhum estado de progressao, nenhuma regra de prescricao: o Treinador le os
// fatos e interpreta sozinho em que ponto de uma diretriz o aluno esta. Ausencia de dado continua
// ausencia (o campo simplesmente nao aparece), nunca zero.

const SHAPE_SESSION_TYPES = new Set(['continuo', 'intervalado', 'misto']);

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * Forma da sessao de corrida, derivada SO do que a prescricao gravou (sessionType + blocos de
 * structure, ambos montados a partir de parts[]): "continuo", "intervalado: 6x(Correr/Caminhar)" ou
 * "misto: continua + 6x(Correr/Caminhar) + continua". Retorna null quando a estrutura gravada nao
 * permite afirmar a forma com seguranca (sessionType ausente/legado, ou nao e corrida) — nunca
 * chuta. "continuo" significa uma unica parte continua; o ritmo prescrito (que acompanha a linha)
 * e' o que diferencia corrida de caminhada nessa parte.
 */
export function describeSessionShape(sessionType: string | null | undefined, structure: unknown): string | null {
  if (!sessionType || !SHAPE_SESSION_TYPES.has(sessionType)) return null;
  if (sessionType === 'continuo') return 'continuo';
  const blocks = asObject(structure).blocks;
  if (!Array.isArray(blocks) || blocks.length === 0) return sessionType;
  const pieces = blocks.map((block) => {
    const b = asObject(block);
    const steps = Array.isArray(b.steps) ? b.steps : null;
    if (!steps) return 'continua';
    const labels = steps.map((step) => String(asObject(step).label ?? '').trim()).filter(Boolean);
    const repeat = typeof b.repeatCount === 'number' ? `${b.repeatCount}x` : '';
    return `${repeat}(${labels.join('/')})`;
  });
  return `${sessionType}: ${pieces.join(' + ')}`;
}

function formatPaceSeconds(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}/km`;
}

function formatKm(km: number): string {
  return `${Number.isInteger(km) ? km : Number(km.toFixed(2))}km`;
}

export function pacingModeLabel(pacingMode: unknown): string | null {
  if (typeof pacingMode !== 'string' || !pacingMode) return null;
  return pacingMode === 'correu_tudo' ? 'correu tudo sem caminhar/parar (autorrelato)' : 'caminhou/parou em algum trecho (autorrelato)';
}

const WEEKDAYS_PT = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];

export interface RecordedSessionInput {
  scheduledDate: Date;
  weekday: number;
  modality: string;
  sessionType: string | null;
  structure: unknown;
  distanceKm: number | null;
  durationMin: number | null;
  paceMinSec: string | null;
  completion: {
    status: string;
    distanceKm: number | null;
    durationMin: number | null;
    avgPaceSecondsKm: number | null;
    details: unknown;
  };
}

const STATUS_LABEL: Record<string, string> = {
  done: 'concluido',
  adjusted: 'concluido com ajustes',
  missed: 'marcado como nao feito pelo aluno',
};

/**
 * Uma linha por sessao COM registro do aluno, no formato
 * "sabado 2026-09-19 | corrida | continuo | prescrito 5km 40min pace 7:30/km | concluido: 5km 38min 7:36/km, correu tudo ...".
 * So usa campos conhecidos; o que nao existe fica de fora.
 */
export function formatRecordedSession(session: RecordedSessionInput): string {
  const prescribed = [
    session.distanceKm != null ? formatKm(session.distanceKm) : null,
    session.durationMin != null ? `${session.durationMin}min` : null,
    session.paceMinSec ? `pace ${session.paceMinSec}` : null,
  ].filter(Boolean).join(' ');
  const { completion } = session;
  const realized = [
    completion.distanceKm != null ? formatKm(completion.distanceKm) : null,
    completion.durationMin != null ? `${Math.round(completion.durationMin)}min` : null,
    completion.avgPaceSecondsKm != null ? formatPaceSeconds(completion.avgPaceSecondsKm) : null,
  ].filter(Boolean).join(' ');
  const pacing = pacingModeLabel(asObject(completion.details).pacingMode);
  const statusText = STATUS_LABEL[completion.status] ?? completion.status;
  const outcome = [realized, pacing].filter(Boolean).join(', ');
  return [
    `${WEEKDAYS_PT[session.weekday] ?? session.weekday} ${session.scheduledDate.toISOString().slice(0, 10)}`,
    session.modality,
    describeSessionShape(session.sessionType, session.structure),
    prescribed ? `prescrito ${prescribed}` : null,
    outcome ? `${statusText}: ${outcome}` : statusText,
  ].filter(Boolean).join(' | ');
}

/** Diretriz ativa com a data em que foi criada, para o Treinador situar a trajetoria no tempo. */
export function formatDirectiveForAgent(directive: { content: string; createdAt?: Date | null }): string {
  return directive.createdAt ? `[criada em ${directive.createdAt.toISOString().slice(0, 10)}] ${directive.content}` : directive.content;
}
