import { isHealthBlockedForAi, isProviderBlockedForAi } from '../ai-governance/ai-scope';
import { chooseMainSource, isSourceSegmentationEnabled, sourceKeyOf } from './wearable-source';

// Evidencia PAREADA (21/10/2026): relato do aluno x medicao do aparelho, lado a lado, para o Atlas (agente existente) analisar as duas fontes JUNTAS:
//   - esforco percebido (1-10, relato do aluno) x o que o aparelho registrou na MESMA sessao (FC media, ritmo medio, potencia, cadencia);
//   - sono percebido (qualidade 1-5 e faixa de horas, relato do aluno) x sono do relogio no dia correspondente (duracao, etapas, pontuacao do fabricante).
// Este arquivo NAO interpreta nem calcula nada novo: junta registros que ja existem (WorkoutCompletion/NightlySleepLog x ActivityLog/WearableSleepSummary) e rotula a NATUREZA de cada lado,
// para a IA nunca tratar percepcao, medicao, estimativa e inferencia como o mesmo tipo de fato. Provider-neutro (qualquer relogio que grave ActivityLog/WearableSleepSummary entra).
// Respeita o escopo de IA (provedor/categoria nao autorizados somem do pareamento) e nunca preenche lado ausente: sem os dois lados, nao ha par.

const PAIR_WINDOW_DAYS = 90;
const MAX_EFFORT_PAIRS = 10;
const MAX_SLEEP_PAIRS = 14;

export interface EffortDevicePair {
  date: string;
  sessionId: string;
  modality: string | null;
  perceivedEffort: { value: number; scale: '1-10'; kind: 'self_report' };
  device: {
    kind: 'device_measurement';
    provider: string;
    avgHeartRateBpm: number | null;
    avgPaceSecPerKm: number | null;
    powerAvgWatts: number | null;
    cadenceAvg: number | null;
    durationMin: number | null;
    distanceKm: number | null;
    // O vinculo entre a sessao e a atividade foi CONFIRMADO por uma pessoa (aluno/treinador) ou foi inferido pelo sistema (data, modalidade, horario, caracteristicas).
    linkConfirmedByPerson: boolean;
  };
}

export interface SleepPerceivedDevicePair {
  date: string;
  perceived: { kind: 'self_report'; sleepQuality: number | null; sleepQualityScale: '1-5 (5 = excelente)'; sleepDurationCategory: string | null };
  device: {
    provider: string;
    calendarDate: string;
    durationMin: number | null;
    deepMin: number | null;
    lightMin: number | null;
    remMin: number | null;
    awakeMin: number | null;
    score: number | null;
    // So' quando a MESMA fonte tem mais de uma sessao de sono no dia: a duracao acima e' a da sessao principal (a maior), NAO necessariamente a noite inteira.
    sourceKey?: string;
    additionalSessions?: number;
    durationScope?: string;
    // duracao e etapas = estimativa do algoritmo do relogio; pontuacao = calculo do fabricante.
    durationAndStagesKind: 'device_estimate';
    scoreKind: 'manufacturer_score';
  };
}

export interface PairedEvidence {
  effortVsDevice: EffortDevicePair[];
  sleepPerceivedVsDevice: SleepPerceivedDevicePair[];
  notes: string[];
}

export const PAIRED_EVIDENCE_NOTES = [
  'Esforco percebido e sono percebido sao PERCEPCAO do aluno; FC, ritmo, potencia e cadencia sao MEDICAO do aparelho; duracao e etapas do sono sao ESTIMATIVA do relogio; a pontuacao de sono e CALCULO do fabricante. Sao fontes diferentes: podem divergir sem que uma esteja errada.',
  'Quando linkConfirmedByPerson e false, a associacao da sessao com a atividade foi INFERIDA pelo sistema (nao e certeza).',
  'O sono do relogio e pareado pela data de calendario informada pelo relogio; se essa data marca o despertar ou o inicio da noite nao e garantido, entao o pareamento do sono e uma HIPOTESE.',
];

