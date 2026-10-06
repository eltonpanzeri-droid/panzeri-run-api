// Validacao OFFLINE e SOMENTE LEITURA da identidade fisica cross-provider (Apple Etapa 2).
// NAO acessa banco nem rede: le um arquivo JSON exportado por SELECT (ver comando abaixo) e roda o matcher puro
// (compareObservations) em todos os pares de registros do mesmo usuario. Nada e' gravado em lugar nenhum.
//
// 1) No banco (so leitura), troque <USER_ID> e rode:
//    SELECT json_agg(t) FROM (
//      SELECT a.id, a."userId", a.provider, a.sport, a."startedAt", a."durationSec", a."distanceMeters", a."providerMetrics"
//      FROM "ActivityLog" a WHERE a."userId" = '<USER_ID>' AND a."startedAt" >= '2026-09-30' ORDER BY a."startedAt"
//    ) t;
//    Salve o resultado (um array JSON) em um arquivo, ex.: atividades.json
// 2) Rode (de apps/api):  npx ts-node scripts/validate-physical-identity.ts caminho/atividades.json
import { readFileSync } from 'node:fs';
import { compareObservations, observerKeyOf, ObservedActivity } from '../src/activity-execution/physical-activity-identity';

interface ExportedRow {
  id: string;
  userId: string;
  provider: string;
  sport: string | null;
  startedAt: string;
  durationSec: number | null;
  distanceMeters: number | null;
  providerMetrics: unknown;
}

function toObserved(row: ExportedRow): ObservedActivity {
  const endedAtRaw = (row.providerMetrics as { endedAt?: unknown } | null)?.endedAt;
  const endedAt = typeof endedAtRaw === 'string' && !Number.isNaN(new Date(endedAtRaw).getTime()) ? new Date(endedAtRaw) : null;
  return {
    id: row.id, userId: row.userId, provider: row.provider, sport: row.sport, startedAt: new Date(row.startedAt),
    durationSec: row.durationSec, distanceMeters: row.distanceMeters, endedAt, observerKey: observerKeyOf(row.provider, row.providerMetrics),
  };
}

const file = process.argv[2];
if (!file) {
  console.error('Uso: npx ts-node scripts/validate-physical-identity.ts <arquivo.json>');
  process.exit(1);
}
const rows = (JSON.parse(readFileSync(file, 'utf8')) as ExportedRow[]).map(toObserved);
const WINDOW_MS = 12 * 60 * 60 * 1000;
let pairs = 0;
for (let i = 0; i < rows.length; i++) {
  for (let j = i + 1; j < rows.length; j++) {
    const a = rows[i];
    const b = rows[j];
    if (a.userId !== b.userId || Math.abs(a.startedAt.getTime() - b.startedAt.getTime()) > WINDOW_MS) continue;
    pairs++;
    const result = compareObservations(a, b);
    const km = (m: number | null) => (m == null ? '?' : (m / 1000).toFixed(2));
    console.log(`${result.verdict.toUpperCase().padEnd(9)} ${result.reason}`);
    for (const row of [a, b]) {
      console.log(`   ${row.observerKey.padEnd(34)} ${row.startedAt.toISOString()}  ${row.durationSec == null ? '?' : Math.round(row.durationSec / 60)}min  ${km(row.distanceMeters)}km  [${row.id.slice(0, 8)}]`);
    }
    console.log(`   criterios: ${result.evidence.map((e) => `${e.criterion}=${e.matched === null ? 'n/d' : e.level ?? e.matched}`).join(' | ')}`);
  }
}
console.log(`\n${rows.length} registros, ${pairs} pares avaliados (mesmo usuario, janela de 12h).`);
