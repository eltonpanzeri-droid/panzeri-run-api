import { OWN_RECORDING_PROVIDER_ID } from './physical-canonical';

// "Qual gravacao vale?" na tela da aluna (21/11/2026, Elton). Funcao PURA: dadas as observacoes de um mesmo evento fisico, diz se a aluna pode escolher outra gravacao do mesmo treino (so' existe quando o
// evento tem uma gravacao do proprio Panzeri Run) e devolve o que ela precisa para decidir: quem vale agora e as outras gravacoes com o que cada uma registrou. Nao decide nada, nao altera nada: so' descreve o
// que o servidor ja' escolheu (canonica) e o que a aluna pode pedir (POST /me/activity-reconciliation/:id/canonical-choice).
export interface RecordingMember {
  id: string;
  provider: string;
  physicalEventId: string | null;
  physicalIdentityStatus: string | null;
  physicalCanonicalActivityLogId: string | null;
  studentCanonicalChoiceAt: Date | null;
  durationSec: number | null;
  distanceMeters: number | null;
  avgHeartRateBpm: number | null;
  maxHeartRateBpm: number | null;
  cadenceAvg: number | null;
  powerAvgWatts: number | null;
  elevationGainMeters: number | null;
  hasRoute: boolean | null;
  providerMetrics: unknown;
}

export interface RecordingAlternative {
  activityLogId: string;
  provider: string;
  label: string; // "Garmin Forerunner 265", "Relógio Wear OS", "Panzeri Run"...
  durationMin: number | null;
  distanceKm: number | null;
  avgHeartRateBpm: number | null;
  hasCadence: boolean;
  hasPower: boolean;
  hasRoute: boolean;
  // Esta gravacao registrou algo que a que vale agora nao tem (frequencia cardiaca, cadencia ou potencia): base da recomendacao mostrada a aluna.
  moreData: boolean;
}

export interface RecordingChoice {
  // quem vale agora no evento
  currentProvider: string;
  currentIsOwn: boolean;
  chosenByStudent: boolean; // a aluna escolheu a gravacao de outra fonte no lugar da do Panzeri Run
  alternatives: RecordingAlternative[];
}

const LABELS: Record<string, string> = {
  panzeri_run: 'Panzeri Run', garmin: 'Garmin', wear_os: 'Relógio Wear OS', zepp: 'Zepp/Amazfit', polar: 'Polar', wahoo: 'Wahoo', coros: 'COROS', apple_health: 'Apple Saúde', health_connect: 'Health Connect',
};

// Nome da fonte para a aluna. Garmin: a Garmin exige "Garmin [modelo do aparelho]" onde o dado dela aparece (se o modelo nao veio, so' "Garmin").
export function recordingLabel(provider: string, providerMetrics: unknown): string {
  const base = LABELS[provider] ?? provider;
  if (provider !== 'garmin') return base;
  const garmin = (providerMetrics as { garmin?: { deviceName?: unknown } } | null)?.garmin;
  const model = typeof garmin?.deviceName === 'string' ? garmin.deviceName.trim() : '';
  if (!model) return base;
  return /^garmin\b/i.test(model) ? model : `${base} ${model}`;
}

const has = (value: number | null) => value !== null && value !== undefined;

function alternativeOf(member: RecordingMember, current: RecordingMember): RecordingAlternative {
  return {
    activityLogId: member.id,
    provider: member.provider,
    label: recordingLabel(member.provider, member.providerMetrics),
    durationMin: member.durationSec !== null ? Math.round(member.durationSec / 60) : null,
    distanceKm: member.distanceMeters !== null ? Math.round(member.distanceMeters / 10) / 100 : null,
    avgHeartRateBpm: member.avgHeartRateBpm,
    hasCadence: has(member.cadenceAvg),
    hasPower: has(member.powerAvgWatts),
    hasRoute: member.hasRoute === true,
    moreData: (has(member.avgHeartRateBpm) && !has(current.avgHeartRateBpm)) || (has(member.cadenceAvg) && !has(current.cadenceAvg)) || (has(member.powerAvgWatts) && !has(current.powerAvgWatts)),
  };
}

// realizedIds: atividades mostradas como "realizadas" (a canonica de cada evento). members: TODAS as observacoes dos eventos dessas atividades. Devolve so' os eventos em que ha escolha a fazer.
export function buildRecordingChoices(realizedIds: string[], members: RecordingMember[]): Record<string, RecordingChoice> {
  const byId = new Map(members.map((member) => [member.id, member]));
  const byEvent = new Map<string, RecordingMember[]>();
  for (const member of members) {
    if (member.physicalIdentityStatus !== 'matched' || !member.physicalEventId) continue;
    byEvent.set(member.physicalEventId, [...(byEvent.get(member.physicalEventId) ?? []), member]);
  }
  const result: Record<string, RecordingChoice> = {};
  for (const id of realizedIds) {
    const shown = byId.get(id);
    if (!shown || shown.physicalIdentityStatus !== 'matched' || !shown.physicalEventId) continue;
    const group = byEvent.get(shown.physicalEventId) ?? [];
    if (!group.some((member) => member.provider === OWN_RECORDING_PROVIDER_ID)) continue; // sem gravacao do Panzeri Run: nao ha escolha (regra de sempre)
    const currentId = shown.physicalCanonicalActivityLogId ?? shown.id;
    const current = byId.get(currentId) ?? shown;
    const currentIsOwn = current.provider === OWN_RECORDING_PROVIDER_ID;
    const others = group.filter((member) => member.id !== current.id && (currentIsOwn ? member.provider !== OWN_RECORDING_PROVIDER_ID : member.provider === OWN_RECORDING_PROVIDER_ID));
    if (others.length === 0) continue;
    result[id] = {
      currentProvider: current.provider,
      currentIsOwn,
      chosenByStudent: !currentIsOwn && current.studentCanonicalChoiceAt !== null,
      alternatives: others.map((member) => alternativeOf(member, current)).sort((a, b) => (a.activityLogId < b.activityLogId ? -1 : 1)),
    };
  }
  return result;
}
