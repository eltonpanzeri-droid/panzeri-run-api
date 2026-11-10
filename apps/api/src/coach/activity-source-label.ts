// Origem do treino sincronizado, em texto para o treinador (painel): qual relogio/aparelho gravou e por qual canal chegou, como o Strava mostra ("Garmin Forerunner 970").
// So' afirma o que o proprio dado informa; sem nome de aparelho, mostra so' o canal. Nada e' inventado nem inferido.

const CHANNEL_NAME: Record<string, string> = {
  garmin: 'Garmin', zepp: 'Zepp/Amazfit', polar: 'Polar', wahoo: 'Wahoo', coros: 'COROS', strava: 'Strava', apple_health: 'Apple Saude', health_connect: 'Health Connect', samsung: 'Samsung Health',
};

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim().slice(0, 80) : null);
const asObject = (value: unknown): Record<string, unknown> | null => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

export function activitySourceLabel(provider: string | null | undefined, providerMetrics: unknown): string {
  const key = String(provider ?? '').toLowerCase();
  const channel = CHANNEL_NAME[key] ?? (key ? key : 'Origem desconhecida');
  const metrics = asObject(providerMetrics);
  let device: string | null = null;
  if (key === 'garmin') {
    const name = text(asObject(metrics?.garmin)?.deviceName);
    device = name ? (/garmin/i.test(name) ? name : `Garmin ${name}`) : null;
  } else if (key === 'zepp') {
    device = text(asObject(metrics?.zepp)?.deviceName);
  } else {
    const dev = asObject(metrics?.device);
    const parts = [text(dev?.manufacturer), text(dev?.model)].filter((part): part is string => part !== null);
    device = text(dev?.name) ?? (parts.length ? parts.join(' ') : null);
    if (!device) device = text(asObject(metrics?.source)?.name);
  }
  if (!device) return channel;
  return device.toLowerCase() === channel.toLowerCase() ? channel : `${device} (via ${channel})`;
}

export function activitySourceLabels(links: Array<{ activityLog: { id?: string; provider?: string | null; providerMetrics?: unknown } }> | null | undefined): string[] {
  const out: string[] = [];
  for (const link of links ?? []) {
    if (link.activityLog.provider === undefined && link.activityLog.providerMetrics === undefined) continue; // consulta sem os campos de origem
    const label = activitySourceLabel(link.activityLog.provider, link.activityLog.providerMetrics);
    if (!out.includes(label)) out.push(label);
  }
  return out;
}
