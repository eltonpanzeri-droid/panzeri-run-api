import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PolarService } from './polar.service';

const ACCESSLINK_BASE = 'https://www.polaraccesslink.com';
const REQUEST_TIMEOUT_MS = 20_000;

// DIAGNOSTICO ADMINISTRATIVO TEMPORARIO da Polar (23/10/2026). Remover depois do uso. Somente LEITURA: chama os endpoints de saude da Polar com o token da UNICA conexao ativa e devolve apenas a
// ESTRUTURA — status HTTP, nomes de campos, contagens, formato dos textos de data (digitos viram 'd') e FAIXAS NUMERICAS (minimo/maximo) para confirmar unidades e a conta da duracao do sono.
// Nenhuma data, id, token ou valor individual (nem por noite) sai daqui, nada e' gravado no banco e nada e' escrito em log. So' roda com POLAR_PROBE_ENABLED=true e para o administrador, e usa a
// conexao Polar do PROPRIO administrador que chamou. Se ele nao tiver conexao propria, so' usa a unica conexao ativa existente quando POLAR_PROBE_ALLOW_SINGLE_CONNECTION=true (autorizacao explicita).
export interface ProbeEndpointResult {
  endpoint: string;
  httpStatus: number; // 0 = falha de rede
  meaning: string;
  items?: number;
  topLevelKeys?: string[];
  itemKeys?: string[];
  formats?: Record<string, string>;
  ranges?: Record<string, { min: number; max: number; n: number }>;
  /** Agregado (sem noites individuais): quanto o intervalo inicio-fim difere de cada soma de etapas, em segundos. */
  sleepReconciliation?: Record<string, unknown>;
  nested?: Record<string, string | number>;
}

const MEANING: Record<number, string> = {
  0: 'falha de rede ou tempo esgotado', 200: 'ok, com dados', 204: 'ok, sem dados no periodo', 401: 'token invalido ou expirado',
  403: 'a Polar recusou: o usuario nao aceitou todos os consentimentos obrigatorios (ou o app nao tem acesso a este tipo de dado)', 404: 'sem dados para o periodo', 429: 'limite de chamadas atingido',
};
const meaning = (status: number) => MEANING[status] ?? `status HTTP ${status}`;
const pattern = (value: unknown) => (typeof value === 'string' ? value.replace(/\d/g, 'd').slice(0, 40) : typeof value);
const isNum = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const keysOf = (value: unknown): string[] => (value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value as object).sort() : []);

function listOf(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== 'object') return [];
  const first = Object.values(body as Record<string, unknown>).find((v) => Array.isArray(v));
  return Array.isArray(first) ? first : [];
}
function range(values: unknown[]): { min: number; max: number; n: number } | undefined {
  const nums = values.filter(isNum);
  return nums.length ? { min: Math.min(...nums), max: Math.max(...nums), n: nums.length } : undefined;
}
function epoch(value: unknown): number | null { const t = typeof value === 'string' ? Date.parse(value) : NaN; return Number.isNaN(t) ? null : t / 1000; }
// valores de um objeto "chave de tempo -> numero" (ex.: hrv_samples) ou de um array
function sampleValues(value: unknown): number[] {
  if (Array.isArray(value)) return value.filter(isNum);
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).filter(isNum);
  return [];
}

@Injectable()
export class PolarProbeService {
  constructor(private readonly prisma: PrismaService, private readonly polar: PolarService) {}

  enabled(env: Record<string, string | undefined> = process.env): boolean {
    return (env.POLAR_PROBE_ENABLED ?? '').trim().toLowerCase() === 'true';
  }

