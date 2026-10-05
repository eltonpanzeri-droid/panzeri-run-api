import { execFile } from 'child_process';
import { promisify } from 'util';
import { pgEnvFromUrl, redactSecrets, secretsFromDatabaseUrl } from './backup-sanitize';
import type { Tombstone } from './tombstone-ledger';

const execFileAsync = promisify(execFile);

// Restauracao e etapa pos-restauracao (05/10/2026). Regra FAIL CLOSED: um banco restaurado nao pode
// voltar a coletar dados de provider com autorizacoes que o usuario pode ter revogado DEPOIS do snapshot.
// Por isso a restauracao so' existe como "pg_restore + postRestoreSafeguard" numa operacao unica: nao ha
// parametro para pular a etapa pos-restauracao, e ela roda mesmo se o pg_restore terminar com erro
// (restauracao parcial tambem pode trazer tokens).
//
// postRestoreSafeguard so' mexe no banco LOCAL (nenhuma chamada a Polar/Strava):
//  - Polar: toda conexao ativa vira desconectada (disconnectedAt), token e estado de transaction apagados,
//    registeredAt zerado — o aluno precisa autorizar de novo (mesmo estado de uma desconexao normal).
//  - Strava: linhas de StravaConnection (tokens) removidas — a "desconexao" do Strava no sistema ja e' a
//    ausencia da linha (strava.service.ts), entao nada sincroniza sem novo OAuth.
// Depois do fail-closed, a restauracao carrega o ledger de tombstones (R2) e REAPLICA as exclusoes posteriores ao
// snapshot (applyTombstones, idempotente). Se o ledger estiver indisponivel, a restauracao NAO e' declarada
// concluida: o banco fica em fail-closed e o resultado informa reconciliacao pendente.

export interface SafeguardPrisma {
  polarConnection: { updateMany(args: { where: { disconnectedAt: null }; data: Record<string, unknown> }): Promise<{ count: number }> };
  stravaConnection: { deleteMany(args: Record<string, never>): Promise<{ count: number }> };
  // Dados Strava restaurados de um backup (anterior a regra de exclusao na origem) tambem nao voltam: o cache vale 7 dias.
  stravaActivity: { deleteMany(args: Record<string, never>): Promise<{ count: number }> };
  stravaAnalysisCache: { deleteMany(args: Record<string, never>): Promise<{ count: number }> };
  trainingExecutionInsight: { deleteMany(args: Record<string, never>): Promise<{ count: number }> };
  providerConnectionEvent: { create(args: { data: { userId: string; provider: string; type: string; details: unknown } }): Promise<unknown> };
}

export interface SafeguardResult { polarDisconnected: number; stravaConnectionsRemoved: number }

export async function postRestoreSafeguard(prisma: SafeguardPrisma, now: Date = new Date()): Promise<SafeguardResult> {
  const polar = await prisma.polarConnection.updateMany({
    where: { disconnectedAt: null },
    data: { disconnectedAt: now, accessTokenEncrypted: null, openTransactionId: null, openTransactionOpenedAt: null, registeredAt: null },
  });
  const strava = await prisma.stravaConnection.deleteMany({});
  await prisma.stravaActivity.deleteMany({});
  await prisma.stravaAnalysisCache.deleteMany({});
  await prisma.trainingExecutionInsight.deleteMany({});
  // Trilha de auditoria da propria restauracao (apenas contagens).
  await prisma.providerConnectionEvent.create({
    data: {
      userId: 'system', provider: 'all', type: 'post_restore_safeguard',
      details: { polarDisconnected: polar.count, stravaConnectionsRemoved: strava.count, at: now.toISOString() },
    },
  });
  return { polarDisconnected: polar.count, stravaConnectionsRemoved: strava.count };
}

// Margem anterior ao inicio do snapshot: a exclusao grava o tombstone e so' depois apaga (a transacao tem teto de
// 60 s). Um dump iniciado nesse intervalo pode conter dados cuja exclusao o tombstone ja' registrava. 5 min cobre o
// teto com folga; reaplicar e' idempotente.
export const SNAPSHOT_TOMBSTONE_MARGIN_MS = 5 * 60 * 1000;

export interface TombstoneApplication {
  status: 'applied' | 'pending';
  applied: number;
  skippedBeforeSnapshot: number;
  unsupported: number;
  error?: string;
}