export const EMPTY_PAIRED_EVIDENCE: PairedEvidence = { effortVsDevice: [], sleepPerceivedVsDevice: [], notes: [...PAIRED_EVIDENCE_NOTES] };

const dayKey = (date: Date) => date.toISOString().slice(0, 10);
const minutes = (seconds: number | null | undefined): number | null => (seconds == null ? null : seconds / 60);

// Subconjunto do cliente do banco usado aqui (facilita testar sem banco).
export interface PairedEvidenceDb {
  workoutCompletion: { findMany(args: unknown): Promise<any[]> };
  nightlySleepLog: { findMany(args: unknown): Promise<any[]> };
  wearableSleepSummary: { findMany(args: unknown): Promise<any[]> };
}

export async function buildPairedEvidence(db: PairedEvidenceDb, userId: string, now: Date = new Date(), options: { sleepSourceKey?: string | null } = {}): Promise<PairedEvidence> {
  const since = new Date(now.getTime() - PAIR_WINDOW_DAYS * 86_400_000);

  // Esforco percebido x aparelho (atividade vinculada e ATIVA da mesma sessao).
  const completions = await db.workoutCompletion.findMany({
    where: { userId, perceivedEffort: { not: null }, sessionId: { not: null }, completedAt: { gte: since } },
    orderBy: { completedAt: 'desc' },
    take: 40,
    select: {
      perceivedEffort: true,
      session: {
        select: {
          id: true, scheduledDate: true, modality: true,
          executionLinks: {
            where: { status: 'active' },
            take: 1,
            select: { origin: true, activityLog: { select: { provider: true, sport: true, durationSec: true, distanceMeters: true, avgHeartRateBpm: true, powerAvgWatts: true, cadenceAvg: true } } },
          },
        },
      },
    },
  });
  const effortVsDevice: EffortDevicePair[] = [];
  for (const completion of completions) {
    const session = completion.session;
    const link = session?.executionLinks?.[0];
    const log = link?.activityLog;
    if (!session || !log || completion.perceivedEffort == null) continue;
    if (isProviderBlockedForAi(log.provider)) continue; // fora do escopo de IA: nao entra
    const distanceKm = log.distanceMeters != null && log.distanceMeters > 0 ? log.distanceMeters / 1000 : null;
    effortVsDevice.push({
      date: dayKey(session.scheduledDate),
      sessionId: session.id,
      modality: session.modality ?? null,
      perceivedEffort: { value: completion.perceivedEffort, scale: '1-10', kind: 'self_report' },
      device: {
        kind: 'device_measurement',
        provider: log.provider,
        avgHeartRateBpm: log.avgHeartRateBpm ?? null,
        avgPaceSecPerKm: distanceKm !== null && log.durationSec != null && log.durationSec > 0 ? log.durationSec / distanceKm : null,
        powerAvgWatts: log.powerAvgWatts ?? null,
        cadenceAvg: log.cadenceAvg ?? null,
        durationMin: minutes(log.durationSec),
        distanceKm,
        linkConfirmedByPerson: link.origin === 'student' || link.origin === 'coach',
      },
    });
    if (effortVsDevice.length >= MAX_EFFORT_PAIRS) break;
  }

  // Sono percebido x sono do relogio (mesma data de calendario).
  const logs = await db.nightlySleepLog.findMany({ where: { userId, nightDate: { gte: since } }, orderBy: { nightDate: 'desc' }, take: 60 });
  const perceivedByDate = new Map<string, any>();
  for (const log of logs) if (log.sleepQuality != null || log.sleepDurationCategory != null) perceivedByDate.set(dayKey(log.nightDate), log);
  const sleepPerceivedVsDevice: SleepPerceivedDevicePair[] = [];
  if (perceivedByDate.size > 0) {
    const summaries = await db.wearableSleepSummary.findMany({ where: { userId, calendarDate: { in: [...perceivedByDate.keys()] } }, orderBy: { calendarDate: 'desc' } });
    const allowed = summaries.filter((summary) => !isHealthBlockedForAi(summary.provider, 'sleep'));
    const keyOf = (row: any) => sourceKeyOf(row.provider, row.providerSummaryId);
    const sourceKeys = new Set(allowed.map(keyOf));
    const segmented = isSourceSegmentationEnabled();
    const multiSource = segmented && sourceKeys.size > 1;
    const bestByDate = new Map<string, any>();
    const extraSessionsByDate = new Map<string, number>();
    if (!segmented) {
      // Separacao por fonte DESLIGADA (WEARABLE_SOURCE_SEGMENTATION_ENABLED=false): comportamento anterior, identico.
      for (const summary of allowed) {
        const current = bestByDate.get(summary.calendarDate);
        // Mais de um resumo no mesmo dia: o de maior duracao (noite principal).
        if (!current || (summary.durationSec ?? 0) > (current.durationSec ?? 0)) bestByDate.set(summary.calendarDate, summary);
      }
    } else {
      // Fonte PRINCIPAL da aluna para o sono (a mesma da serie do Atlas); sem informacao, a de mais cobertura/atualidade entre as linhas. Um dia SEM linha dessa fonte e' PULADO:
      // nunca se troca de fonte num dia (isso misturaria metodos de medicao diferentes na mesma lista). Dentro da fonte, a MAIOR sessao e' a principal — NAO e' a duracao
      // total da noite (limitacao explicita: sono dividido so' sera interpretado com dado real do Health Connect). Nada e' somado nem estimado.
      const mainKey = options.sleepSourceKey
        ?? chooseMainSource([...sourceKeys].map((key) => ({ key, timestamps: allowed.filter((row) => keyOf(row) === key).map((row) => new Date((row.startTimeSec ?? 0) * 1000)) })), null, now);
      const byDate = new Map<string, any[]>();
      for (const row of allowed) {
        if (keyOf(row) !== mainKey) continue;
        const list = byDate.get(row.calendarDate);
        if (list) list.push(row);
        else byDate.set(row.calendarDate, [row]);
      }
      for (const [date, list] of byDate) {
        bestByDate.set(date, [...list].sort((a, b) => (b.durationSec ?? -1) - (a.durationSec ?? -1))[0]); // estavel: empate = primeira linha lida (como antes)
        extraSessionsByDate.set(date, list.length - 1);
      }
    }
    for (const date of [...perceivedByDate.keys()].sort().reverse()) {
      const summary = bestByDate.get(date);
      const perceived = perceivedByDate.get(date);
      if (!summary) continue;
      sleepPerceivedVsDevice.push({
        date,
        perceived: { kind: 'self_report', sleepQuality: perceived.sleepQuality ?? null, sleepQualityScale: '1-5 (5 = excelente)', sleepDurationCategory: perceived.sleepDurationCategory ?? null },
        device: {
          provider: summary.provider,
          // So' quando ha mais de uma fonte de sono: o provedor sozinho nao distingue apps diferentes dentro do Health Connect.
          ...(multiSource ? { sourceKey: keyOf(summary) } : {}),
          calendarDate: summary.calendarDate,
          durationMin: minutes(summary.durationSec),
          deepMin: minutes(summary.deepSleepSec),
          lightMin: minutes(summary.lightSleepSec),
          remMin: minutes(summary.remSleepSec),
          awakeMin: minutes(summary.awakeSec),
          score: summary.scoreValue ?? null,
          ...((extraSessionsByDate.get(date) ?? 0) > 0
            ? { additionalSessions: extraSessionsByDate.get(date), durationScope: 'duracao da sessao principal da fonte (a maior do dia); NAO e necessariamente a duracao total da noite' }
            : {}),
          durationAndStagesKind: 'device_estimate',
          scoreKind: 'manufacturer_score',
        },
      });
      if (sleepPerceivedVsDevice.length >= MAX_SLEEP_PAIRS) break;
    }
  }

  return { effortVsDevice, sleepPerceivedVsDevice, notes: [...PAIRED_EVIDENCE_NOTES] };
}
