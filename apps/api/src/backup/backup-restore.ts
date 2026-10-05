import { execFile } from 'child_process';
import { promisify } from 'util';
import { pgEnvFromUrl, redactSecrets, secretsFromDatabaseUrl } from './backup-sanitize';

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
// Nao cobre (ver runbook): dados de provider excluidos depois do snapshot e contas excluidas depois do
// snapshot — dependem do ledger de tombstones, ainda nao implementado.

export interface SafeguardPrisma {
  polarConnection: { updateMany(args: { where: { disconnectedAt: null }; data: Record<string, unknown> }): Promise<{ count: number }> };
  stravaConnection: { deleteMany(args: Record<string, never>): Promise<{ count: number }> };
  providerConnectionEvent: { create(args: { data: { userId: string; provider: string; type: string; details: unknown } }): Promise<unknown> };
}

export interface SafeguardResult { polarDisconnected: number; stravaConnectionsRemoved: number }

export async function postRestoreSafeguard(prisma: SafeguardPrisma, now: Date = new Date()): Promise<SafeguardResult> {
  const polar = await prisma.polarConnection.updateMany({
    where: { disconnectedAt: null },
    data: { disconnectedAt: now, accessTokenEncrypted: null, openTransactionId: null, openTransactionOpenedAt: null, registeredAt: null },
  });
  const strava = await prisma.stravaConnection.deleteMany({});
  // Trilha de auditoria da propria restauracao (apenas contagens).
  await prisma.providerConnectionEvent.create({
    data: {
      userId: 'system', provider: 'all', type: 'post_restore_safeguard',
      details: { polarDisconnected: polar.count, stravaConnectionsRemoved: strava.count, at: now.toISOString() },
    },
  });
  return { polarDisconnected: polar.count, stravaConnectionsRemoved: strava.count };
}

export type ExecFileLike = (file: string, args: string[], options: { env: Record<string, string>; maxBuffer: number }) => Promise<unknown>;

// pg_restore (sem shell, sem URL em argumento) seguido SEMPRE da etapa pos-restauracao.
export async function restoreBackupFile(opts: {
  dumpPath: string;
  targetDatabaseUrl: string;
  prisma: SafeguardPrisma;
  exec?: ExecFileLike;
}): Promise<SafeguardResult> {
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
  return result;
}