// Reaplica so' os tombstones POSTERIORES ao snapshot. Idempotente: reexecutar nao muda o resultado.
export async function applyTombstones(opts: {
  snapshotStartedAt: Date;
  load: () => Promise<Tombstone[]>;
  deleteProviderData: (userId: string, provider: string) => Promise<unknown>;
  deleteAccount: (userId: string) => Promise<unknown>;
}): Promise<TombstoneApplication> {
  let tombstones: Tombstone[];
  try {
    tombstones = await opts.load();
  } catch (error) {
    return { status: 'pending', applied: 0, skippedBeforeSnapshot: 0, unsupported: 0, error: redactSecrets(error, []) };
  }
  const threshold = opts.snapshotStartedAt.getTime() - SNAPSHOT_TOMBSTONE_MARGIN_MS;
  let applied = 0;
  let skipped = 0;
  let unsupported = 0;
  for (const tombstone of tombstones) {
    if (Date.parse(tombstone.at) < threshold) { skipped++; continue; }
    if (tombstone.type === 'provider_data_deleted' && tombstone.provider) {
      await opts.deleteProviderData(tombstone.userId, tombstone.provider);
      applied++;
    } else if (tombstone.type === 'account_deleted') {
      await opts.deleteAccount(tombstone.userId); // mesma operacao local e idempotente; nao grava novo tombstone
      applied++;
    } else {
      unsupported++; // tipo desconhecido: mantem a reconciliacao pendente
    }
  }
  return unsupported > 0
    ? { status: 'pending', applied, skippedBeforeSnapshot: skipped, unsupported, error: 'Ha tombstones de tipo ainda nao suportado para reaplicacao.' }
    : { status: 'applied', applied, skippedBeforeSnapshot: skipped, unsupported };
}

export interface RestoreOutcome {
  safeguard: SafeguardResult;
  tombstones: TombstoneApplication;
  // So' e' true com o pg_restore OK, o fail-closed aplicado E todas as exclusoes posteriores reaplicadas.
  complete: boolean;
}

export type ExecFileLike = (file: string, args: string[], options: { env: Record<string, string>; maxBuffer: number }) => Promise<unknown>;

// pg_restore (sem shell, sem URL em argumento) seguido SEMPRE da etapa pos-restauracao.
export async function restoreBackupFile(opts: {
  dumpPath: string;
  targetDatabaseUrl: string;
  prisma: SafeguardPrisma;
  exec?: ExecFileLike;
  snapshotStartedAt: Date;
  loadTombstones: () => Promise<Tombstone[]>;
  deleteProviderData: (userId: string, provider: string) => Promise<unknown>;
  deleteAccount: (userId: string) => Promise<unknown>;
}): Promise<RestoreOutcome> {
  const exec: ExecFileLike = opts.exec ?? ((file, args, options) => execFileAsync(file, args, options));
  const env = pgEnvFromUrl(opts.targetDatabaseUrl);
  const secrets = secretsFromDatabaseUrl(opts.targetDatabaseUrl);
  let restoreError: unknown = null;
  try {
    // --dbname recebe so' o NOME do banco (sem credenciais); sem ele o pg_restore apenas imprimiria SQL.
    await exec('pg_restore', ['--clean', '--if-exists', '--no-owner', '--no-privileges', `--dbname=${env.PGDATABASE}`, opts.dumpPath], {
      env: { PATH: process.env.PATH ?? '', ...env }, maxBuffer: 8 * 1024 * 1024,
    });
  } catch (error) {
    restoreError = error;
  }
  // Fail closed: roda mesmo que o pg_restore tenha falhado no meio.
  const result = await postRestoreSafeguard(opts.prisma);
  if (restoreError) throw new Error(`pg_restore terminou com erro (a etapa pos-restauracao foi executada): ${redactSecrets(restoreError, secrets)}`);
  // Depois do fail-closed: carregar o ledger e reaplicar as exclusoes posteriores ao snapshot.
  const tombstones = await applyTombstones({ snapshotStartedAt: opts.snapshotStartedAt, load: opts.loadTombstones, deleteProviderData: opts.deleteProviderData, deleteAccount: opts.deleteAccount });
  return { safeguard: result, tombstones, complete: tombstones.status === 'applied' };
}