  private async get(path: string, token: string): Promise<{ status: number; body: unknown }> {
    try {
      const response = await fetch(`${ACCESSLINK_BASE}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      return { status: response.status, body: response.status === 200 ? await response.json().catch(() => null) : null };
    } catch { return { status: 0, body: null }; }
  }

  allowSingleConnection(env: Record<string, string | undefined> = process.env): boolean {
    return (env.POLAR_PROBE_ALLOW_SINGLE_CONNECTION ?? '').trim().toLowerCase() === 'true';
  }

  async run(adminUserId: string): Promise<{ activeConnections: number; endpoints: ProbeEndpointResult[]; note: string }> {
    const own = await this.prisma.polarConnection.findUnique({ where: { userId: adminUserId }, select: { disconnectedAt: true, accessTokenEncrypted: true } });
    let encrypted: string | null = own && !own.disconnectedAt ? own.accessTokenEncrypted : null;
    if (!encrypted) {
      if (!this.allowSingleConnection()) {
        return { activeConnections: 0, endpoints: [], note: 'A conta de administrador que chamou nao tem conexao Polar ativa. Para usar a unica conexao ativa do sistema, ligue POLAR_PROBE_ALLOW_SINGLE_CONNECTION=true.' };
      }
      const connections = await this.prisma.polarConnection.findMany({ where: { disconnectedAt: null, accessTokenEncrypted: { not: null } }, select: { accessTokenEncrypted: true } });
      if (connections.length !== 1) {
        return { activeConnections: connections.length, endpoints: [], note: connections.length === 0 ? 'Nenhuma conexao Polar ativa.' : 'Ha mais de uma conexao Polar ativa: o diagnostico so roda com a conexao do proprio administrador ou quando existe exatamente uma.' };
      }
      encrypted = connections[0].accessTokenEncrypted as string;
    }
    const token = this.polar.decryptAccessToken(encrypted);
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
    const endpoints: ProbeEndpointResult[] = [];

    // Sono
    {
      const { status, body } = await this.get('/v3/users/sleep', token);
      const items = listOf(body);
      const r: ProbeEndpointResult = { endpoint: 'GET /v3/users/sleep', httpStatus: status, meaning: meaning(status) };
      if (status === 200) {
        r.items = items.length; r.topLevelKeys = keysOf(body); r.itemKeys = keysOf(items[0]);
        const first = (items[0] ?? {}) as Record<string, unknown>;
        r.formats = { date: pattern(first.date), sleep_start_time: pattern(first.sleep_start_time), sleep_end_time: pattern(first.sleep_end_time) };
        r.ranges = {};
        for (const field of ['light_sleep', 'deep_sleep', 'rem_sleep', 'unrecognized_sleep_stage', 'total_interruption_duration', 'sleep_score', 'sleep_goal', 'sleep_charge', 'continuity'] as const) {
          const rg = range(items.map((i) => (i as Record<string, unknown>)?.[field])); if (rg) r.ranges[field] = rg;
        }
        // Conta da duracao, AGREGADA (sem noites individuais): quanto o intervalo (fim - inicio) difere de cada soma de etapas, em segundos.
        const rows = items.map((raw) => {
          const i = raw as Record<string, unknown>;
          const start = epoch(i.sleep_start_time); const end = epoch(i.sleep_end_time);
          const light = isNum(i.light_sleep) ? i.light_sleep : null; const deep = isNum(i.deep_sleep) ? i.deep_sleep : null; const rem = isNum(i.rem_sleep) ? i.rem_sleep : null;
          const unrec = isNum(i.unrecognized_sleep_stage) ? i.unrecognized_sleep_stage : null; const interruption = isNum(i.total_interruption_duration) ? i.total_interruption_duration : null;
          const interval = start != null && end != null ? Math.round(end - start) : null;
          const asleep = light != null && deep != null && rem != null ? light + deep + rem : null;
          return { interval, asleep, withInterruptions: asleep != null && interruption != null ? asleep + interruption : null, withUnrecognized: asleep != null && interruption != null ? asleep + interruption + (unrec ?? 0) : null };
        });
        const diff = (pick: (row: (typeof rows)[number]) => number | null) => range(rows.map((row) => (row.interval != null && pick(row) != null ? row.interval - (pick(row) as number) : null)));
        r.sleepReconciliation = {
          noites: rows.length,
          diferenca_intervalo_menos_soma_leve_profundo_rem_s: diff((row) => row.asleep) ?? null,
          diferenca_intervalo_menos_etapas_mais_interrupcoes_s: diff((row) => row.withInterruptions) ?? null,
          diferenca_intervalo_menos_etapas_mais_interrupcoes_mais_nao_reconhecido_s: diff((row) => row.withUnrecognized) ?? null,
        };
        r.nested = { hypnogram: first.hypnogram && typeof first.hypnogram === 'object' ? `objeto com ${Object.keys(first.hypnogram as object).length} chaves` : typeof first.hypnogram, heart_rate_samples: first.heart_rate_samples && typeof first.heart_rate_samples === 'object' ? `objeto com ${Object.keys(first.heart_rate_samples as object).length} chaves` : typeof first.heart_rate_samples, sleep_cycles: typeof first.sleep_cycles };
      }
      endpoints.push(r);
    }

    // Nightly Recharge / HRV
    {
      const { status, body } = await this.get('/v3/users/nightly-recharge', token);
      const items = listOf(body);
      const r: ProbeEndpointResult = { endpoint: 'GET /v3/users/nightly-recharge', httpStatus: status, meaning: meaning(status) };
      if (status === 200) {
        r.items = items.length; r.topLevelKeys = keysOf(body); r.itemKeys = keysOf(items[0]);
        const first = (items[0] ?? {}) as Record<string, unknown>;
        r.formats = { date: pattern(first.date), ans_charge_status: typeof first.ans_charge_status, nightly_recharge_status: typeof first.nightly_recharge_status };
        r.ranges = {};
        for (const field of ['heart_rate_variability_avg', 'heart_rate_avg', 'beat_to_beat_avg', 'breathing_rate_avg', 'ans_charge'] as const) {
          const rg = range(items.map((i) => (i as Record<string, unknown>)?.[field])); if (rg) r.ranges[field] = rg;
        }
        const hrv = range(items.flatMap((i) => sampleValues((i as Record<string, unknown>)?.hrv_samples))); if (hrv) r.ranges.hrv_samples = hrv;
        const breathing = range(items.flatMap((i) => sampleValues((i as Record<string, unknown>)?.breathing_samples))); if (breathing) r.ranges.breathing_samples = breathing;
        r.nested = { hrv_samples: Array.isArray(first.hrv_samples) ? 'lista' : first.hrv_samples && typeof first.hrv_samples === 'object' ? 'objeto (tempo -> valor)' : typeof first.hrv_samples };
      }
      endpoints.push(r);
    }

    // Atividade diaria
    {
      const { status, body } = await this.get('/v3/users/activities', token);
      const items = listOf(body);
      const r: ProbeEndpointResult = { endpoint: 'GET /v3/users/activities', httpStatus: status, meaning: meaning(status) };
      if (status === 200) {
        r.items = items.length; r.topLevelKeys = keysOf(body); r.itemKeys = keysOf(items[0]);
        const first = (items[0] ?? {}) as Record<string, unknown>;
        r.formats = { date: pattern(first.date), start_time: pattern(first.start_time), end_time: pattern(first.end_time), active_duration: pattern(first.active_duration) };
        r.ranges = {};
        for (const field of ['steps', 'calories', 'active_calories', 'distance_from_steps'] as const) {
          const rg = range(items.map((i) => (i as Record<string, unknown>)?.[field])); if (rg) r.ranges[field] = rg;
        }
      }
      endpoints.push(r);
    }

    // FC continua (ultimos 7 dias)
    {
      const { status, body } = await this.get(`/v3/users/continuous-heart-rate?from=${from}&to=${to}`, token);
      const items = listOf(body);
      const r: ProbeEndpointResult = { endpoint: 'GET /v3/users/continuous-heart-rate?from&to (7 dias)', httpStatus: status, meaning: meaning(status) };
      if (status === 200) {
        r.items = items.length; r.topLevelKeys = keysOf(body); r.itemKeys = keysOf(items[0]);
        const first = (items[0] ?? {}) as Record<string, unknown>;
        const samples = Array.isArray(first.heart_rate_samples) ? first.heart_rate_samples : [];
        r.formats = { date: pattern(first.date), sample_keys: keysOf(samples[0]).join(',') };
        r.ranges = {}; const hr = range(samples.map((s) => (s as Record<string, unknown>)?.heart_rate)); if (hr) r.ranges.heart_rate = hr;
      }
      endpoints.push(r);
    }

    return { activeConnections: 1, endpoints, note: 'Diagnostico somente leitura: nenhum dado foi gravado. Resultado visivel apenas para o administrador que chamou.' };
  }
}
